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
export const fileLossReport = async (req: Request, res: Response) => {
  const { productId, quantity, lossReason, reason } = req.body;
  const requester = (req as any).user as { id: string; role: string };

  if (!productId)
    return res.status(400).json({ message: 'productId is required.' });
  if (!quantity || typeof quantity !== 'number' || quantity < 1)
    return res.status(400).json({ message: 'quantity must be a positive number.' });
  if (!lossReason || !VALID_LOSS_REASONS.includes(lossReason))
    return res.status(400).json({
      message: `lossReason must be one of: ${VALID_LOSS_REASONS.join(', ')}.`,
    });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error('Product not found.');

      if (product.stock < quantity)
        throw new Error(
          `Cannot report loss of ${quantity} pcs. Current stock is only ${product.stock} pcs.`
        );

      await tx.product.update({
        where: { id: productId },
        data:  { stock: { decrement: quantity } },
      });

      const log = await createInventoryLog(
        {
          productId,
          employeeId:    requester.id,
          quantity:      -quantity,        // negative = loss
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
      type:       'ADJUSTMENT',
      lossReason: { not: null },   // ← excludes stock resets, keeps only real losses
    };

    if (lossReason && VALID_LOSS_REASONS.includes(lossReason))
      where.lossReason = lossReason;
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
          product:  { select: { productName: true, category: true, size: true, image: true } },
          employee: { select: { name: true, role: true } },
        },
      }),
      prisma.inventoryLog.count({ where }),
    ]);

    // Keep quantity negative so frontend can display it as a loss (no Math.abs)
    res.json({
      logs,
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
      _sum:   { quantity: true },
      _count: { id: true },
    });

    const summary = grouped.map((g) => ({
      lossReason:      g.lossReason,
      totalIncidents:  g._count.id,
      totalPiecesLost: Math.abs(g._sum.quantity ?? 0), // abs here is fine — summary always shows positive
    }));

    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch loss summary.' });
  }
};