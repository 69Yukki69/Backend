// controllers/returnRequest.controller.ts

import { Request, Response } from 'express';
import prisma from '../config/db';
import { createInventoryLog } from '../util/inventoryLogs';
import { ReturnReason, LossReason } from '../generated/prisma/client';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Maps ReturnReason → LossReason for write-off logs (null = resellable, no write-off)
const RETURN_LOSS_REASON_MAP: Record<ReturnReason, LossReason | null> = {
  WRONG_ITEM_SENT: null,
  DAMAGED:         'DAMAGED',
  EXPIRED:         'EXPIRED',
  OTHER:           'OTHER',
};

const VALID_RETURN_REASONS = Object.keys(RETURN_LOSS_REASON_MAP) as ReturnReason[];
const RETURNABLE_STATUSES  = ['COMPLETED', 'PARTIALLY_RETURNED'];

// ── POST /returns ─────────────────────────────────────────────────────────────
/**
 * SUBMIT RETURN REQUEST (Customer)
 *
 * Body: {
 *   saleId:  string
 *   reason:  ReturnReason
 *   items:   [{ orderLineId: string, returnQty: number }]
 * }
 *
 * Rules:
 *   - Customers can only return their own orders
 *   - Sale must be COMPLETED or PARTIALLY_RETURNED
 *   - No duplicate PENDING return on the same sale
 *   - returnQty (pieces) cannot exceed maxReturnable per line
 *   - No stock/log changes — just creates ReturnRequest + ReturnRequestItems
 */
export const submitReturnRequest = async (req: Request, res: Response) => {
  const requester = (req as any).user as { id: string; role: string };
  const { saleId, reason, items } = req.body as {
    saleId: string;
    reason: ReturnReason;
    items:  { orderLineId: string; returnQty: number }[];
  };

  if (!saleId || !reason || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'saleId, reason, and items are required.' });
  }
  if (!VALID_RETURN_REASONS.includes(reason)) {
    return res.status(400).json({
      message: `Invalid reason. Must be one of: ${VALID_RETURN_REASONS.join(', ')}`,
    });
  }

  try {
    const returnRequest = await prisma.$transaction(async (tx) => {
      // ── 1. Fetch and validate sale ───────────────────────────────────────────
      const sale = await tx.saleRecord.findUnique({
        where:   { id: saleId },
        include: { orderLines: { include: { product: true } } },
      });

      if (!sale) throw new Error('Order not found.');

      if (requester.role === 'CUSTOMER' && sale.customerId !== requester.id) {
        throw new Error('You can only request returns for your own orders.');
      }
      if (!RETURNABLE_STATUSES.includes(sale.status)) {
        throw new Error(
          `Returns are only accepted for completed orders. Current status: ${sale.status}.`
        );
      }

      // ── 2. Block duplicate pending return on same sale ───────────────────────
      const existingPending = await tx.returnRequest.findFirst({
        where: { saleId, status: 'PENDING' },
      });
      if (existingPending) {
        throw new Error('A return request for this order is already pending review.');
      }

      // ── 3. Validate each return line ─────────────────────────────────────────
      for (const item of items) {
        if (!item.returnQty || item.returnQty < 1) {
          throw new Error('Return quantity must be at least 1 piece.');
        }

        const line = sale.orderLines.find((l) => l.id === item.orderLineId);
        if (!line) {
          throw new Error(`Order line ${item.orderLineId} not found on this order.`);
        }

        const maxReturnable = (line.quantity * line.product.piecesPerCase) - line.returnedQty;
        if (item.returnQty > maxReturnable) {
          throw new Error(
            `Cannot return ${item.returnQty} pcs of "${line.product.productName}". ` +
            `Max returnable: ${maxReturnable} pcs ` +
            `(${line.quantity} cases × ${line.product.piecesPerCase} pcs/case − ${line.returnedQty} already returned).`
          );
        }
      }

      // ── 4. Create ReturnRequest + ReturnRequestItems ─────────────────────────
      return tx.returnRequest.create({
        data: {
          saleId,
          customerId: requester.role === 'CUSTOMER' ? requester.id : sale.customerId!,
          reason,
          status:     'PENDING',
          items: {
            create: items.map((item) => ({
              orderLineId: item.orderLineId,
              returnQty:   item.returnQty,
            })),
          },
        },
        include: { items: true },
      });
    });

    res.status(201).json({
      message: 'Return request submitted. Awaiting employee review.',
      returnRequest,
    });
  } catch (err: any) {
    const isKnown =
      err?.message?.includes('not found')        ||
      err?.message?.includes('Cannot return')    ||
      err?.message?.includes('Returns are only') ||
      err?.message?.includes('already pending')  ||
      err?.message?.includes('own orders')       ||
      err?.message?.includes('at least 1');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to submit return request.' });
  }
};

// ── PATCH /returns/:id ────────────────────────────────────────────────────────
/**
 * REVIEW RETURN REQUEST (Employee only)
 *
 * Body: { action: 'APPROVE' | 'REJECT', reviewNote?: string }
 *
 * On REJECT:
 *   - status → REJECTED, no stock/log changes
 *
 * On APPROVE (driven by ReturnRequest.reason):
 *   WRONG_ITEM_SENT → stock +=, RETURN_IN log only
 *   DAMAGED | EXPIRED | OTHER:
 *     stock +=, RETURN_IN log   (item physically came back)
 *     stock -=, ADJUSTMENT log  (immediately written off — net stock effect: 0)
 *
 *   Then: OrderLine.returnedQty +=, SaleRecord.status recalculated
 */
export const reviewReturnRequest = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const reviewer        = (req as any).user as { id: string; role: string };
  const { action, reviewNote } = req.body as {
    action:      'APPROVE' | 'REJECT';
    reviewNote?: string;
  };

  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ message: "action must be 'APPROVE' or 'REJECT'." });
  }
  if (reviewer.role === 'CUSTOMER') {
    return res.status(403).json({ message: 'Customers cannot review return requests.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ── 1. Fetch return request ──────────────────────────────────────────────
      const returnRequest = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: {
          items: {
            include: { orderLine: { include: { product: true } } },
          },
        },
      });

      if (!returnRequest) throw new Error('Return request not found.');
      if (returnRequest.status !== 'PENDING') {
        throw new Error(
          `Return request has already been ${returnRequest.status.toLowerCase()}.`
        );
      }

      const now = new Date();

      // ── 2. REJECT path ───────────────────────────────────────────────────────
      if (action === 'REJECT') {
        const rejected = await tx.returnRequest.update({
          where: { id: returnRequestId },
          data: {
            status:     'REJECTED',
            reviewedBy: reviewer.id,
            reviewedAt: now,
            reviewNote: reviewNote ?? null,
          },
        });
        return { action: 'REJECTED' as const, returnRequest: rejected, newSaleStatus: null };
      }

      // ── 3. APPROVE path ──────────────────────────────────────────────────────
      const lossReason    = RETURN_LOSS_REASON_MAP[returnRequest.reason];
      const needsWriteOff = lossReason !== null;

      for (const item of returnRequest.items) {
        const { orderLine, returnQty } = item;
        const { product }              = orderLine;

        // Re-validate in case another approval ran concurrently
        const maxReturnable =
          (orderLine.quantity * product.piecesPerCase) - orderLine.returnedQty;
        if (returnQty > maxReturnable) {
          throw new Error(
            `Cannot approve return of ${returnQty} pcs for "${product.productName}". ` +
            `Only ${maxReturnable} pcs still returnable.`
          );
        }

        // ── 3a. Stock in — item physically came back ───────────────────────────
        await tx.product.update({
          where: { id: product.id },
          data:  { stock: { increment: returnQty } },
        });

        await createInventoryLog(
          {
            productId:     product.id,
            employeeId:    reviewer.id,
            quantity:      returnQty,               // positive
            type:          'RETURN_IN',
            reason:        `Return approved — reason: ${returnRequest.reason}`,
            lossReason:    undefined,
            referenceId:   returnRequest.saleId,
            referenceType: 'RETURN',
          },
          tx
        );

        // ── 3b. Write-off — item cannot be resold ──────────────────────────────
        if (needsWriteOff) {
          await tx.product.update({
            where: { id: product.id },
            data:  { stock: { decrement: returnQty } },
          });

          await createInventoryLog(
            {
              productId:     product.id,
              employeeId:    reviewer.id,
              quantity:      -returnQty,              // negative
              type:          'ADJUSTMENT',
              reason:        `Return write-off — ${returnRequest.reason}`,
              lossReason,
              referenceId:   returnRequest.saleId,
              referenceType: 'RETURN',
            },
            tx
          );
        }

        // ── 3c. Track returned qty on the order line ───────────────────────────
        await tx.orderLine.update({
          where: { id: orderLine.id },
          data:  { returnedQty: { increment: returnQty } },
        });
      }

      // ── 4. Recalculate sale status ───────────────────────────────────────────
      const updatedLines = await tx.orderLine.findMany({
        where:   { saleId: returnRequest.saleId },
        include: { product: true },
      });

      const allFullyReturned = updatedLines.every(
        (l) => l.returnedQty >= l.quantity * l.product.piecesPerCase
      );
      const newSaleStatus = allFullyReturned ? 'REFUNDED' : 'PARTIALLY_RETURNED';

      await tx.saleRecord.update({
        where: { id: returnRequest.saleId },
        data:  { status: newSaleStatus },
      });

      // ── 5. Mark request approved ─────────────────────────────────────────────
      const approved = await tx.returnRequest.update({
        where: { id: returnRequestId },
        data: {
          status:     'APPROVED',
          reviewedBy: reviewer.id,
          reviewedAt: now,
          reviewNote: reviewNote ?? null,
        },
      });

      return { action: 'APPROVED' as const, returnRequest: approved, newSaleStatus, needsWriteOff };
    });

    const message =
      result.action === 'REJECTED'
        ? 'Return request rejected.'
        : `Return approved. Sale is now ${result.newSaleStatus}.` +
          (result.needsWriteOff ? ' Items written off (not resellable).' : ' Items restocked.');

    res.json({ message, ...result });
  } catch (err: any) {
    const isKnown =
      err?.message?.includes('not found')      ||
      err?.message?.includes('already been')   ||
      err?.message?.includes('Cannot approve') ||
      err?.message?.includes('cannot review');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to review return request.' });
  }
};

// ── GET /returns ──────────────────────────────────────────────────────────────
/**
 * LIST RETURN REQUESTS
 *
 * Query params:
 *   - status      filter by ReturnRequestStatus (PENDING, APPROVED, REJECTED)
 *   - customerId  filter by customer
 *   - saleId      filter by sale
 *   - from        ISO date string
 *   - to          ISO date string
 *   - page        default 1
 *   - limit       default 20, max 50
 */
export const getReturnRequests = async (req: Request, res: Response) => {
  try {
    const page       = Math.max(1, Number(req.query.page)  || 1);
    const limit      = Math.min(50, Number(req.query.limit) || 20);
    const skip       = (page - 1) * limit;
    const status     = req.query.status     as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const saleId     = req.query.saleId     as string | undefined;
    const from       = req.query.from       as string | undefined;
    const to         = req.query.to         as string | undefined;

    const where: Record<string, unknown> = {};
    if (status)     where.status     = status;
    if (customerId) where.customerId = customerId;
    if (saleId)     where.saleId     = saleId;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      };
    }

    const [requests, total] = await Promise.all([
      prisma.returnRequest.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          reviewer: { select: { id: true, name: true, role: true } },
          items: {
            include: {
              orderLine: {
                include: { product: { select: { productName: true, piecesPerCase: true } } },
              },
            },
          },
        },
      }),
      prisma.returnRequest.count({ where }),
    ]);

    res.json({
      requests,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch return requests.' });
  }
};

// ── GET /returns/:id ──────────────────────────────────────────────────────────
/**
 * GET SINGLE RETURN REQUEST
 * Full detail including items, product info, reviewer, and linked sale status.
 */
export const getReturnRequestById = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);

  try {
    const returnRequest = await prisma.returnRequest.findUnique({
      where:   { id: returnRequestId },
      include: {
        customer:   { select: { id: true, name: true, email: true } },
        reviewer:   { select: { id: true, name: true, role: true } },
        saleRecord: { select: { id: true, status: true, totalAmount: true } },
        items: {
          include: {
            orderLine: {
              include: {
                product: {
                  select: { productName: true, piecesPerCase: true, category: true },
                },
              },
            },
          },
        },
      },
    });

    if (!returnRequest) {
      return res.status(404).json({ message: 'Return request not found.' });
    }

    res.json({ returnRequest });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch return request.' });
  }
};