import { Request, Response } from 'express';
import prisma from '../config/db';

// GET /api/inventory/logs — paginated inventory movement log
export const getInventoryLogs = async (req: Request, res: Response) => {
  try {
    const page     = Math.max(1, Number(req.query.page)  || 1);
    const limit    = Math.min(50, Number(req.query.limit) || 20);
    const skip     = (page - 1) * limit;
    const type     = req.query.type     as string | undefined;
    const product  = req.query.product  as string | undefined;

    const where: Record<string, unknown> = {};
    if (type)    where.type      = type;
    if (product) where.productId = product;

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

    res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch inventory logs.' });
  }
};