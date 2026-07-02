import { Request, Response } from 'express';
import prisma from '../config/db';

// GET /api/reorder/suggestions
// Query params:
//   windowDays  — sales lookback period (default 30)
//   bufferDays  — safety stock buffer, in days of cover (default 7)
export const getReorderSuggestions = async (req: Request, res: Response) => {
  try {
    const windowDays  = Math.max(1, Number(req.query.windowDays) || 30);
    const bufferDays  = Math.max(0, Number(req.query.bufferDays) || 7);
    const supplierId  = req.query.supplierId as string | undefined; // ← new

    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const logs = await prisma.inventoryLog.groupBy({
      by: ['productId', 'type'],
      where: {
        createdAt: { gte: since },
        type: { in: ['STOCK_OUT', 'RETURN_IN'] },
      },
      _sum: { quantity: true },
    });

    const salesMap = new Map<string, { stockOut: number; returnIn: number }>();
    for (const log of logs) {
      const entry = salesMap.get(log.productId) || { stockOut: 0, returnIn: 0 };
      const qty = log._sum.quantity || 0;
      if (log.type === 'STOCK_OUT') entry.stockOut += qty;
      if (log.type === 'RETURN_IN') entry.returnIn += qty;
      salesMap.set(log.productId, entry);
    }

    const productIds = Array.from(salesMap.keys());
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        ...(supplierId ? { supplierId } : {}), // ← new
      },
      select: {
        id: true, productName: true, category: true, size: true,
        price: true, costPrice: true, stock: true, reservedStock: true,
        piecesPerCase: true, status: true,
      },
    });

    const suggestions = products.map((p) => {
      const movement = salesMap.get(p.id)!;
      const netUnitsSold = Math.max(0, movement.stockOut - movement.returnIn);
      const dailyVelocity = netUnitsSold / windowDays;

      const availableStock = p.stock - p.reservedStock;
      const reorderPoint = dailyVelocity * bufferDays;
      const needsReorder = availableStock <= reorderPoint;

      const daysOfStockLeft = dailyVelocity > 0
        ? Number((availableStock / dailyVelocity).toFixed(1))
        : null;

      const unitProfit = p.costPrice != null ? p.price - p.costPrice : null;
      const totalProfitWindow = unitProfit != null ? Number((unitProfit * netUnitsSold).toFixed(2)) : null;

      // Suggested qty: cover the next `windowDays` of sales minus what's on hand
      const suggestedUnits = Math.max(0, Math.ceil(dailyVelocity * windowDays - availableStock));
      const suggestedCases = p.piecesPerCase > 0
        ? Math.ceil(suggestedUnits / p.piecesPerCase)
        : null;

      let urgency: 'high' | 'medium' | 'low' = 'low';
      if (daysOfStockLeft !== null) {
        if (daysOfStockLeft <= 3) urgency = 'high';
        else if (daysOfStockLeft <= bufferDays) urgency = 'medium';
      }

      return {
        productId: p.id,
        productName: p.productName,
        category: p.category,
        size: p.size,
        stock: p.stock,
        availableStock,
        netUnitsSold,
        dailyVelocity: Number(dailyVelocity.toFixed(2)),
        reorderPoint: Number(reorderPoint.toFixed(2)),
        daysOfStockLeft,
        needsReorder,
        urgency,
        unitProfit,
        totalProfitWindow,
        suggestedUnits,
        suggestedCases,
      };
    });

    // Sort: needs-reorder first, then by total profit contributed (nulls last)
    suggestions.sort((a, b) => {
      if (a.needsReorder !== b.needsReorder) return a.needsReorder ? -1 : 1;
      const aProfit = a.totalProfitWindow ?? -Infinity;
      const bProfit = b.totalProfitWindow ?? -Infinity;
      return bProfit - aProfit;
    });

    res.json({
      windowDays,
      bufferDays,
      count: suggestions.length,
      suggestions,
    });
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to compute reorder suggestions.' });
  }
};