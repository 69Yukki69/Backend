import { Request, Response } from 'express';
import prisma from '../config/db';
import { LossReason } from '../generated/prisma/client';
import { createInventoryLog } from '../util/inventoryLogs';

const VALID_LOSS_REASONS: LossReason[] = [
  'EXPIRED',
  'DAMAGED',
  'THEFT',
  'COUNT_ERROR',
  'OTHER',
];

// ── POST /loss-reports ────────────────────────────────────────────────────────
/**
 * FILE A LOSS REPORT
 *
 * Body: { productId, quantity, lossReason, reason? }
 *
 * Rules:
 *   - quantity must be a positive number (we store it as negative in the log)
 *   - lossReason must be a valid LossReason enum value
 *   - quantity cannot exceed current product.stock
 *   - Appends an ADJUSTMENT log (negative quantity) — never modifies existing logs
 *   - Decrements product.stock by the reported quantity
 */
export const fileLossReport = async (req: Request, res: Response) => {
  const { productId, quantity, lossReason, reason } = req.body;
  const requester = (req as any).user as { id: string; role: string };

  // ── Input validation ────────────────────────────────────────────────────────
  if (!productId) {
    return res.status(400).json({ message: 'productId is required.' });
  }
  if (!quantity || typeof quantity !== 'number' || quantity < 1) {
    return res.status(400).json({ message: 'quantity must be a positive number.' });
  }
  if (!lossReason || !VALID_LOSS_REASONS.includes(lossReason)) {
    return res.status(400).json({
      message: `lossReason must be one of: ${VALID_LOSS_REASONS.join(', ')}.`,
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error('Product not found.');

      if (product.stock < quantity) {
        throw new Error(
          `Cannot report loss of ${quantity} pcs. Current stock is only ${product.stock} pcs.`
        );
      }

      // Deduct stock
      await tx.product.update({
        where: { id: productId },
        data:  { stock: { decrement: quantity } },
      });

      // Append ADJUSTMENT log with lossReason — existing logs are never touched
      const log = await createInventoryLog(
        {
          productId,
          employeeId:    requester.id,
          quantity:      -quantity,   // negative = stock leaving
          type:          'ADJUSTMENT',
          lossReason,
          reason:        reason ?? lossReason,
          referenceType: 'MANUAL',
        },
        tx
      );

      return { product, log };
    });

    res.status(201).json({
      message:     `Loss of ${quantity} pcs reported for "${result.product.productName}".`,
      productName: result.product.productName,
      quantity,
      lossReason,
      newStock:    result.product.stock - quantity,
    });
  } catch (err: any) {
    const isKnown =
      err?.message?.includes('not found') ||
      err?.message?.includes('Cannot report loss');
    res.status(isKnown ? 400 : 500).json({ message: err?.message || 'Failed to file loss report.' });
  }
};

// ── GET /loss-reports ─────────────────────────────────────────────────────────
/**
 * LIST LOSS REPORTS
 *
 * Query params:
 *   - lossReason  filter by reason (EXPIRED, DAMAGED, etc.)
 *   - productId   filter by product
 *   - from        ISO date string — start of date range
 *   - to          ISO date string — end of date range
 *   - page        default 1
 *   - limit       default 20, max 50
 */
export const getLossReports = async (req: Request, res: Response) => {
  try {
    const page       = Math.max(1, Number(req.query.page)  || 1);
    const limit      = Math.min(50, Number(req.query.limit) || 20);
    const skip       = (page - 1) * limit;
    const lossReason = req.query.lossReason as LossReason | undefined;
    const productId  = req.query.productId  as string | undefined;
    const from       = req.query.from       as string | undefined;
    const to         = req.query.to         as string | undefined;

    const where: Record<string, unknown> = {
      type: 'ADJUSTMENT',  // loss reports are always ADJUSTMENT logs
    };

    if (lossReason && VALID_LOSS_REASONS.includes(lossReason)) {
      where.lossReason = lossReason;
    }
    if (productId) where.productId = productId;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      };
    }

    const [logs, total] = await Promise.all([
      prisma.inventoryLog.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product:  { select: { productName: true, category: true } },
          employee: { select: { name: true, role: true } },
        },
      }),
      prisma.inventoryLog.count({ where }),
    ]);

    // Normalize quantity to positive for display (it's stored as negative)
    const formatted = logs.map((log) => ({
      ...log,
      quantity: Math.abs(log.quantity),
    }));

    res.json({
      logs:       formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch loss reports.' });
  }
};

// ── GET /loss-reports/summary ─────────────────────────────────────────────────
/**
 * LOSS SUMMARY — total pieces lost grouped by lossReason
 * Useful for a dashboard widget showing where losses are coming from.
 */
export const getLossReportSummary = async (req: Request, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to   = req.query.to   as string | undefined;

    const dateFilter = (from || to)
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        }
      : {};

    const grouped = await prisma.inventoryLog.groupBy({
      by:    ['lossReason'],
      where: { type: 'ADJUSTMENT', lossReason: { not: null }, ...dateFilter },
      _sum:  { quantity: true },
      _count: { id: true },
    });

    const summary = grouped.map((g) => ({
      lossReason:    g.lossReason,
      totalIncidents: g._count.id,
      totalPiecesLost: Math.abs(g._sum.quantity ?? 0),
    }));

    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch loss summary.' });
  }
};