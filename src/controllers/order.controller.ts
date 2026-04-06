import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

// ── POST /orders ─────────────────────────────────────────────────────────────
export const placeOrder = async (req: Request, res: Response) => {
  const { customerId, paymentMethod, gcashRef, note, items } = req.body;
  const requester = (req as any).user as { id: string; role: string };

  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Invalid order data.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new Error(`Product not found: ${item.productId}`);
        if (product.stock < item.quantity) {
          throw new Error(`Insufficient stock for "${product.productName}". Only ${product.stock} left.`);
        }
      }

      // ── Use the logged-in user's ID instead of findFirst() ──
      const employee = await tx.employee.findUnique({ where: { id: requester.id } });
      if (!employee) throw new Error('Logged-in user is not a valid employee.');

      const totalAmount = items.reduce(
        (sum: number, i: { price: number; quantity: number }) => sum + i.price * i.quantity, 0
      );

      const saleId = await generateId('saleRecord');
      const sale = await tx.saleRecord.create({
        data: { id: saleId, employeeId: employee.id, customerId: customerId || null, totalAmount, discount: 0, status: 'PENDING' },
      });

      for (const item of items) {
        await tx.orderLine.create({
          data: { saleId: sale.id, productId: item.productId, quantity: item.quantity, price: item.price, subtotal: item.price * item.quantity },
        });
        await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } });
      }

      const paymentId = await generateId('payment');
      const method    = paymentMethod === 'gcash' ? 'GCASH' : 'CASH';
      await tx.payment.create({
        data: { id: paymentId, saleId: sale.id, amount: totalAmount, method, amountTendered: method === 'CASH' ? totalAmount : null, change: method === 'CASH' ? 0 : null, paidAt: new Date() },
      });

      const cart = await tx.shoppingCart.findUnique({ where: { customerId } });
      if (cart) await tx.shoppingCartItem.deleteMany({ where: { shoppingCartId: cart.id } });

      return sale;
    });

    res.status(201).json({ message: 'Order placed successfully.', saleId: result.id });
  } catch (err: any) {
    const isKnown = err?.message?.includes('Insufficient stock') || err?.message?.includes('not found') || err?.message?.includes('not a valid employee');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to place order.' });
  }
};

// ── GET /orders/active ────────────────────────────────────────────────────────
export const getActiveOrders = async (req: Request, res: Response) => {
  try {
    const sales = await prisma.saleRecord.findMany({
      where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_RETURNED'] } },
      orderBy: { createdAt: 'desc' },
      include: { customer: true, employee: true, orderLines: { include: { product: true } } },
    });
    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch orders.' });
  }
};

// ── GET /orders/completed ─────────────────────────────────────────────────────
export const getAllCompletedOrders = async (req: Request, res: Response) => {
  try {
    const sales = await prisma.saleRecord.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      include: { customer: true, employee: true, orderLines: { include: { product: true } }, payment: true },
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
      where: { customerId },
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
    res.status(500).json({ message: err?.message || 'Failed to fetch orders.' });
  }
};

// ── PATCH /orders/:id/status ──────────────────────────────────────────────────
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const id         = String(req.params.id);
    const { status } = req.body;
    const requester  = (req as any).user as { id: string; role: string };

    const validStatuses = ['PENDING', 'PROCESSING', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const order = await prisma.saleRecord.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ message: 'Order not found.' });

    // Customers can only update their own orders, and only to COMPLETED or CANCELLED
    if (requester.role === 'CUSTOMER') {
      if (order.customerId !== requester.id) {
        return res.status(403).json({ message: 'You can only update your own orders.' });
      }
      if (!['COMPLETED', 'CANCELLED'].includes(status)) {
        return res.status(403).json({ message: 'Customers can only mark orders as received or cancelled.' });
      }
    }

    // Restore stock when cancelling
    if (status === 'CANCELLED' && order.status !== 'CANCELLED') {
      await prisma.$transaction(async (tx) => {
        const lines = await tx.orderLine.findMany({ where: { saleId: id } });
        for (const line of lines) {
          await tx.product.update({ where: { id: line.productId }, data: { stock: { increment: line.quantity } } });
        }
        await tx.saleRecord.update({ where: { id }, data: { status } });
      });
      return res.json({ message: 'Order cancelled and stock restored.' });
    }

    const updated = await prisma.saleRecord.update({ where: { id }, data: { status } });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to update order status.' });
  }
};