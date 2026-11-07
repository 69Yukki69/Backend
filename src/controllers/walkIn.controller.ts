// Add this to your orders controller (or a new file next to it).
// Imports match the ones already used in your order controller.
import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

const VAT_RATE = 0.12;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ── POST /orders/walk-in  (cashier / admin only) ──────────────────────────────
// Walk-in = customer without an account. The cashier fills the order, the
// customer PAYS AT THE COUNTER, and the order is then delivered.
//
// This follows the same lifecycle as an online order:
//   PENDING → (PROCESSING) → OUT_FOR_DELIVERY → COMPLETED
// Differences:
//   - no customer account (customerId = null, details kept on the sale)
//   - payment is already collected when the order is created
//   - the CASHIER marks it COMPLETED (see the guard in updateOrderStatus),
//     because there is no customer account to confirm receipt
//   - stock is RESERVED now; it is deducted when the order is COMPLETED
//     (existing FEFO + inventory log code, unchanged).
export const placeWalkInOrder = async (req: Request, res: Response) => {
  const { items, paymentMethod, cashGiven, gcashRef, walkInName, walkInPhone, walkInAddress } = req.body;
  const requester = (req as any).user as { id: string; role: string };

  if (!requester || requester.role === 'CUSTOMER') {
    return res.status(403).json({ message: 'Only staff can place walk-in orders.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Cart is empty.' });
  }

  const name = String(walkInName ?? '').trim();
  if (!name) {
    return res.status(400).json({ message: 'Customer name is required for walk-in orders.' });
  }
  const address = String(walkInAddress ?? '').trim();
  if (!address) {
    return res.status(400).json({ message: 'Delivery address is required for walk-in orders.' });
  }

  // Merge duplicate products and validate quantities
  const qtyByProduct = new Map<string, number>();
  for (const it of items) {
    const qty = Number(it?.quantity);
    if (!it?.productId || !Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ message: 'Invalid item in cart.' });
    }
    qtyByProduct.set(it.productId, (qtyByProduct.get(it.productId) ?? 0) + qty);
  }

  const method = paymentMethod === 'gcash' ? 'GCASH' : 'CASH';
  const ref = String(gcashRef ?? '').replace(/\D/g, '');
  if (method === 'GCASH' && ref.length !== 13) {
    return res.status(400).json({ message: 'A valid 13-digit GCash reference number is required.' });
  }

  try {
    const sale = await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        let subtotal = 0;
        const lines: { productId: string; quantity: number; price: number }[] = [];

        // 1. Validate stock + compute price on the SERVER (never trust client prices)
        for (const [productId, quantity] of qtyByProduct) {
          const product = await tx.product.findUnique({ where: { id: productId } });
          if (!product) throw new Error(`Product not found: ${productId}`);
          if (product.status === 'INACTIVE') {
            throw new Error(`"${product.productName}" is no longer available.`);
          }

          const available = product.stock - product.reservedStock;
          if (available < quantity) {
            throw new Error(
              `Insufficient stock for "${product.productName}". ` +
                `Available: ${available} cases, requested: ${quantity} cases.`
            );
          }

          const promo = await tx.promotionSale.findFirst({
            where: {
              productId,
              isActive: true,
              dateEffective: { lte: now },
              lastDate: { gte: now },
            },
          });
          const price = promo?.alteredPrice ?? product.price;

          subtotal += price * quantity;
          lines.push({ productId, quantity, price });
        }

        const totalAmount = round2(subtotal + subtotal * VAT_RATE);

        // 2. Cash handling (customer pays at the counter)
        let amountTendered: number | null = null;
        let change: number | null = null;
        if (method === 'CASH') {
          const given = Number(cashGiven);
          if (!Number.isFinite(given) || given + 0.005 < totalAmount) {
            throw new Error('Cash given is less than the total amount.');
          }
          amountTendered = round2(given);
          change = round2(given - totalAmount);
        }

        // 3. Sale record: paid at the counter, starts as PENDING like an online order
        const saleId = await generateId('saleRecord');
        const created = await tx.saleRecord.create({
          data: {
            id: saleId,
            employeeId: requester.id,
            customerId: null,
            orderType: 'WALK_IN',
            walkInName: name,
            walkInPhone: String(walkInPhone ?? '').trim() || null,
            walkInAddress: address,
            totalAmount,
            discount: 0,
            status: 'PENDING',
          },
        });

        // 4. Order lines + RESERVE stock (deducted when the order is COMPLETED)
        for (const l of lines) {
          await tx.orderLine.create({
            data: {
              saleId,
              productId: l.productId,
              quantity: l.quantity,
              price: l.price,
              subtotal: l.price * l.quantity,
            },
          });

          await tx.product.update({
            where: { id: l.productId },
            data: { reservedStock: { increment: l.quantity } },
          });
        }

        // 5. Payment (already collected)
        await tx.payment.create({
          data: {
            id: await generateId('payment'),
            saleId,
            amount: totalAmount,
            method,
            amountTendered,
            change,
            referenceNo: method === 'GCASH' ? ref : null,
            paidAt: now,
          },
        });

        return { id: created.id, totalAmount, change };
      },
      { isolationLevel: 'Serializable' }
    );

    res.status(201).json({
      message: 'Walk-in order placed.',
      saleId: sale.id,
      totalAmount: sale.totalAmount,
      change: sale.change,
    });
  } catch (err: any) {
    if (err?.code === 'P2034') {
      return res.status(409).json({ message: 'Order conflict detected. Please try again.', retryable: true });
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: 'That GCash reference number was already used.' });
    }
    const isKnown =
      err?.message?.includes('Insufficient stock') ||
      err?.message?.includes('Cash given') ||
      err?.message?.includes('not found') ||
      err?.message?.includes('no longer available');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to place walk-in order.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH to your EXISTING updateOrderStatus (orders controller).
// Put this right after the "customers can only mark as COMPLETED or CANCELLED"
// guard block. It makes COMPLETED a cashier action for walk-in orders only,
// and keeps online orders confirmed by the customer who received them.
//
//   // ── Guard: staff can only complete WALK-IN orders ────────────────────────
//   if (status === 'COMPLETED' && requester.role !== 'CUSTOMER' && order.orderType !== 'WALK_IN') {
//     return res.status(403).json({
//       message: 'Online orders can only be completed by the customer who received them.',
//     });
//   }
//
// Everything else in updateOrderStatus already works for walk-ins: socket
// notifications and the email are skipped when customerId / customer.email is null.
// ─────────────────────────────────────────────────────────────────────────────