import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';
import { io } from '../index';
import { completeSale } from '../util/saleCompletion';

const VAT_RATE = 0.12;
const round2   = (n: number) => Math.round(n * 100) / 100;

// NOTE: placeWalkInOrder lives in walkIn.controller.ts (that is the one the
// /orders/walk-in route uses). The duplicate copy that used to be here was removed.

// ── POST /orders ──────────────────────────────────────────────────────────────
export const placeOrder = async (req: Request, res: Response) => {
  const { customerId, paymentMethod, items, cashGiven, gcashRef, receiptImage } = req.body;
  const requester = (req as any).user as { id: string; role: string };

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Invalid order data.' });
  }

  // Customers can only order for themselves
  if (requester.role === 'CUSTOMER' && requester.id !== customerId) {
    return res.status(403).json({ message: 'You can only place orders for your own account.' });
  }

  // GCash orders need a typed 13-digit reference number and an uploaded receipt
  if (paymentMethod === 'gcash') {
    if (!/^\d{13}$/.test(String(gcashRef ?? ''))) {
      return res.status(400).json({ message: 'A valid 13-digit GCash reference number is required.' });
    }
    if (!receiptImage || !String(receiptImage).startsWith('https://res.cloudinary.com/')) {
      return res.status(400).json({ message: 'A GCash payment receipt is required.' });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ── 1. Validate stock availability ──────────────────────────────────────
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product not found: ${item.productId}`);

        const availableStock = product.stock - product.reservedStock;
        if (availableStock < item.quantity) {
          throw new Error(
            `Insufficient stock for "${product.productName}". ` +
            `Available: ${availableStock} cases, requested: ${item.quantity} cases.`
          );
        }
      }

      // ── 2. Create the SaleRecord ────────────────────────────────────────────
      // totalAmount is VAT-INCLUSIVE: subtotal + 12% VAT (rounded to centavos)
      const subtotal = items.reduce(
        (sum: number, i: { price: number; quantity: number }) => sum + i.price * i.quantity,
        0
      );
      const totalAmount = round2(subtotal + subtotal * VAT_RATE);

      const saleId = await generateId('saleRecord');
      const sale = await tx.saleRecord.create({
        data: {
          id:         saleId,
          employeeId: requester.role === 'CUSTOMER' ? null : requester.id,
          customerId: customerId ?? null,
          totalAmount,
          discount:   0,
          status:     'PENDING',
        },
      });

      // ── 3. Create OrderLines + reserve stock ────────────────────────────────
      for (const item of items) {
        await tx.orderLine.create({
          data: {
            saleId:    sale.id,
            productId: item.productId,
            quantity:  item.quantity,
            price:     item.price,
            subtotal:  item.price * item.quantity,
          },
        });

        await tx.product.update({
          where: { id: item.productId },
          data:  { reservedStock: { increment: item.quantity } },
        });
      }

      // ── 4. Record payment ───────────────────────────────────────────────────
      const paymentId = await generateId('payment');
      const method    = paymentMethod === 'gcash' ? 'GCASH' : 'CASH';

      let amountTendered: number | null = null;
      let change: number | null = null;
      if (method === 'CASH') {
        const given = Number(cashGiven);
        const hasGiven = cashGiven !== undefined && cashGiven !== null && cashGiven !== '' && Number.isFinite(given);
        if (hasGiven) {
          if (given + 0.005 < totalAmount) {
            throw new Error('Cash given is less than the total amount.');
          }
          amountTendered = round2(given);
          change         = round2(given - totalAmount);
        } else {
          amountTendered = totalAmount;
          change         = 0;
        }
      }

      if (method === 'GCASH') {
        const dup = await tx.payment.findFirst({ where: { referenceNo: String(gcashRef) } });
        if (dup) throw new Error('This GCash reference number was already used.');
      }

      await tx.payment.create({
        data: {
          id:             paymentId,
          saleId:         sale.id,
          amount:         totalAmount,
          method,
          amountTendered,
          change,
          paidAt:         new Date(),
          ...(method === 'GCASH' && {
            referenceNo:  String(gcashRef),
            receiptImage: String(receiptImage),
          }),
        },
      });

      // ── 5. Clear shopping cart ──────────────────────────────────────────────
      const cart = await tx.shoppingCart.findUnique({ where: { customerId } });
      if (cart) await tx.shoppingCartItem.deleteMany({ where: { shoppingCartId: cart.id } });

      return sale;
    }, {
      isolationLevel: 'Serializable',
    });

    // ── Notify cashiers of new order ──────────────────────────────────────────
    console.log('🚨 EMITTING order:new to cashiers room');
    io.to('cashiers').emit('order:new', {
      orderId: result.id,
      message: `New order! Order ${result.id} is waiting for review.`,
    });

    res.status(201).json({ message: 'Order placed successfully.', saleId: result.id });
  } catch (err: any) {
    if (err?.code === 'P2034') {
      return res.status(409).json({
        message: 'Order conflict detected. Please try again.',
        retryable: true,
      });
    }
    if (err?.code === 'P2002') {
      return res.status(400).json({ message: 'This GCash reference number was already used.' });
    }
    const isKnown =
      err?.message?.includes('Insufficient stock') ||
      err?.message?.includes('Cash given') ||
      err?.message?.includes('already used') ||
      err?.message?.includes('not found');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to place order.' });
  }
};

// Allowed status transitions
const ALLOWED_NEXT: Record<string, string[]> = {
  PENDING:          ['PROCESSING', 'CANCELLED'],
  PROCESSING:       ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['COMPLETED', 'CANCELLED'],
};

// ── PATCH /orders/:id/status ──────────────────────────────────────────────────
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

  // Only customers, cashiers and admins may change order status (not stock managers)
  if (!['CUSTOMER', 'CASHIER', 'ADMIN'].includes(requester.role)) {
    return res.status(403).json({ message: 'You are not allowed to update order status.' });
  }

  try {
    const order = await prisma.saleRecord.findUnique({
      where:   { id },
      include: { payment: true },
    });
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    // ── Guard: terminal states cannot be changed ────────────────────────────
    const terminalStates = ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_RETURNED'];
    if (terminalStates.includes(order.status)) {
      return res.status(400).json({
        message: `Order is already ${order.status} and cannot be updated.`,
      });
    }

    // ── Guard: only valid forward transitions ───────────────────────────────
    if (!ALLOWED_NEXT[order.status]?.includes(status)) {
      return res.status(400).json({
        message: `Cannot move an order from ${order.status} to ${status}.`,
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
      // Paid GCash orders (and anything past PENDING) cannot be cancelled online
      if (status === 'CANCELLED' && (order.status !== 'PENDING' || order.payment?.method === 'GCASH')) {
        return res.status(403).json({
          message: 'This order can no longer be cancelled online. Please contact the store.',
        });
      }
    }

    // ── Guard: staff cannot complete orders linked to a customer account ────
    if (status === 'COMPLETED' && requester.role !== 'CUSTOMER' && order.customerId) {
      return res.status(403).json({
        message: 'Orders linked to a customer account can only be completed by that customer.',
      });
    }

    // ── COMPLETED: shared completion logic ───────────────────────────────────
    if (status === 'COMPLETED') {
      const by = requester.role === 'CUSTOMER' ? 'CUSTOMER' : 'CASHIER';
      const ok = await completeSale(id, by, by === 'CASHIER' ? requester.id : undefined);
      if (!ok) {
        return res.status(409).json({ message: 'Order was already completed or cancelled.' });
      }
      return res.json({ message: 'Order marked as completed and stock deducted.' });
    }

    // ── CANCELLED: release reservation only ───────────────────────────────────
    if (status === 'CANCELLED') {
      await prisma.$transaction(async (tx) => {
        const claim = await tx.saleRecord.updateMany({
          where: { id, status: order.status },
          data:  { status: 'CANCELLED' },
        });
        if (claim.count === 0) throw new Error('Order status changed. Please refresh.');

        const lines = await tx.orderLine.findMany({ where: { saleId: id } });
        for (const line of lines) {
          await tx.product.update({
            where: { id: line.productId },
            data:  { reservedStock: { decrement: line.quantity } },
          });
        }
      });

      if (order.customerId) {
        io.to(`user:${order.customerId}`).emit('order:status', {
          orderId: id,
          status:  'CANCELLED',
          message: `❌ Your order ${id} has been cancelled.`,
        });
      }

      io.to('cashiers').emit('order:status', {
        orderId: id,
        status:  'CANCELLED',
        message: `🚫 Order ${id} has been cancelled.`,
      });

      return res.json({ message: 'Order cancelled and stock reservation released.' });
    }

    // ── PROCESSING, OUT_FOR_DELIVERY ─────────────────────────────────────────
    const claim = await prisma.saleRecord.updateMany({
      where: { id, status: order.status },   // guards against double clicks
      data:  {
        status,
        ...(status === 'OUT_FOR_DELIVERY' && { outForDeliveryAt: new Date() }),
        ...(requester.role !== 'CUSTOMER' && { employeeId: requester.id }),
      },
    });
    if (claim.count === 0) {
      return res.status(409).json({ message: 'Order status changed. Please refresh.' });
    }
    const updated = await prisma.saleRecord.findUnique({ where: { id } });

    if (order.customerId) {
      const statusMessages: Record<string, string> = {
        PROCESSING:       `⚙️ Your order ${id} is now being processed!`,
        OUT_FOR_DELIVERY: `🚚 Your order ${id} is out for delivery!`,
      };
      const message = statusMessages[status];
      if (message) {
        io.to(`user:${order.customerId}`).emit('order:status', {
          orderId: id,
          status,
          message,
        });
      }
    }

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
        payment:    true,
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
      include: {
        employee:   { select: { id: true, name: true } },
        orderLines: { include: { product: true } },
        payment:    true,
      },
    });

    const orders = sales.map((sale) => ({
      id:          sale.id,
      status:      sale.status,
      employee:    sale.employee,
      cashier:     sale.employee?.name ?? null,
      createdAt:   sale.createdAt,
      totalAmount: sale.totalAmount,
      payment:     sale.payment,
      orderLines:  sale.orderLines.map((line) => ({
        id:          line.id,
        quantity:    line.quantity,
        returnedQty: line.returnedQty,
        price:       line.price,
        product: {
          productName:   line.product.productName,
          piecesPerCase: line.product.piecesPerCase,
        },
      })),
    }));

    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch customer orders.' });
  }
};