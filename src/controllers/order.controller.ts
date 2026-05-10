import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';
import { createInventoryLog } from '../util/inventoryLogs';
import { io } from '../index';
import { sendOrderCompletedEmail } from '../util/mailer';

// ── POST /orders ──────────────────────────────────────────────────────────────
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

        const availableStock = product.stock - product.reservedStock;
        if (availableStock < item.quantity) {
          throw new Error(
            `Insufficient stock for "${product.productName}". ` +
            `Available: ${availableStock} cases, requested: ${item.quantity} cases.`
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
    }, {
      isolationLevel: 'Serializable',
    });

    // ── Notify cashiers of new order ──────────────────────────────────────────
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
    const isKnown =
      err?.message?.includes('Insufficient stock') ||
      err?.message?.includes('not found');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to place order.' });
  }
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

    // ── COMPLETED: deduct stock, release reservation, write logs ─────────────
    if (status === 'COMPLETED') {
      await prisma.$transaction(async (tx) => {
        const lines = await tx.orderLine.findMany({
          where:   { saleId: id },
          include: { product: true },
        });

        const logEmployeeId =
          order.employeeId ??
          (await tx.employee.findFirst({ where: { role: 'ADMIN' } }))?.id;

        if (!logEmployeeId) throw new Error('No employee found to process the order.');

        for (const line of lines) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product) throw new Error(`Product not found: ${line.productId}`);

          await tx.product.update({
            where: { id: line.productId },
            data: {
              stock:         { decrement: line.quantity },
              reservedStock: { decrement: line.quantity },
            },
          });

          await createInventoryLog(
            {
              productId:     line.productId,
              employeeId:    logEmployeeId,
              quantity:      -line.quantity,
              type:          'STOCK_OUT',
              reason:        requester.role === 'CUSTOMER'
                               ? 'Order received by customer'
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

      // ── Fetch completed order for notification + email ────────────────────
      const completedOrder = await prisma.saleRecord.findUnique({
        where:   { id },
        include: {
          customer:   true,
          orderLines: { include: { product: true } },
          payment:    true,
        },
      });

      // ── Real-time notifications ───────────────────────────────────────────
      if (completedOrder?.customerId) {
        // Notify the customer
        io.to(`user:${completedOrder.customerId}`).emit('order:completed', {
          orderId: id,
          message: `🎉 Your order ${id} has been completed!`,
        });
      }

      // Notify cashiers/admins regardless of whether there's a customer
      io.to('cashiers').emit('order:completed', {
        orderId: id,
        message: `✅ Order ${id} has been received by the customer.`,
      });

      // ── Email ─────────────────────────────────────────────────────────────
      if (completedOrder?.customer?.email) {
        try {
          const result = await sendOrderCompletedEmail({
            to:      'johnnerayteodoro0216@gmail.com',
            orderId: id,
            items:   completedOrder.orderLines.map((l) => ({
              name:     l.product.productName,
              quantity: l.quantity,
              price:    l.price,
            })),
            total:         completedOrder.totalAmount,
            paymentMethod: completedOrder.payment?.method ?? 'N/A',
          });
          console.log('✅ Email sent:', result);
        } catch (err) {
          console.error('❌ Email failed:', err);
        }
      }

      return res.json({ message: 'Order marked as completed and stock deducted.' });
    }

    // ── CANCELLED: release reservation only ───────────────────────────────────
    if (status === 'CANCELLED') {
      await prisma.$transaction(async (tx) => {
        const lines = await tx.orderLine.findMany({ where: { saleId: id } });

        for (const line of lines) {
          await tx.product.update({
            where: { id: line.productId },
            data:  { reservedStock: { decrement: line.quantity } },
          });
        }

        await tx.saleRecord.update({ where: { id }, data: { status: 'CANCELLED' } });
      });

      // ── Notify customer ───────────────────────────────────────────────────
      if (order.customerId) {
        io.to(`user:${order.customerId}`).emit('order:status', {
          orderId: id,
          status:  'CANCELLED',
          message: `❌ Your order ${id} has been cancelled.`,
        });
      }

      // ── Notify cashiers ───────────────────────────────────────────────────
      io.to('cashiers').emit('order:status', {
        orderId: id,
        status:  'CANCELLED',
        message: `🚫 Order ${id} has been cancelled.`,
      });

      return res.json({ message: 'Order cancelled and stock reservation released.' });
    }

    // ── All other transitions (PROCESSING, OUT_FOR_DELIVERY) ─────────────────
    const updated = await prisma.saleRecord.update({
      where: { id },
      data:  {
        status,
        ...(requester.role !== 'CUSTOMER' && { employeeId: requester.id }),
      },
    });

    // ── Notify customer of status change ──────────────────────────────────
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
        orderLines: { include: { product: true } },
        payment:    true,
      },
    });

    const orders = sales.map((sale) => ({
      id:          sale.id,
      status:      sale.status,
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