// controllers/returnRequest.controller.ts
//
// ONLINE RETURN FLOW
//   1. Customer submits a request    → PENDING
//        order must be COMPLETED / PARTIALLY_RETURNED and within 24h of completion
//   2. Cashier approves or rejects   → APPROVED | REJECTED   (no stock changes yet)
//   3. Customer brings the items; cashier inspects each line → COMPLETED
//        RESELLABLE        → stock +=, RETURN_IN log
//        DAMAGED / EXPIRED → NOT restocked. The replacement leaves our shelf,
//                            so stock -=, ADJUSTMENT log with a lossReason
//   4. Cashier can close an approved request the customer never fulfils → CANCELLED
//
// QUANTITIES: cases and/or pieces (bottles)
//   OrderLine.quantity is in CASES. Everything else (stock, returnQty, receivedQty,
//   returnedQty) is stored in PIECES. The API accepts { cases, pieces } and converts:
//     total pieces = cases × product.piecesPerCase + pieces
//   e.g. 1 case + 12 bottles of a 24/case product → { cases: 1, pieces: 12 } = 36 pcs.
//   Responses add returnCases / returnPieces / receivedCases / receivedPieces to each item.
//   (A plain total-piece field — returnQty on submit, receivedQty on receive — still works.)

import { Request, Response } from 'express';
import prisma from '../config/db';
import { createInventoryLog } from '../util/inventoryLogs';
import { ReturnReason, ReturnCondition, LossReason } from '../generated/prisma/client';

// ── Constants & helpers ───────────────────────────────────────────────────────

const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000; // 1 day after the order is completed

const VALID_RETURN_REASONS: ReturnReason[] = ['WRONG_ITEM_SENT', 'DAMAGED', 'EXPIRED', 'OTHER'];
const VALID_CONDITIONS: ReturnCondition[]  = ['RESELLABLE', 'DAMAGED', 'EXPIRED'];
const VALID_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'];
const RETURNABLE_SALE_STATUSES = ['COMPLETED', 'PARTIALLY_RETURNED'];
const OPEN_REQUEST_STATUSES: ('PENDING' | 'APPROVED')[] = ['PENDING', 'APPROVED'];
const STAFF_ROLES = ['CASHIER', 'ADMIN'];

// Driver who delivered the order — shown on return requests for accountability
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
  if (err instanceof ReturnError) {
    return res.status(err.status).json({ message: err.message });
  }
  res.status(500).json({ message: (err as Error)?.message || fallback });
};

const isStaff = (role: string) => STAFF_ROLES.includes(role);

// ── Quantity helpers (cases + pieces) ─────────────────────────────────────────

/** 36 pcs of a 24/case product → { cases: 1, pieces: 12 } */
const splitPieces = (total: number, piecesPerCase: number) => {
  const perCase = Math.max(1, piecesPerCase);
  return { cases: Math.floor(total / perCase), pieces: total % perCase };
};

/** 36 → "1 case + 12 pcs" (for error messages) */
const describeQty = (total: number, piecesPerCase: number) => {
  const { cases, pieces } = splitPieces(total, piecesPerCase);
  const parts: string[] = [];
  if (cases)           parts.push(`${cases} case${cases === 1 ? '' : 's'}`);
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

/** Adds returnCases/returnPieces/receivedCases/receivedPieces to every item */
const withBreakdown = <T extends { items: any[] }>(returnRequest: T) => ({
  ...returnRequest,
  items: returnRequest.items.map((it) => {
    const perCase = it.orderLine.product.piecesPerCase as number;
    const requested = splitPieces(it.returnQty, perCase);
    const received  = it.receivedQty == null ? null : splitPieces(it.receivedQty, perCase);
    return {
      ...it,
      returnCases:    requested.cases,
      returnPieces:   requested.pieces,
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
 *   saleId: string
 *   reason: ReturnReason
 *   items:  [{ orderLineId: string, cases?: number, pieces?: number }]
 * }
 *   e.g. 1 case + 12 bottles → { orderLineId, cases: 1, pieces: 12 }
 *   (legacy: returnQty = total pieces still works instead of cases/pieces)
 *
 * Rules:
 *   - Customer must own the order, and it must be an ONLINE order
 *   - Sale must be COMPLETED or PARTIALLY_RETURNED
 *   - Request must be made within 24h of the order's completedAt
 *   - Only one open (PENDING or APPROVED) request per sale at a time
 *   - Quantity (in pieces) cannot exceed what is still returnable per line
 *   - No stock/log changes here
 */
export const submitReturnRequest = async (req: Request, res: Response) => {
  const requester = (req as any).user as { id: string; role: string };
  const { saleId, reason, items } = req.body as {
    saleId: string;
    reason: ReturnReason;
    items:  { orderLineId: string; cases?: number; pieces?: number; returnQty?: number }[];
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
 * Body: { action: 'APPROVE' | 'REJECT', reviewNote?: string }
 *
 * No stock or log changes. APPROVE means "bring the items in";
 * stock only moves when the items are received (see receiveReturnedItems).
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

  try {
    // Atomic claim: only one reviewer can move a request out of PENDING
    const claim = await prisma.returnRequest.updateMany({
      where: { id: returnRequestId, status: 'PENDING' },
      data: {
        status:     action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewedBy: reviewer.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote ?? null,
      },
    });

    if (claim.count === 0) {
      const existing = await prisma.returnRequest.findUnique({
        where:  { id: returnRequestId },
        select: { status: true },
      });
      if (!existing) throw new ReturnError('Return request not found.', 404);
      throw new ReturnError(`Return request has already been ${existing.status.toLowerCase()}.`, 409);
    }

    const returnRequest = await prisma.returnRequest.findUnique({
      where:   { id: returnRequestId },
      include: { items: { include: ITEM_INCLUDE } },
    });

    res.json({
      message:
        action === 'APPROVE'
          ? 'Return approved. Waiting for the customer to bring the items.'
          : 'Return request rejected.',
      returnRequest: returnRequest ? withBreakdown(returnRequest) : null,
    });
  } catch (err) {
    sendError(res, err, 'Failed to review return request.');
  }
};

// ── PATCH /returns/:id/receive ────────────────────────────────────────────────
/**
 * RECEIVE & INSPECT RETURNED ITEMS (Cashier / Admin)
 *
 * Body: {
 *   items: [{ itemId: string, cases?: number, pieces?: number, condition?: ReturnCondition }]
 *   closeNote?: string
 * }
 *   e.g. customer brought 1 case + 12 bottles, all damaged:
 *        { itemId, cases: 1, pieces: 12, condition: 'DAMAGED' }
 *   (legacy: receivedQty = total pieces still works instead of cases/pieces)
 *
 * - Every item on the request must be listed. No cases/pieces (or 0) = not brought.
 * - Received quantity can be less than what was approved, never more.
 * - condition is required when something was received (one condition per item).
 *
 * Per line:
 *   RESELLABLE        → stock += pieces,  RETURN_IN log
 *   DAMAGED / EXPIRED → stock -= pieces,  ADJUSTMENT log (lossReason set).
 *                       The damaged pieces are not restocked; the replacement we
 *                       hand over is what reduces our inventory.
 *
 * Then OrderLine.returnedQty += pieces, sale status recalculated, request → COMPLETED.
 */
export const receiveReturnedItems = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const receiver        = (req as any).user as { id: string; role: string };
  const { items, closeNote } = (req.body ?? {}) as {
    items: {
      itemId:       string;
      cases?:       number;
      pieces?:      number;
      receivedQty?: number;
      condition?:   ReturnCondition;
    }[];
    closeNote?: string;
  };

  if (!isStaff(receiver.role)) {
    return res.status(403).json({ message: 'Only cashiers can receive returned items.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'items are required.' });
  }
  if (items.some((i) => !i || typeof i.itemId !== 'string')) {
    return res.status(400).json({ message: 'Each item needs an itemId.' });
  }
  const itemIds = items.map((i) => i.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    return res.status(400).json({ message: 'Each item can only appear once.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const returnRequest = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE } },
      });

      if (!returnRequest) throw new ReturnError('Return request not found.', 404);
      if (returnRequest.status !== 'APPROVED') {
        throw new ReturnError(
          `Only approved requests can be received. Current status: ${returnRequest.status}.`,
          409
        );
      }

      // ── Validate the inspection covers exactly this request's items ──────────
      const byItemId = new Map(items.map((i) => [i.itemId, i]));
      for (const id of byItemId.keys()) {
        if (!returnRequest.items.some((it) => it.id === id)) {
          throw new ReturnError(`Item ${id} does not belong to this return request.`);
        }
      }
      for (const it of returnRequest.items) {
        if (!byItemId.has(it.id)) {
          throw new ReturnError(
            `Missing inspection result for "${it.orderLine.product.productName}". ` +
            `List it with no quantity (or 0) if it was not brought.`
          );
        }
      }

      // ── Convert cases + pieces → total pieces, validate each line ────────────
      const inspections = new Map<string, { pieces: number; condition: ReturnCondition }>();

      for (const it of returnRequest.items) {
        const input   = byItemId.get(it.id)!;
        const product = it.orderLine.product;
        const label   = `"${product.productName}"`;

        const pieces = resolvePieces(
          { cases: input.cases, pieces: input.pieces, qty: input.receivedQty },
          product.piecesPerCase,
          label
        );
        if (pieces > it.returnQty) {
          throw new ReturnError(
            `Received quantity for ${label} (${describeQty(pieces, product.piecesPerCase)}) ` +
            `is more than the approved ${describeQty(it.returnQty, product.piecesPerCase)}.`
          );
        }
        if (pieces > 0 && !VALID_CONDITIONS.includes(input.condition as ReturnCondition)) {
          throw new ReturnError(
            `condition is required for ${label}. Must be one of: ${VALID_CONDITIONS.join(', ')}`
          );
        }

        inspections.set(it.id, { pieces, condition: input.condition as ReturnCondition });
      }

      if ([...inspections.values()].every((i) => i.pieces === 0)) {
        throw new ReturnError('Nothing was received. Cancel the request instead.');
      }

      // ── Atomic claim: stops double processing ────────────────────────────────
      const claim = await tx.returnRequest.updateMany({
        where: { id: returnRequestId, status: 'APPROVED' },
        data: {
          status:     'COMPLETED',
          closedById: receiver.id,
          closedAt:   new Date(),
          closeNote:  closeNote ?? null,
        },
      });
      if (claim.count === 0) {
        throw new ReturnError('This return request was already processed.', 409);
      }

      let restockedPcs  = 0;
      let writtenOffPcs = 0;

      for (const it of returnRequest.items) {
        const { pieces: qty, condition } = inspections.get(it.id)!;
        const { orderLine } = it;
        const { product }   = orderLine;

        if (qty === 0) {
          await tx.returnRequestItem.update({ where: { id: it.id }, data: { receivedQty: 0 } });
          continue;
        }

        // Track returned qty on the order line (guarded against over-returning)
        const maxTotal   = orderLine.quantity * product.piecesPerCase;
        const lineUpdate = await tx.orderLine.updateMany({
          where: { id: orderLine.id, returnedQty: { lte: maxTotal - qty } },
          data:  { returnedQty: { increment: qty } },
        });
        if (lineUpdate.count === 0) {
          throw new ReturnError(
            `Cannot receive ${describeQty(qty, product.piecesPerCase)} of "${product.productName}": ` +
            `it would exceed the quantity ordered.`
          );
        }

        if (condition === 'RESELLABLE') {
          // ── Back to inventory ────────────────────────────────────────────────
          await tx.product.update({
            where: { id: product.id },
            data:  { stock: { increment: qty } },
          });
          await createInventoryLog(
            {
              productId:     product.id,
              employeeId:    receiver.id,
              quantity:      qty, // positive, in pieces
              type:          'RETURN_IN',
              reason:        `Return received — resellable, ${describeQty(qty, product.piecesPerCase)} ` +
                             `(customer reason: ${returnRequest.reason})`,
              referenceId:   returnRequest.saleId,
              referenceType: 'RETURN',
            },
            tx
          );
          restockedPcs += qty;
        } else {
          // ── Loss: not restocked; the replacement comes out of our stock ──────
          const lossReason: LossReason = condition === 'EXPIRED' ? 'EXPIRED' : 'DAMAGED';

          const deducted = await tx.product.updateMany({
            where: { id: product.id, stock: { gte: qty } },
            data:  { stock: { decrement: qty } },
          });
          if (deducted.count === 0) {
            throw new ReturnError(
              `Not enough stock of "${product.productName}" to issue the replacement ` +
              `(${describeQty(qty, product.piecesPerCase)} needed). Restock first, then try again.`,
              409
            );
          }
          await createInventoryLog(
            {
              productId:     product.id,
              employeeId:    receiver.id,
              quantity:      -qty, // negative, in pieces
              type:          'ADJUSTMENT',
              reason:        `Return received — ${condition.toLowerCase()}, ` +
                             `${describeQty(qty, product.piecesPerCase)} not restocked; replacement issued`,
              lossReason,
              referenceId:   returnRequest.saleId,
              referenceType: 'RETURN',
            },
            tx
          );
          writtenOffPcs += qty;
        }

        await tx.returnRequestItem.update({
          where: { id: it.id },
          data:  { receivedQty: qty, condition },
        });
      }

      // ── Recalculate sale status ────────────────────────────────────────────
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

      const completed = await tx.returnRequest.findUnique({
        where:   { id: returnRequestId },
        include: { items: { include: ITEM_INCLUDE } },
      });

      return { returnRequest: completed, newSaleStatus, restockedPcs, writtenOffPcs };
    });

    res.json({
      message:
        `Return completed. ${result.restockedPcs} pcs restocked, ` +
        `${result.writtenOffPcs} pcs written off (replacement issued).`,
      ...result,
      returnRequest: result.returnRequest ? withBreakdown(result.returnRequest) : null,
    });
  } catch (err) {
    sendError(res, err, 'Failed to receive returned items.');
  }
};

// ── PATCH /returns/:id/cancel ─────────────────────────────────────────────────
/**
 * CANCEL AN APPROVED RETURN (Cashier / Admin)
 * For when the customer never brings the items. No stock changes.
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
    const claim = await prisma.returnRequest.updateMany({
      where: { id: returnRequestId, status: 'APPROVED' },
      data: {
        status:     'CANCELLED',
        closedById: user.id,
        closedAt:   new Date(),
        closeNote:  closeNote ?? null,
      },
    });

    if (claim.count === 0) {
      const existing = await prisma.returnRequest.findUnique({
        where:  { id: returnRequestId },
        select: { status: true },
      });
      if (!existing) throw new ReturnError('Return request not found.', 404);
      throw new ReturnError(
        `Only approved requests awaiting items can be cancelled. Current status: ${existing.status}.`,
        409
      );
    }

    res.json({ message: 'Return request cancelled.' });
  } catch (err) {
    sendError(res, err, 'Failed to cancel return request.');
  }
};

// ── GET /returns ──────────────────────────────────────────────────────────────
/**
 * LIST RETURN REQUESTS
 * Customers only ever see their own. Staff can filter by customerId.
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

    res.json({
      requests: requests.map((r) => withBreakdown(r)),
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
 * Full detail including items, product info, reviewer, and linked sale status.
 * Customers can only open their own.
 */
export const getReturnRequestById = async (req: Request, res: Response) => {
  const returnRequestId = String(req.params.id);
  const requester       = (req as any).user as { id: string; role: string };

  try {
    const returnRequest = await prisma.returnRequest.findUnique({
      where:   { id: returnRequestId },
      include: {
        customer:   { select: { id: true, name: true, email: true } },
        reviewer:   { select: { id: true, name: true, role: true } },
        saleRecord: {
          select: {
            id: true, status: true, totalAmount: true, completedAt: true,
            driver: { select: DRIVER_SELECT },
          },
        },
        items: { include: ITEM_INCLUDE },
      },
    });

    if (!returnRequest || (requester.role === 'CUSTOMER' && returnRequest.customer.id !== requester.id)) {
      return res.status(404).json({ message: 'Return request not found.' });
    }

    res.json({ returnRequest: withBreakdown(returnRequest) });
  } catch (err) {
    sendError(res, err, 'Failed to fetch return request.');
  }
};