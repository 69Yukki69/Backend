// controllers/returnRequest.controller.ts
//
// ONLINE RETURN → REPLACEMENT FLOW
//
//   PENDING → APPROVED → OUT_FOR_DELIVERY → COMPLETED
//      ↓          ↓
//   REJECTED   CANCELLED
//
//   1. Customer submits (reason + photo proof + cases/pieces)         → PENDING
//        order must be COMPLETED, online, and within 24h of completion
//   2. Cashier approves or rejects                                    → APPROVED | REJECTED
//        APPROVED = becomes an ACTIVE transaction (cashier + customer see it with the
//        exact cases/pieces to replace). OrderLine.returnedQty is locked in here so the
//        same items can't be returned twice. No stock change yet.
//   3. Cashier dispatches the replacement with a driver               → OUT_FOR_DELIVERY
//        THIS is the only moment inventory is deducted.
//   4. Replacement delivered, bad items collected                     → COMPLETED
//        RESELLABLE items go back to stock; DAMAGED / EXPIRED are not restocked.
//   *  Cashier can cancel an APPROVED request before dispatch         → CANCELLED
//
// QUANTITIES
//   Product.stock = full cases, Product.loosePieces = opened-case bottles (see util/stockPieces.ts).
//   OrderLine.quantity is in CASES; returnedQty / returnQty / receivedQty are in PIECES.
//   The API accepts { cases, pieces } and converts: total = cases × piecesPerCase + pieces.
//   Responses add returnCases/returnPieces (= replaceCases/replacePieces) per item.

import { Request, Response } from 'express';
import prisma from '../config/db';
import { io } from '../index';
import { createInventoryLog } from '../util/inventoryLogs';
import { assertCanFulfill, deductPieces, addPieces, StockError } from '../util/stockPieces';
import { ReturnReason, ReturnCondition, LossReason } from '../generated/prisma/client';

// ── Constants & helpers ───────────────────────────────────────────────────────

const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day after the order is completed
const MAX_PROOF_IMAGES = 5;
const CLOUDINARY_PREFIX = 'https://res.cloudinary.com/';

const VALID_RETURN_REASONS: ReturnReason[] = ['WRONG_ITEM_SENT', 'DAMAGED', 'EXPIRED', 'OTHER'];
const VALID_CONDITIONS: ReturnCondition[]  = ['RESELLABLE', 'DAMAGED', 'EXPIRED'];
const VALID_STATUSES = ['PENDING', 'APPROVED', 'OUT_FOR_DELIVERY', 'REJECTED', 'COMPLETED', 'CANCELLED'];

// Legacy PARTIALLY_RETURNED kept so old orders can still be returned
const RETURNABLE_SALE_STATUSES = ['COMPLETED', 'PARTIALLY_RETURNED'];
// One open request per sale at a time
const OPEN_REQUEST_STATUSES: ('PENDING' | 'APPROVED' | 'OUT_FOR_DELIVERY')[] =
  ['PENDING', 'APPROVED', 'OUT_FOR_DELIVERY'];
// Shown on the "active transactions" page
const ACTIVE_STATUSES: ('APPROVED' | 'OUT_FOR_DELIVERY')[] = ['APPROVED', 'OUT_FOR_DELIVERY'];
const STAFF_ROLES = ['CASHIER', 'ADMIN'];

// What the bad items are assumed to be when the cashier/driver doesn't say otherwise
const DEFAULT_CONDITION: Record<ReturnReason, ReturnCondition> = {
  WRONG_ITEM_SENT: 'RESELLABLE',
  DAMAGED:         'DAMAGED',
  EXPIRED:         'EXPIRED',
  OTHER:           'DAMAGED',
};

// Loss reason recorded when the replacement leaves our shelf (null = not a loss)
const DISPATCH_LOSS_REASON: Record<ReturnReason, LossReason | null> = {
  WRONG_ITEM_SENT: null,
  DAMAGED:         'DAMAGED',
  EXPIRED:         'EXPIRED',
  OTHER:           'OTHER',
};

const DRIVER_SELECT = { id: true, name: true, phone: true } as const;

// Item → order line → product, reused so every response can show cases + pieces
const ITEM_INCLUDE = {
  orderLine: {
    include: {
      product: {
        select: {
          id: true,
          productName: true,
          size: true,
          image: true,
          category: true,
          piecesPerCase: true,
        },
      },
    },
  },
} as const;

class ReturnError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const sendError = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof ReturnError || err instanceof StockError) {
    return res.status(err.status).json({ message: err.message });
  }
  // Serializable transaction conflict (same as placeOrder)
  if ((err as any)?.code === 'P2034') {
    return res.status(409).json({
      message: 'Stock changed while processing. Please try again.',
      retryable: true,
    });
  }
  res.status(500).json({ message: (err as Error)?.message || fallback });
};

const isStaff = (role: string) => STAFF_ROLES.includes(role);
const shortId = (id: string) => id.slice(0, 8);

/** Socket notification to the customer and to the cashiers room */ 
const notifyReturn = (
  rr: { id: string; customerId: string },
  status: string,
  customerMsg: string,
  staffMsg: string
) => {
  io.to(`user:${rr.customerId}`).emit('return:status', { returnId: rr.id, status, message: customerMsg });
  io.to('cashiers').emit('return:status', { returnId: rr.id, status, message: staffMsg });
};

// ── Quantity helpers (cases + pieces) ─────────────────────────────────────────

/** 36 pcs of a 24/case product → { cases: 1, pieces: 12 } */
const splitPieces = (total: number, piecesPerCase: number) => {
  const perCase = Math.max(1, piecesPerCase);
  return { cases: Math.floor(total / perCase), pieces: total % perCase };
};

/** 36 → "1 case + 12 pcs" (for messages and logs) */
const describeQty = (total: number, piecesPerCase: number) => {
  const { cases, pieces } = splitPieces(total, piecesPerCase);
  const parts: string[] = [];
  if (cases)            parts.push(`${cases} case${cases === 1 ? '' : 's'}`);
  if (pieces || !cases) parts.push(`${pieces} pc${pieces === 1 ? '' : 's'}`);
  return parts.join(' + ');
};

const isWholeNumber = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Turns { cases, pieces } (or a legacy total-piece `qty`) into total pieces.
 * cases and pieces both default to 0 when omitted.
 */
const resolvePieces = (
  input: { cases?: unknown; pieces?: unknown; qty?: unknown },
  piecesPerCase: number,
  label: string
): number => {
  const { cases, pieces, qty } = input;

  if (qty !== undefined && (cases !== undefined || pieces !== undefined)) {
    throw new ReturnError(`${label}: send either cases/pieces or a total piece count, not both.`);
  }
  if (qty !== undefined) {
    if (!isWholeNumber(qty)) {
      throw new ReturnError(`${label}: quantity must be a whole number, 0 or more.`);
    }
    return qty;
  }

  const c = cases  ?? 0;
  const p = pieces ?? 0;
  if (!isWholeNumber(c) || !isWholeNumber(p)) {
    throw new ReturnError(`${label}: cases and pieces must be whole numbers, 0 or more.`);
  }
  return c * piecesPerCase + p;
};

/**
 * Adds cases/pieces breakdowns to every item.
 * returnCases/returnPieces == replaceCases/replacePieces: the exact amount that must be replaced.
 */
const withBreakdown = <T extends { items: any[] }>(returnRequest: T) => ({
  ...returnRequest,
  items: returnRequest.items.map((it) => {
    const perCase   = it.orderLine.product.piecesPerCase as number;
    const requested = splitPieces(it.returnQty, perCase);
    const received  = it.receivedQty == null ? null : splitPieces(it.receivedQty, perCase);
    return {
      ...it,
      returnCases:    requested.cases,
      returnPieces:   requested.pieces,
      replaceCases:   requested.cases,
      replacePieces:  requested.pieces,
      receivedCases:  received ? received.cases  : null,
      receivedPieces: received ? received.pieces : null,
    };
  }),
});

// ── POST /returns ─────────────────────────────────────────────────────────────
/**
 * SUBMIT RETURN REQUEST (Customer only, online orders only)
 *
 * Body: {
 *   saleId:      string
 *   reason:      ReturnReason
 *   proofImages: string[]    // 1–5 Cloudinary URLs (photo proof)
 *   items:       [{ orderLineId: string, cases?: number, pieces?: number }]
 * }
 *   e.g. 1 case + 12 bottles → { orderLineId, cases: 1, pieces: 12 }
 *
 * Rules:
 *   - Customer must own the order, and it must be an ONLINE, COMPLETED order
 *   - Request must be made within 24h of the order's completedAt
 *   - Only one open (PENDING / APPROVED / OUT_FOR_DELIVERY) request per sale
 *   - Quantity (in pieces) cannot exceed what is still returnable per line
 *   - No stock/log changes here
 */
export const submitReturnRequest = async (req: Request, res: Response) => {
  const requester = (req as any).user as { id: string; role: string };
  const { saleId, reason, items, proofImages } = (req.body ?? {}) as {
    saleId:      string;
    reason:      ReturnReason;
    proofImages: string[];
    items:       { orderLineId: string; cases?: number; pieces?: number; returnQty?: number }[];
  };

  if (requester.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Only customers can submit return requests.' });
  }
  if (!saleId || !reason || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'saleId, reason, and items are required.' });
  }
  if (!VALID_RETURN_REASONS.includes(reason)) {
    return res.status(400).json({
      message: `Invalid reason. Must be one of: ${VALID_RETURN_REASONS.join(', ')}`,
    });
  }
  if (
    !Array.isArray(proofImages) ||
    proofImages.length < 1 ||
    proofImages.length > MAX_PROOF_IMAGES ||
    proofImages.some((u) => typeof u !== 'string' || !u.startsWith(CLOUDINARY_PREFIX))
  ) {
    return res.status(400).json({
      message: `Photo proof is required: upload 1 to ${MAX_PROOF_IMAGES} photos.`,
    });
  }
  if (items.some((i) => !i || typeof i.orderLineId !== 'string')) {
    return res.status(400).json({ message: 'Each item needs an orderLineId.' });
  }
  const lineIds = items.map((i) => i.orderLineId);
  if (new Set(lineIds).size !== lineIds.length) {
    return res.status(400).json({ message: 'Each order line can only appear once.' });
  }

  try {
    const returnRequest = await prisma.$transaction(async (tx) => {
      // ── 1. Fetch and validate sale ───────────────────────────────────────────
      const sale = await tx.saleRecord.findUnique({
        where:   { id: saleId },
        include: { orderLines: { include: { product: true } } },
      });

      if (!sale) throw new ReturnError('Order not found.', 404);
      if (sale.customerId !== requester.id) {
        throw new ReturnError('You can only request returns for your own orders.', 403);
      }
      if (sale.orderType !== 'ONLINE') {
        throw new ReturnError('Returns are only available for online orders.');
      }
      if (!RETURNABLE_SALE_STATUSES.includes(sale.status)) {
        throw new ReturnError(
          `Returns are only accepted for completed orders. Current status: ${sale.status}.`
        );
      }

      // ── 2. 1-day window, counted from completion ─────────────────────────────
      const completedAt = sale.completedAt ?? sale.updatedAt; // fallback for older orders
      if (Date.now() > completedAt.getTime() + RETURN_WINDOW_MS) {
        throw new ReturnError('The 1-day return window for this order has passed.');
      }

      // ── 3. One open request per sale ─────────────────────────────────────────
      const existingOpen = await tx.returnRequest.findFirst({
        where: { saleId, status: { in: OPEN_REQUEST_STATUSES } },
      });
      if (existingOpen) {
        throw new ReturnError('This order already has an open return request.');
      }

      // ── 4. Convert cases + pieces → total pieces and validate each line ──────
      const resolved: { orderLineId: string; pieces: number }[] = [];

      for (const item of items) {
        const line = sale.orderLines.find((l) => l.id === item.orderLineId);
        if (!line) {
          throw new ReturnError(`Order line ${item.orderLineId} not found on this order.`, 404);
        }

        const { product } = line;
        const label       = `"${product.productName}"`;
        const pieces      = resolvePieces(
          { cases: item.cases, pieces: item.pieces, qty: item.returnQty },
          product.piecesPerCase,
          label
        );
        if (pieces < 1) {
          throw new ReturnError(`Return quantity for ${label} must be at least 1 piece.`);
        }

        const maxReturnable = (line.quantity * product.piecesPerCase) - line.returnedQty;
        if (pieces > maxReturnable) {
          throw new ReturnError(
            `Cannot return ${describeQty(pieces, product.piecesPerCase)} of ${label}. ` +
            `Max returnable: ${describeQty(maxReturnable, product.piecesPerCase)} ` +
            `(${line.quantity} cases ordered, ${line.returnedQty} pcs already returned).`
          );
        }

        resolved.push({ orderLineId: item.orderLineId, pieces });
      }

      // ── 5. Create ReturnRequest + items (stored in pieces) ───────────────────
      return tx.returnRequest.create({
        data: {
          saleId,
          customerId: requester.id,
          reason,
          proofImages,
          status: 'PENDING',
          items: {
            create: resolved.map((r) => ({
              orderLineId: r.orderLineId,
              returnQty:   r.pieces,
            })),
          },
        },
        include: {
          items: { include: ITEM_INCLUDE },
          saleRecord: { select: { driver: { select: DRIVER_SELECT } } },
        },
      });
    });

    io.to('cashiers').emit('return:new', {
      returnId: returnRequest.id,
      saleId,
      message: `↩️ New return request for order ${saleId} is waiting for review.`,
    });

    res.status(201).json({
      message: 'Return request submitted. Awaiting cashier review.',
      returnRequest: withBreakdown(returnRequest),
    });
  } catch (err) {
    sendError(res, err, 'Failed to submit return request.');
  }
};

// ── PATCH /returns/:id ────────────────────────────────────────────────────────
/**
 * REVIEW RETURN REQUEST (Cashier / Admin)
 *
 * Body: { action: 'APPROVE' | 'REJECT', reviewNote?: string }   (note required on REJECT)
 *
 * REJECT  → REJECTED (final).
 * APPROVE → APPROVED. The request becomes an active transaction. Here we:
 *             - re-check each line is still returnable and lock it in (OrderLine.returnedQty +=)
 *           Stock is NOT checked or deducted here: approval can happen while we are out of stock,
 *           and dispatchReplacement is what refuses to send without enough stock.
 */
export const reviewReturnRequest = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const reviewer        = (req as any).user as { id: string; role: string };
  const { action, reviewNote } = (req.body ?? {}) as {
    action:      'APPROVE' | 'REJECT';
    reviewNote?: string;
  };

  if (!isStaff(reviewer.role)) {
    return res.status(403).json({ message: 'Only cashiers can review return requests.' });
  }
  if (!['APPROVE', 'REJECT'].includes(action)) {
    return res.status(400).json({ message: "action must be 'APPROVE' or 'REJECT'." });
  }
  const note = typeof reviewNote === 'string' ? reviewNote.trim() : '';
  if (action === 'REJECT' && !note) {
    return res.status(400).json({ message: 'A reason is required when rejecting a return request.' });
  }

  try {
    const returnRequest = await prisma.$transaction(async (tx) => {
      // Atomic claim: only one reviewer can move a request out of PENDING
      const claim = await tx.returnRequest.updateMany({
        where: { id: returnRequestId, status: 'PENDING' },
        data: {
          status:     action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          reviewedBy: reviewer.id,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });

      if (claim.count === 0) {
        const existing = await tx.returnRequest.findUnique({
          where:  { id: returnRequestId },
          select: { status: true },
        });
        if (!existing) throw new ReturnError('Return request not found.', 404);
        throw new ReturnError(
          `Return request has already been ${existing.status.toLowerCase().replace(/_/g, ' ')}.`,
          409
        );
      }

      const rr = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE } },
      });

      if (action === 'APPROVE') {
        for (const it of rr!.items) {
          const { orderLine } = it;
          const { product }   = orderLine;
          const maxTotal      = orderLine.quantity * product.piecesPerCase;

          // Lock the quantity in so the same pieces can't be returned again
          const lock = await tx.orderLine.updateMany({
            where: { id: orderLine.id, returnedQty: { lte: maxTotal - it.returnQty } },
            data:  { returnedQty: { increment: it.returnQty } },
          });
          if (lock.count === 0) {
            throw new ReturnError(
              `Cannot approve ${describeQty(it.returnQty, product.piecesPerCase)} of "${product.productName}": ` +
              `it would exceed the quantity ordered.`
            );
          }

          // NOTE: stock is intentionally NOT checked here. A valid complaint can be approved
          // even when the shelf is empty; dispatchReplacement refuses to send until we have stock.
        }
      }

      return rr!;
    });

    if (action === 'APPROVE') {
      notifyReturn(
        returnRequest,
        'APPROVED',
        `✅ Your return for order ${returnRequest.saleId} was approved. A replacement is being prepared.`,
        `✅ Return ${shortId(returnRequest.id)} approved. Replacement is ready to dispatch.`
      );
    } else {
      notifyReturn(
        returnRequest,
        'REJECTED',
        `❌ Your return for order ${returnRequest.saleId} was rejected: ${note}`,
        `🚫 Return ${shortId(returnRequest.id)} was rejected.`
      );
    }

    res.json({
      message:
        action === 'APPROVE'
          ? 'Return approved. It is now an active transaction awaiting dispatch.'
          : 'Return request rejected.',
      returnRequest: withBreakdown(returnRequest),
    });
  } catch (err) {
    sendError(res, err, 'Failed to review return request.');
  }
};

// ── Stock check for replacements ──────────────────────────────────────────────
type StockTx = Parameters<typeof assertCanFulfill>[0];

type Shortage = {
  productId:       string;
  productName:     string;
  neededPieces:    number;
  availablePieces: number;
  needed:          string;   // "1 case"
  available:       string;   // "0 pcs"
};

/** Total pieces needed per product (the same product can appear on several lines). */
const piecesNeededByProduct = (items: any[]) => {
  const need = new Map<string, { name: string; ppc: number; pieces: number }>();
  for (const it of items) {
    const p = it.orderLine.product;
    const cur = need.get(p.id) ?? { name: p.productName, ppc: p.piecesPerCase as number, pieces: 0 };
    cur.pieces += it.returnQty;
    need.set(p.id, cur);
  }
  return need;
};

/**
 * Which products can't be replaced from current stock (full cases + loose pieces)?
 * Uses assertCanFulfill, the same rule dispatch enforces, so the answers always agree.
 * Empty array = enough stock.
 */
const findShortages = async (db: StockTx, items: any[]): Promise<Shortage[]> => {
  const need = piecesNeededByProduct(items);
  const rows = await (db as any).product.findMany({
    where:  { id: { in: [...need.keys()] } },
    select: { id: true, stock: true, loosePieces: true, reservedStock: true },
  });

  const shortages: Shortage[] = [];
  for (const [productId, n] of need) {
    try {
      await assertCanFulfill(db, productId, n.pieces);
    } catch (err) {
      if (!(err instanceof StockError)) throw err;
      const row = rows.find((r: any) => r.id === productId);
      // Same rule as planDeduction: cases reserved for pending online orders can't be used,
      // loose bottles can. (stock - reserved) cases + loose pieces.
      const available = row
        ? Math.max(0, row.stock - row.reservedStock) * n.ppc + row.loosePieces
        : 0;
      shortages.push({
        productId,
        productName:     n.name,
        neededPieces:    n.pieces,
        availablePieces: available,
        needed:          describeQty(n.pieces, n.ppc),
        available:       describeQty(available, n.ppc),
      });
    }
  }
  return shortages;
};

/** Adds `fulfillment` to APPROVED requests so the cashier UI can disable Dispatch. Staff only. */
const attachFulfillment = async <T extends { status: string; items: any[] }>(list: T[]) =>
  Promise.all(
    list.map(async (r) => {
      if (r.status !== 'APPROVED') return { ...r, fulfillment: null };
      const shortages = await findShortages(prisma as unknown as StockTx, r.items);
      return { ...r, fulfillment: { canDispatch: shortages.length === 0, shortages } };
    })
  );

// ── PATCH /returns/:id/dispatch ───────────────────────────────────────────────
/**
 * DISPATCH THE REPLACEMENT (Cashier / Admin)
 *
 * Body: { driverId: string }
 *
 * APPROVED → OUT_FOR_DELIVERY, and THIS is where inventory is deducted:
 *   cases come out of `stock` (FIFO batches), leftover pieces come out of `loosePieces`
 *   (opening a case if there aren't enough loose bottles).
 *   WRONG_ITEM_SENT          → STOCK_OUT log
 *   DAMAGED / EXPIRED / OTHER → ADJUSTMENT log with lossReason (the replacement covers a loss)
 * All logs are in PIECES.
 */
export const dispatchReplacement = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const user            = (req as any).user as { id: string; role: string };
  const { driverId }    = (req.body ?? {}) as { driverId?: string };

  if (!isStaff(user.role)) {
    return res.status(403).json({ message: 'Only cashiers can dispatch replacements.' });
  }
  if (!driverId) {
    return res.status(400).json({ message: 'Select a driver before dispatching the replacement.' });
  }

  try {
    const returnRequest = await prisma.$transaction(async (tx) => {
      const driver = await tx.employee.findFirst({
        where:  { id: String(driverId), role: 'DRIVER', userStatus: 'ACTIVE' },
        select: DRIVER_SELECT,
      });
      if (!driver) throw new ReturnError('Invalid or inactive driver.');

      // Refuse to dispatch when we can't cover the replacement (cases + loose pieces).
      // Done before the claim so a refused dispatch changes nothing.
      const pre = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE } },
      });
      if (!pre) throw new ReturnError('Return request not found.', 404);

      const shortages = await findShortages(tx as unknown as StockTx, pre.items);
      if (shortages.length > 0) {
        const list = shortages
          .map((s) => `${s.productName}: need ${s.needed}, only ${s.available} in stock`)
          .join('; ');
        throw new ReturnError(`Not enough stock to send this replacement. ${list}.`, 409);
      }

      // Atomic claim: only one dispatch can ever win, so stock is deducted once
      const now   = new Date();
      const claim = await tx.returnRequest.updateMany({
        where: { id: returnRequestId, status: 'APPROVED' },
        data: {
          status:           'OUT_FOR_DELIVERY',
          driverId:         driver.id,
          outForDeliveryAt: now,
          stockDeductedAt:  now,
        },
      });
      if (claim.count === 0) {
        const existing = await tx.returnRequest.findUnique({
          where:  { id: returnRequestId },
          select: { status: true },
        });
        if (!existing) throw new ReturnError('Return request not found.', 404);
        throw new ReturnError(
          `Only approved requests can be dispatched. Current status: ${existing.status}.`,
          409
        );
      }

      const rr = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE }, driver: { select: DRIVER_SELECT } },
      });

      const lossReason = DISPATCH_LOSS_REASON[rr!.reason];

      for (const it of rr!.items) {
        const { product } = it.orderLine;

        await deductPieces(tx, product.id, it.returnQty);

        await createInventoryLog(
          {
            productId:     product.id,
            employeeId:    user.id,
            quantity:      -it.returnQty, // negative, in pieces
            type:          lossReason ? 'ADJUSTMENT' : 'STOCK_OUT',
            unit:          'PIECE',
            reason:        `Replacement dispatched — ${describeQty(it.returnQty, product.piecesPerCase)} ` +
                           `(customer reason: ${rr!.reason})`,
            lossReason:    lossReason ?? undefined,
            referenceId:   rr!.saleId,
            referenceType: 'RETURN',
          },
          tx
        );
      }

      return rr!;
    }, { isolationLevel: 'Serializable' });

    notifyReturn(
      returnRequest,
      'OUT_FOR_DELIVERY',
      `🚚 Your replacement for order ${returnRequest.saleId} is out for delivery with ${returnRequest.driver?.name}!`,
      `🚚 Replacement ${shortId(returnRequest.id)} is out for delivery.`
    );

    res.json({
      message: 'Replacement is out for delivery. Inventory deducted.',
      returnRequest: withBreakdown(returnRequest),
    });
  } catch (err) {
    sendError(res, err, 'Failed to dispatch replacement.');
  }
};

// ── PATCH /returns/:id/complete ───────────────────────────────────────────────
/**
 * COMPLETE THE RETURN (Cashier / Admin, or the driver assigned to it)
 * Replacement delivered and the customer's bad items collected.
 *
 * Body (all optional): {
 *   items?: [{ itemId, cases?, pieces?, condition? }]
 *   closeNote?: string
 * }
 *   - Items NOT listed are assumed fully collected, in the condition implied by the
 *     customer's reason (wrong item → RESELLABLE, damaged → DAMAGED, expired → EXPIRED).
 *   - An item that IS listed uses what you send; no cases/pieces (or 0) = not collected.
 *   - Collected quantity can't be more than what was replaced.
 *
 * Stock effect (the replacement was already deducted at dispatch):
 *   RESELLABLE        → pieces go back to stock, RETURN_IN log
 *   DAMAGED / EXPIRED → nothing, they are not restocked
 */
export const completeReturn = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const user            = (req as any).user as { id: string; role: string };
  const { items, closeNote } = (req.body ?? {}) as {
    items?: {
      itemId:       string;
      cases?:       number;
      pieces?:      number;
      receivedQty?: number;
      condition?:   ReturnCondition;
    }[];
    closeNote?: string;
  };

  if (!isStaff(user.role) && user.role !== 'DRIVER') {
    return res.status(403).json({ message: 'You are not allowed to complete return requests.' });
  }
  if (items !== undefined) {
    if (!Array.isArray(items) || items.some((i) => !i || typeof i.itemId !== 'string')) {
      return res.status(400).json({ message: 'Each item needs an itemId.' });
    }
    if (new Set(items.map((i) => i.itemId)).size !== items.length) {
      return res.status(400).json({ message: 'Each item can only appear once.' });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const rr = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE } },
      });

      if (!rr) throw new ReturnError('Return request not found.', 404);
      if (user.role === 'DRIVER' && rr.driverId !== user.id) {
        throw new ReturnError('This return is not assigned to you.', 403);
      }
      if (rr.status !== 'OUT_FOR_DELIVERY') {
        throw new ReturnError(
          `Only requests that are out for delivery can be completed. Current status: ${rr.status}.`,
          409
        );
      }

      const byItemId = new Map((items ?? []).map((i) => [i.itemId, i]));
      for (const id of byItemId.keys()) {
        if (!rr.items.some((it) => it.id === id)) {
          throw new ReturnError(`Item ${id} does not belong to this return request.`);
        }
      }

      // ── Work out what was collected, and in what condition ──────────────────
      const collected = new Map<string, { pieces: number; condition: ReturnCondition }>();

      for (const it of rr.items) {
        const product = it.orderLine.product;
        const label   = `"${product.productName}"`;
        const input   = byItemId.get(it.id);

        const pieces = input
          ? resolvePieces(
              { cases: input.cases, pieces: input.pieces, qty: input.receivedQty },
              product.piecesPerCase,
              label
            )
          : it.returnQty;

        if (pieces > it.returnQty) {
          throw new ReturnError(
            `Collected quantity for ${label} (${describeQty(pieces, product.piecesPerCase)}) ` +
            `is more than the replaced ${describeQty(it.returnQty, product.piecesPerCase)}.`
          );
        }

        const condition = input?.condition ?? DEFAULT_CONDITION[rr.reason];
        if (pieces > 0 && !VALID_CONDITIONS.includes(condition)) {
          throw new ReturnError(
            `Invalid condition for ${label}. Must be one of: ${VALID_CONDITIONS.join(', ')}`
          );
        }
        collected.set(it.id, { pieces, condition });
      }

      // ── Atomic claim: stops double processing ───────────────────────────────
      const claim = await tx.returnRequest.updateMany({
        where: { id: returnRequestId, status: 'OUT_FOR_DELIVERY' },
        data: {
          status:     'COMPLETED',
          closedById: user.id,
          closedAt:   new Date(),
          closeNote:  closeNote ?? null,
        },
      });
      if (claim.count === 0) {
        throw new ReturnError('This return request was already processed.', 409);
      }

      let restockedPcs = 0;
      let notRestockedPcs = 0;

      for (const it of rr.items) {
        const { pieces, condition } = collected.get(it.id)!;
        const { product } = it.orderLine;

        if (pieces > 0 && condition === 'RESELLABLE') {
          await addPieces(tx, product.id, pieces);
          await createInventoryLog(
            {
              productId:     product.id,
              employeeId:    user.id,
              quantity:      pieces, // positive, in pieces
              type:          'RETURN_IN',
              unit:          'PIECE',
              reason:        `Return collected — resellable, ${describeQty(pieces, product.piecesPerCase)} ` +
                             `(customer reason: ${rr.reason})`,
              referenceId:   rr.saleId,
              referenceType: 'RETURN',
            },
            tx
          );
          restockedPcs += pieces;
        } else {
          notRestockedPcs += pieces;
        }

        await tx.returnRequestItem.update({
          where: { id: it.id },
          data:  { receivedQty: pieces, condition: pieces > 0 ? condition : null },
        });
      }

      const completed = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE } },
      });

      return { returnRequest: completed!, restockedPcs, notRestockedPcs };
    }, { isolationLevel: 'Serializable' });

    notifyReturn(
      result.returnRequest,
      'COMPLETED',
      `🎉 Your return for order ${result.returnRequest.saleId} is complete.`,
      `✅ Return ${shortId(result.returnRequest.id)} completed.`
    );

    res.json({
      message:
        `Return completed. ${result.restockedPcs} pcs restocked, ` +
        `${result.notRestockedPcs} pcs not restocked.`,
      ...result,
      returnRequest: withBreakdown(result.returnRequest),
    });
  } catch (err) {
    sendError(res, err, 'Failed to complete return request.');
  }
};

// ── PATCH /returns/:id/cancel ─────────────────────────────────────────────────
/**
 * CANCEL AN APPROVED RETURN (Cashier / Admin)
 * Only before dispatch (e.g. customer unreachable, item can't be replaced).
 * Releases the quantities locked at approval. No stock changes, since none were made.
 *
 * Body: { closeNote?: string }
 */
export const cancelReturnRequest = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const user            = (req as any).user as { id: string; role: string };
  const { closeNote }   = (req.body ?? {}) as { closeNote?: string };

  if (!isStaff(user.role)) {
    return res.status(403).json({ message: 'Only cashiers can cancel return requests.' });
  }

  try {
    const returnRequest = await prisma.$transaction(async (tx) => {
      const claim = await tx.returnRequest.updateMany({
        where: { id: returnRequestId, status: 'APPROVED' },
        data: {
          status:     'CANCELLED',
          closedById: user.id,
          closedAt:   new Date(),
          closeNote:  closeNote ?? null,
        },
      });

      if (claim.count === 0) {
        const existing = await tx.returnRequest.findUnique({
          where:  { id: returnRequestId },
          select: { status: true },
        });
        if (!existing) throw new ReturnError('Return request not found.', 404);
        throw new ReturnError(
          `Only approved requests that haven't been dispatched can be cancelled. Current status: ${existing.status}.`,
          409
        );
      }

      const rr = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: true },
      });

      // Give back the returnable quantity that approval locked in
      for (const it of rr!.items) {
        const release = await tx.orderLine.updateMany({
          where: { id: it.orderLineId, returnedQty: { gte: it.returnQty } },
          data:  { returnedQty: { decrement: it.returnQty } },
        });
        if (release.count === 0) {
          throw new ReturnError('Could not release the returned quantity. Please contact support.', 409);
        }
      }
      return rr!;
    });

    notifyReturn(
      returnRequest,
      'CANCELLED',
      `❌ Your return for order ${returnRequest.saleId} was cancelled by the store.`,
      `🚫 Return ${shortId(returnRequest.id)} was cancelled.`
    );

    res.json({ message: 'Return request cancelled.' });
  } catch (err) {
    sendError(res, err, 'Failed to cancel return request.');
  }
};

// ── GET /returns/active ───────────────────────────────────────────────────────
/**
 * ACTIVE RETURN TRANSACTIONS (APPROVED or OUT_FOR_DELIVERY)
 * What the cashier's active-transactions page and the customer's active-orders page show.
 *   - cashier / admin: all of them
 *   - customer:        only their own
 *   - driver:          only the ones assigned to them
 * Each item carries replaceCases / replacePieces = the exact amount to replace.
 *
 * NOTE: register this route BEFORE GET /returns/:id.
 */
export const getActiveReturns = async (req: Request, res: Response) => {
  const requester = (req as any).user as { id: string; role: string };

  const where: Record<string, unknown> = { status: { in: ACTIVE_STATUSES } };
  if (requester.role === 'CUSTOMER') where.customerId = requester.id;
  else if (requester.role === 'DRIVER') where.driverId = requester.id;
  else if (!isStaff(requester.role)) {
    return res.status(403).json({ message: 'Not allowed.' });
  }

  try {
    const requests = await prisma.returnRequest.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true } },
        reviewer: { select: { id: true, name: true } },
        driver:   { select: DRIVER_SELECT },
        saleRecord: { select: { id: true, status: true, completedAt: true } },
        items:    { include: ITEM_INCLUDE },
      },
    });

    const out = requests.map((r) => withBreakdown(r));
    res.json(isStaff(requester.role) ? await attachFulfillment(out) : out);
  } catch (err) {
    sendError(res, err, 'Failed to fetch active returns.');
  }
};

// ── GET /returns ──────────────────────────────────────────────────────────────
/**
 * LIST RETURN REQUESTS
 * Customers only ever see their own. Drivers only their assigned ones.
 * Staff can filter by customerId.
 *
 * Query params: status, customerId, saleId, from, to, page (default 1), limit (default 20, max 50)
 */
export const getReturnRequests = async (req: Request, res: Response) => {
  try {
    const requester = (req as any).user as { id: string; role: string };

    const page   = Math.max(1, Number(req.query.page)  || 1);
    const limit  = Math.min(50, Number(req.query.limit) || 20);
    const skip   = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const saleId = req.query.saleId as string | undefined;
    const from   = req.query.from   as string | undefined;
    const to     = req.query.to     as string | undefined;
    const customerId =
      requester.role === 'CUSTOMER' ? requester.id : (req.query.customerId as string | undefined);

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
    }

    const where: Record<string, unknown> = {};
    if (status)     where.status     = status;
    if (customerId) where.customerId = customerId;
    if (saleId)     where.saleId     = saleId;
    if (requester.role === 'DRIVER') where.driverId = requester.id;
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
          customer: { select: { id: true, name: true, phone: true, email: true, image: true } },
          reviewer: { select: { id: true, name: true, role: true } },
          driver:   { select: DRIVER_SELECT },
          saleRecord: {
            select: {
              id: true, status: true, totalAmount: true, saleDate: true, createdAt: true,
              completedAt: true,
              driver: { select: DRIVER_SELECT },
            },
          },
          items: { include: ITEM_INCLUDE },
        },
      }),
      prisma.returnRequest.count({ where }),
    ]);

    const list = requests.map((r) => withBreakdown(r));
    res.json({
      requests: isStaff(requester.role) ? await attachFulfillment(list) : list,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch return requests.');
  }
};

// ── GET /returns/:id ──────────────────────────────────────────────────────────
/**
 * GET SINGLE RETURN REQUEST
 * Full detail including proof photos, items, reviewer, driver and linked sale.
 * Customers can only open their own; drivers only ones assigned to them.
 */
export const getReturnRequestById = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const requester       = (req as any).user as { id: string; role: string };

  try {
    const returnRequest = await prisma.returnRequest.findUnique({
      where:   { id: returnRequestId },
      include: {
        customer:   { select: { id: true, name: true, email: true, phone: true, address: true } },
        reviewer:   { select: { id: true, name: true, role: true } },
        driver:     { select: DRIVER_SELECT },
        saleRecord: {
          select: {
            id: true, status: true, totalAmount: true, completedAt: true,
            driver: { select: DRIVER_SELECT },
          },
        },
        items: { include: ITEM_INCLUDE },
      },
    });

    const hidden =
      !returnRequest ||
      (requester.role === 'CUSTOMER' && returnRequest.customer.id !== requester.id) ||
      (requester.role === 'DRIVER'   && returnRequest.driverId !== requester.id);

    if (hidden) {
      return res.status(404).json({ message: 'Return request not found.' });
    }

    const detail = withBreakdown(returnRequest);
    res.json({
      returnRequest: isStaff(requester.role) ? (await attachFulfillment([detail]))[0] : detail,
    });
  } catch (err) {
    sendError(res, err, 'Failed to fetch return request.');
  }
};

// ── PATCH /returns/:id/received ───────────────────────────────────────────────
/**
 * CUSTOMER CONFIRMS THE REPLACEMENT ARRIVED (Customer only)
 *
 * OUT_FOR_DELIVERY stays the status; we only stamp `receivedAt`.
 * The driver/cashier then calls PATCH /returns/:id/complete to record the
 * collected bad items (restocking RESELLABLE ones), which moves it to COMPLETED.
 *
 * Why not complete here? completeReturn restocks collected bottles, and only the
 * driver/cashier can say what was physically collected and in what condition.
 */
export const confirmReplacementReceived = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const user            = (req as any).user as { id: string; role: string };

  if (user.role !== 'CUSTOMER') {
    return res.status(403).json({ message: 'Only the customer can confirm receipt.' });
  }

  try {
    const returnRequest = await prisma.$transaction(async (tx) => {
      // Atomic claim: owner + still out for delivery + not confirmed yet
      const claim = await tx.returnRequest.updateMany({
        where: {
          id:         returnRequestId,
          customerId: user.id,
          status:     'OUT_FOR_DELIVERY',
          receivedAt: null,
        },
        data: { receivedAt: new Date() },
      });

      if (claim.count === 0) {
        const existing = await tx.returnRequest.findUnique({
          where:  { id: returnRequestId },
          select: { status: true, customerId: true, receivedAt: true },
        });
        if (!existing || existing.customerId !== user.id) {
          throw new ReturnError('Return request not found.', 404);
        }
        if (existing.receivedAt) {
          throw new ReturnError('You already confirmed receiving this replacement.', 409);
        }
        throw new ReturnError(
          `You can confirm only after the replacement is out for delivery. Current status: ${existing.status}.`,
          409
        );
      }

      return tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE }, driver: { select: DRIVER_SELECT } },
      });
    });

    const rr = returnRequest!;
    const staffMsg =
      `📦 Customer confirmed receiving replacement ${shortId(rr.id)}. Collect the bad items to complete it.`;

    io.to('cashiers').emit('return:received', { returnId: rr.id, message: staffMsg });
    if (rr.driverId) {
      io.to(`user:${rr.driverId}`).emit('return:received', { returnId: rr.id, message: staffMsg });
    }

    res.json({
      message: 'Thanks! Replacement receipt confirmed.',
      returnRequest: withBreakdown(rr),
    });
  } catch (err) {
    sendError(res, err, 'Failed to confirm replacement receipt.');
  }
};