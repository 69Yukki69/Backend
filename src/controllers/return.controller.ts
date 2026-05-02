import { Request, Response } from 'express';
import prisma from '../config/db';
import { createInventoryLog } from '../util/inventoryLogs';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveLogEmployeeId(
  requester: { id: string; role: string },
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<string> {
  if (requester.role !== 'CUSTOMER') return requester.id;
  const admin = await tx.employee.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('No admin employee found to process the return.');
  return admin.id;
}

// ── POST /orders/:id/returns ──────────────────────────────────────────────────
/**
 * PROCESS CUSTOMER RETURN
 *
 * Body: { items: [{ orderLineId: string, returnQty: number }] }
 *
 * Rules:
 *   - Order must be COMPLETED or PARTIALLY_RETURNED
 *   - returnQty is in PIECES (not cases)
 *   - returnQty cannot exceed (orderedCases × piecesPerCase) − alreadyReturnedPieces
 *   - Each accepted return: increments product.stock by pieces, appends RETURN_IN log
 *   - If all pieces across all lines are returned → status = REFUNDED
 *   - Otherwise → status = PARTIALLY_RETURNED
 */
export const processReturn = async (req: Request, res: Response) => {
  const saleId    = String(req.params.id);
  const { items } = req.body as { items: { orderLineId: string; returnQty: number }[] };
  const requester = (req as any).user as { id: string; role: string };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No return items provided.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ── 1. Fetch and validate the sale ──────────────────────────────────────
      const sale = await tx.saleRecord.findUnique({
        where:   { id: saleId },
        include: { orderLines: { include: { product: true } } },
      });

      if (!sale) throw new Error('Order not found.');

      const returnableStatuses = ['COMPLETED', 'PARTIALLY_RETURNED'];
      if (!returnableStatuses.includes(sale.status)) {
        throw new Error(
          `Returns are only accepted for completed orders. Current status: ${sale.status}.`
        );
      }

      const logEmployeeId = await resolveLogEmployeeId(requester, tx);
      let totalReturnedPieces = 0;

      // ── 2. Process each return line ─────────────────────────────────────────
      for (const returnItem of items) {
        if (!returnItem.returnQty || returnItem.returnQty < 1) {
          throw new Error(`Return quantity must be at least 1 piece.`);
        }

        const line = sale.orderLines.find((l) => l.id === returnItem.orderLineId);
        if (!line) {
          throw new Error(`Order line ${returnItem.orderLineId} not found on this order.`);
        }

        const product       = line.product;
        const totalOrdered  = line.quantity * product.piecesPerCase; // total pieces ordered
        const alreadyReturned = line.returnedQty;                    // pieces already returned
        const maxReturnable = totalOrdered - alreadyReturned;

        if (returnItem.returnQty > maxReturnable) {
          throw new Error(
            `Cannot return ${returnItem.returnQty} pcs of "${product.productName}". ` +
            `Max returnable: ${maxReturnable} pcs ` +
            `(${line.quantity} cases × ${product.piecesPerCase} pcs/case − ${alreadyReturned} already returned).`
          );
        }

        // Update returnedQty on the order line (tracked in pieces)
        await tx.orderLine.update({
          where: { id: line.id },
          data:  { returnedQty: { increment: returnItem.returnQty } },
        });

        // Restore stock in pieces
        await tx.product.update({
          where: { id: product.id },
          data:  { stock: { increment: returnItem.returnQty } },
        });

        // Append RETURN_IN log — never modifies existing logs
        await createInventoryLog(
          {
            productId:     product.id,
            employeeId:    logEmployeeId,
            quantity:      returnItem.returnQty,   // positive = stock coming back in
            type:          'RETURN_IN',
            reason:        `Customer return for order ${saleId}`,
            referenceId:   saleId,
            referenceType: 'SALE',
          },
          tx
        );

        totalReturnedPieces += returnItem.returnQty;
      }

      // ── 3. Recalculate sale status ──────────────────────────────────────────
      // Re-fetch lines with updated returnedQty values
      const updatedLines = await tx.orderLine.findMany({
        where:   { saleId },
        include: { product: true },
      });

      const allFullyReturned = updatedLines.every(
        (l) => l.returnedQty >= l.quantity * l.product.piecesPerCase
      );

      const newStatus = allFullyReturned ? 'REFUNDED' : 'PARTIALLY_RETURNED';

      await tx.saleRecord.update({
        where: { id: saleId },
        data:  { status: newStatus },
      });

      return { totalReturnedPieces, newStatus };
    });

    res.json({
      message:             `Return processed. ${result.totalReturnedPieces} piece(s) returned.`,
      newOrderStatus:      result.newStatus,
      totalReturnedPieces: result.totalReturnedPieces,
    });
  } catch (err: any) {
    const isKnown =
      err?.message?.includes('not found') ||
      err?.message?.includes('Cannot return') ||
      err?.message?.includes('Returns are only accepted');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to process return.' });
  }
};

// ── GET /orders/:id/returns ───────────────────────────────────────────────────
/**
 * GET RETURN SUMMARY FOR AN ORDER
 * Returns each order line with how many pieces have been returned vs total ordered.
 */
export const getOrderReturns = async (req: Request, res: Response) => {
  const saleId = String(req.params.id);

  try {
    const sale = await prisma.saleRecord.findUnique({
      where:   { id: saleId },
      include: {
        orderLines: {
          include: { product: { select: { productName: true, piecesPerCase: true } } },
        },
      },
    });

    if (!sale) return res.status(404).json({ message: 'Order not found.' });

    const returnSummary = sale.orderLines.map((line) => {
      const totalPieces     = line.quantity * line.product.piecesPerCase;
      const returnedPieces  = line.returnedQty;
      const remainingPieces = totalPieces - returnedPieces;

      return {
        orderLineId:      line.id,
        productName:      line.product.productName,
        orderedCases:     line.quantity,
        piecesPerCase:    line.product.piecesPerCase,
        totalPieces,
        returnedPieces,
        remainingPieces,
        fullyReturned:    returnedPieces >= totalPieces,
      };
    });

    res.json({
      orderId:       saleId,
      orderStatus:   sale.status,
      returnSummary,
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch return summary.' });
  }
};