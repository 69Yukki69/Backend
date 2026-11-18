import { Request, Response } from 'express';
import prisma from '../config/db';

// GET /api/reorder/suggestions
// Query params:
//   windowDays  — sales lookback period (default 30)
//   bufferDays  — safety stock buffer, in days of cover (default 7)
//
// UNITS: Product.stock and normal sale logs are in CASES. Return/replacement logs are in
// PIECES (InventoryLog.unit = 'PIECE'). Pieces are converted to cases below so everything
// in this report is in cases.
export const getReorderSuggestions = async (req: Request, res: Response) => {
  try {
    const windowDays  = Math.max(1, Number(req.query.windowDays) || 30);
    const bufferDays  = Math.max(0, Number(req.query.bufferDays) || 7);
    const supplierId  = req.query.supplierId as string | undefined;

    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    // Group by unit too, so cases and pieces are never added together
    const logs = await prisma.inventoryLog.groupBy({
      by: ['productId', 'type', 'unit'],
      where: {
        createdAt: { gte: since },
        type: { in: ['STOCK_OUT', 'RETURN_IN'] },
      },
      _sum: { quantity: true },
    });

    const salesMap = new Map<string, {
      stockOutCases: number; stockOutPieces: number;
      returnInCases: number; returnInPieces: number;
    }>();

    for (const log of logs) {
      const entry = salesMap.get(log.productId) || {
        stockOutCases: 0, stockOutPieces: 0, returnInCases: 0, returnInPieces: 0,
      };
      const qty = log._sum.quantity || 0;
      const isPiece = log.unit === 'PIECE';

      if (log.type === 'STOCK_OUT') {
        if (isPiece) entry.stockOutPieces += qty; else entry.stockOutCases += qty;
      }
      if (log.type === 'RETURN_IN') {
        if (isPiece) entry.returnInPieces += qty; else entry.returnInCases += qty;
      }
      salesMap.set(log.productId, entry);
    }

    const productIds = Array.from(salesMap.keys());
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        ...(supplierId ? { supplierId } : {}),
      },
      select: {
        id: true, productName: true, category: true, size: true,
        price: true, costPrice: true, stock: true, reservedStock: true,
        piecesPerCase: true, status: true,
      },
    });

    const suggestions = products.map((p) => {
      const movement = salesMap.get(p.id)!;
      const perCase  = Math.max(1, p.piecesPerCase);

      // Everything in cases. Stock-out logs are stored as negative numbers in some code paths
      // and positive in others, so take the absolute value of each total.
      const stockOut = Math.abs(movement.stockOutCases) + Math.abs(movement.stockOutPieces) / perCase;
      const returnIn = Math.abs(movement.returnInCases) + Math.abs(movement.returnInPieces) / perCase;

      const netUnitsSold = Math.max(0, stockOut - returnIn);
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
        netUnitsSold: Number(netUnitsSold.toFixed(2)),
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