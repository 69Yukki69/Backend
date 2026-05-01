import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';
import { createInventoryLog } from '../util/inventoryLogs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolve the employee ID to attach to inventory logs.
 *  If the requester is a customer, fall back to the first ADMIN. */
async function resolveLogEmployeeId(
  requester: { id: string; role: string },
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<string> {
  if (requester.role !== 'CUSTOMER') return requester.id;

  const admin = await tx.employee.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('No admin employee found to process the order.');
  return admin.id;
}

// ── POST /orders ──────────────────────────────────────────────────────────────
/**
 * PLACE ORDER — reserves stock, does NOT deduct it yet.
 *
 * Stock lifecycle:
 *   placeOrder  → reservedStock += (qty × piecesPerCase)   [stock untouched]
 *   COMPLETED   → stock         -= (qty × piecesPerCase)   [STOCK_OUT log]
 *                 reservedStock -= (qty × piecesPerCase)
 *   CANCELLED   → reservedStock -= (qty × piecesPerCase)   [stock untouched, no log]
 */
export const placeOrder = async (req: Request, res: Response) => {
  const { customerId, paymentMethod, items } = req.body;
  const requester = (req as any).user as { id: string; role: string };

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Invalid order data.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ── 1. Validate stock availability ──────────────────────────────────────
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product not found: ${item.productId}`);

        // item.quantity is in CASES; convert to pieces for stock comparison
        const piecesRequested = item.quantity * product.piecesPerCase;
        const availableStock = product.stock - product.reservedStock;

        if (availableStock < piecesRequested) {
          throw new Error(
            `Insufficient stock for "${product.productName}". ` +
            `Available: ${availableStock} pcs, requested: ${piecesRequested} pcs.`
          );
        }
      }

      // ── 2. Create the SaleRecord ────────────────────────────────────────────
      const totalAmount = items.reduce(
        (sum: number, i: { price: number; quantity: number }) => sum + i.price * i.quantity,
        0
      );

      const saleId = await generateId('saleRecord');
      const sale = await tx.saleRecord.create({
        data: {
          id:          saleId,
          employeeId:  requester.role === 'CUSTOMER' ? null : requester.id,
          customerId:  customerId ?? null,
          totalAmount,
          discount:    0,
          status:      'PENDING',
        },
      });

      // ── 3. Create OrderLines + reserve stock ────────────────────────────────
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product not found: ${item.productId}`);

        const piecesReserved = item.quantity * product.piecesPerCase;

        await tx.orderLine.create({
          data: {
            saleId:    sale.id,
            productId: item.productId,
            quantity:  item.quantity,   // stored in cases
            price:     item.price,
            subtotal:  item.price * item.quantity,
          },
        });

        // Reserve stock — do NOT touch `stock` yet
        await tx.product.update({
          where: { id: item.productId },
          data:  { reservedStock: { increment: piecesReserved } },
        });
      }

      // ── 4. Record payment ───────────────────────────────────────────────────
      const paymentId = await generateId('payment');
      const method    = paymentMethod === 'gcash' ? 'GCASH' : 'CASH';

      await tx.payment.create({
        data: {
          id:             paymentId,
          saleId:         sale.id,
          amount:         totalAmount,
          method,
          amountTendered: method === 'CASH' ? totalAmount : null,
          change:         method === 'CASH' ? 0 : null,
          paidAt:         new Date(),
        },
      });

      // ── 5. Clear shopping cart ──────────────────────────────────────────────
      const cart = await tx.shoppingCart.findUnique({ where: { customerId } });
      if (cart) await tx.shoppingCartItem.deleteMany({ where: { shoppingCartId: cart.id } });

      return sale;
    });

    res.status(201).json({ message: 'Order placed successfully.', saleId: result.id });
  } catch (err: any) {
    const isKnown =
      err?.message?.includes('Insufficient stock') ||
      err?.message?.includes('not found');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to place order.' });
  }
};

// ── PATCH /orders/:id/status ──────────────────────────────────────────────────
/**
 * UPDATE ORDER STATUS
 *
 * COMPLETED transition:
 *   - Deducts stock (pieces) and releases reservation
 *   - Writes STOCK_OUT inventory log per line
 *
 * CANCELLED transition:
 *   - Releases reservation only (stock was never touched)
 *   - No inventory log needed
 *
 * All other transitions:
 *   - Status update only
 */
export const updateOrderStatus = async (req: Request, res: Response) => {
  const id         = String(req.params.id);
  const { status } = req.body;
  const requester  = (req as any).user as { id: string; role: string };

  const validStatuses = ['PENDING', 'PROCESSING', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
    });
  }

  try {
    const order = await prisma.saleRecord.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    // ── Guard: terminal states cannot be changed ────────────────────────────
    const terminalStates = ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_RETURNED'];
    if (terminalStates.includes(order.status)) {
      return res.status(400).json({
        message: `Order is already ${order.status} and cannot be updated.`,
      });
    }

    // ── Guard: customers can only mark as COMPLETED or CANCELLED ────────────
    if (requester.role === 'CUSTOMER') {
      if (order.customerId !== requester.id) {
        return res.status(403).json({ message: 'You can only update your own orders.' });
      }
      if (!['COMPLETED', 'CANCELLED'].includes(status)) {
        return res.status(403).json({
          message: 'Customers can only mark orders as received (COMPLETED) or cancelled.',
        });
      }
    }

    // ── COMPLETED: deduct stock, release reservation, write logs ────────────
    if (status === 'COMPLETED') {
      await prisma.$transaction(async (tx) => {
        const lines        = await tx.orderLine.findMany({ where: { saleId: id } });
        const logEmployeeId = await resolveLogEmployeeId(requester, tx);

        for (const line of lines) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product) throw new Error(`Product not found: ${line.productId}`);

          const piecesDeducted = line.quantity * product.piecesPerCase;

          await tx.product.update({
            where: { id: line.productId },
            data: {
              stock:         { decrement: piecesDeducted },
              reservedStock: { decrement: piecesDeducted },
            },
          });

          await createInventoryLog(
            {
              productId:     line.productId,
              employeeId:    logEmployeeId,
              quantity:      -piecesDeducted,
              type:          'STOCK_OUT',
              reason:        requester.role === 'CUSTOMER'
                               ? 'Order completed by customer'
                               : 'Order completed by cashier',
              referenceId:   id,
              referenceType: 'SALE',
            },
            tx
          );
        }

        await tx.saleRecord.update({
          where: { id },
          data:  {
            status: 'COMPLETED',
            ...(requester.role !== 'CUSTOMER' && { employeeId: requester.id }),
          },
        });
      });

      return res.json({ message: 'Order marked as completed and stock deducted.' });
    }

    // ── CANCELLED: release reservation only, stock was never touched ────────
    if (status === 'CANCELLED') {
      await prisma.$transaction(async (tx) => {
        const lines = await tx.orderLine.findMany({ where: { saleId: id } });

        for (const line of lines) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product) throw new Error(`Product not found: ${line.productId}`);

          const piecesReserved = line.quantity * product.piecesPerCase;

          await tx.product.update({
            where: { id: line.productId },
            data:  { reservedStock: { decrement: piecesReserved } },
          });
        }

        await tx.saleRecord.update({ where: { id }, data: { status: 'CANCELLED' } });
      });

      return res.json({ message: 'Order cancelled and stock reservation released.' });
    }

    // ── All other transitions (PROCESSING, OUT_FOR_DELIVERY): status only ───
    const updated = await prisma.saleRecord.update({
      where: { id },
      data:  {
        status,
        ...(requester.role !== 'CUSTOMER' && { employeeId: requester.id }),
      },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to update order status.' });
  }
};

// ── GET /orders/active ────────────────────────────────────────────────────────
export const getActiveOrders = async (req: Request, res: Response) => {
  try {
    const sales = await prisma.saleRecord.findMany({
      where:   { status: { notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_RETURNED'] } },
      orderBy: { createdAt: 'desc' },
      include: {
        customer:   true,
        employee:   true,
        orderLines: { include: { product: true } },
      },
    });
    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch active orders.' });
  }
};

// ── GET /orders/completed ─────────────────────────────────────────────────────
export const getAllCompletedOrders = async (req: Request, res: Response) => {
  try {
    const sales = await prisma.saleRecord.findMany({
      where:   { status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      include: {
        customer:   true,
        employee:   true,
        orderLines: { include: { product: true } },
        payment:    true,
      },
    });
    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch completed orders.' });
  }
};

// ── GET /orders/customer/:customerId ─────────────────────────────────────────
export const getCustomerOrders = async (req: Request, res: Response) => {
  const { customerId } = req.params as { customerId: string };
  try {
    const sales = await prisma.saleRecord.findMany({
      where:   { customerId },
      orderBy: { createdAt: 'desc' },
      include: { orderLines: { include: { product: true } } },
    });

    const orders = sales.map((sale) => ({
      id:          sale.id,
      status:      sale.status,
      createdAt:   sale.createdAt,
      totalAmount: sale.totalAmount,
      items: sale.orderLines.map((line) => ({
        name:  line.product.productName,
        qty:   line.quantity,
        price: line.price,
      })),
    }));

    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch customer orders.' });
  }
};