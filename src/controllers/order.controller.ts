import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

export const placeOrder = async (req: Request, res: Response) => {
  const { customerId, paymentMethod, gcashRef, note, items } = req.body;

  // ── Basic validation ─────────────────────────────────────────────────────
  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Invalid order data.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {

      // ── 1. Verify stock for every item before touching anything ──────────
      for (const item of items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product) {
          throw new Error(`Product not found: ${item.productId}`);
        }
        if (product.stock < item.quantity) {
          throw new Error(
            `Insufficient stock for "${product.productName}". Only ${product.stock} left.`
          );
        }
      }

      // ── 2. Find any active employee to attach (system/online order) ──────
      const employee = await tx.employee.findFirst();
      if (!employee) {
        throw new Error('No employee found to attach the order to.');
      }

      // ── 3. Compute totals ────────────────────────────────────────────────
      const totalAmount = items.reduce(
        (sum: number, i: { price: number; quantity: number }) => sum + i.price * i.quantity,
        0
      );

      // ── 4. Create SaleRecord ─────────────────────────────────────────────
      const saleId = await generateId('saleRecord');
      const sale = await tx.saleRecord.create({
        data: {
          id:          saleId,
          employeeId:  employee.id,
          customerId:  customerId || null,
          totalAmount,
          discount:    0,
          status:      'PENDING',
        },
      });

      // ── 5. Create OrderLines + deduct stock ──────────────────────────────
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
          data:  { stock: { decrement: item.quantity } },
        });
      }

      // ── 6. Create Payment ────────────────────────────────────────────────
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

      // ── 7. Clear the customer's cart ─────────────────────────────────────
      const cart = await tx.shoppingCart.findUnique({ where: { customerId } });
      if (cart) {
        await tx.shoppingCartItem.deleteMany({ where: { shoppingCartId: cart.id } });
      }

      return sale;
    });

    res.status(201).json({
      message: 'Order placed successfully.',
      saleId:  result.id,
    });

  } catch (err: any) {
    const isKnown = err?.message?.includes('Insufficient stock') ||
                    err?.message?.includes('not found');

    res.status(isKnown ? 400 : 500).json({
      message: err?.message || 'Failed to place order.',
    });
  }
};

export const getCustomerOrders = async (req: Request, res: Response) => {
  const { customerId } = req.params as { customerId: string };

  try {
    const sales = await prisma.saleRecord.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        orderLines: {
          include: { product: true },
        },
      },
    });

    const orders = sales.map((sale) => ({
      id: sale.id,
      orderId: sale.id,
      status: sale.status,
      createdAt: sale.createdAt,
      totalAmount: sale.totalAmount,
      items: sale.orderLines.map((line: { product: { productName: string }; quantity: number; price: number }) => ({
        name: line.product.productName,
        qty: line.quantity,
        price: line.price,
      })),
    }));

    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch orders.' });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { status } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // If cancelling, restore stock first
      if (status === 'CANCELLED') {
        const orderLines = await tx.orderLine.findMany({
          where: { saleId: id },
        });

        for (const line of orderLines) {
          await tx.product.update({
            where: { id: line.productId },
            data: { stock: { increment: line.quantity } },
          });
        }
      }

      return await tx.saleRecord.update({
        where: { id },
        data: { status },
      });
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to update status.' });
  }
};

export const getAllCompletedOrders = async (req: Request, res: Response) => {
  try {
    const sales = await prisma.saleRecord.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        employee: true,
        orderLines: { include: { product: true } },
        payment: true,
      },
    });
    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch completed orders.' });
  }
};

export const getActiveOrders = async (req: Request, res: Response) => {
  try {
    const sales = await prisma.saleRecord.findMany({
      where: {
        status: {
          notIn: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_RETURNED'],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: true,
        employee: true,
        orderLines: { include: { product: true } },
      },
    });
    res.json(sales);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch orders.' });
  }
};