import prisma from '../config/db';
import { io } from '../index';
import { createInventoryLog } from './inventoryLogs';
import { deductStockFIFOService } from './stockBatch';
import { sendOrderCompletedEmail } from './mailer';

export type CompletedBy = 'CASHIER' | 'CUSTOMER' | 'SYSTEM';

const REASON: Record<CompletedBy, string> = {
  CASHIER:  'Order completed by cashier',
  CUSTOMER: 'Order received by customer',
  SYSTEM:   'Order auto-completed 24h after dispatch',
};

/**
 * Single place that completes a sale (stock deduction, logs, notifications).
 * Used by the cashier, the customer, and the auto-complete job.
 * Returns false if the order was not OUT_FOR_DELIVERY (already completed/cancelled).
 */
export async function completeSale(saleId: string, by: CompletedBy, cashierId?: string) {
  const claimed = await prisma.$transaction(async (tx) => {
    const order = await tx.saleRecord.findUnique({ where: { id: saleId } });
    if (!order) throw new Error('Order not found.');

    // Atomic claim: only one caller can flip OUT_FOR_DELIVERY -> COMPLETED
    const claim = await tx.saleRecord.updateMany({
      where: { id: saleId, status: 'OUT_FOR_DELIVERY' },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: by,
        ...(cashierId && { employeeId: cashierId }),
      },
    });
    if (claim.count === 0) return false;

    const logEmployeeId =
      cashierId ??
      order.employeeId ??
      (await tx.employee.findFirst({ where: { role: 'ADMIN' } }))?.id;
    if (!logEmployeeId) throw new Error('No employee found to process the order.');

    const lines = await tx.orderLine.findMany({ where: { saleId } });
    for (const line of lines) {
      await deductStockFIFOService(tx, line.productId, line.quantity);
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
          reason:        REASON[by],
          referenceId:   saleId,
          referenceType: 'SALE',
        },
        tx
      );
    }
    return true;
  });

  if (!claimed) return false;

  // Notifications + email (outside the transaction)
  const done = await prisma.saleRecord.findUnique({
    where: { id: saleId },
    include: { customer: true, orderLines: { include: { product: true } }, payment: true },
  });

  if (done?.customerId) {
    io.to(`user:${done.customerId}`).emit('order:completed', {
      orderId: saleId,
      message: `🎉 Your order ${saleId} has been completed!`,
    });
  }
  io.to('cashiers').emit('order:completed', {
    orderId: saleId,
    message:
      by === 'SYSTEM'
        ? `⏱️ Order ${saleId} was auto-completed (no customer confirmation in 24h).`
        : `✅ Order ${saleId} has been completed.`,
  });

  if (done?.customer?.email) {
    try {
      await sendOrderCompletedEmail({
        to:      done.customer.email,
        orderId: saleId,
        items:   done.orderLines.map((l) => ({
          name: l.product.productName, quantity: l.quantity, price: l.price,
        })),
        total:         done.totalAmount,
        paymentMethod: done.payment?.method ?? 'N/A',
      });
    } catch (err) {
      console.error('❌ Email failed:', err);
    }
  }
  return true;
}