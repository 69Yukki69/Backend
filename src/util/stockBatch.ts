import prisma from "../config/db";
import { generateId } from "../util/generateId";

// FEFO deduction — called during sales
// Deducts from batches ordered by earliest expiry first
export const deductStockFIFOService = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string,
  qtyNeeded: number
) => {
  const batches = await tx.stockBatch.findMany({
    where: {
      productId,
      remaining: { gt: 0 },
    },
    orderBy: [
      { expiryDate: "asc" },  // FEFO: earliest expiry first, nulls last
      { receivedAt: "asc" },  // fallback: oldest batch first
    ],
  });

  let left = qtyNeeded;
  for (const batch of batches) {
    if (left <= 0) break;
    const deduct = Math.min(batch.remaining, left);
    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { remaining: { decrement: deduct } },
    });
    left -= deduct;
  }

  if (left > 0) throw new Error(`Insufficient batch stock for product ${productId}`);
};

// Get all active batches for a product (remaining > 0)
export const getStockBatchesByProductService = async (productId: string) => {
  return await prisma.stockBatch.findMany({
    where: { productId, remaining: { gt: 0 } },
    orderBy: { expiryDate: "asc" },
    include: {
      deliveryItem: {
        include: { delivery: true },
      },
    },
  });
};

// Get all batches expiring within N days (default 30)
export const getExpiringBatchesService = async (days: number = 30) => {
  const now = new Date();
  const threshold = new Date();
  threshold.setDate(now.getDate() + days);

  return await prisma.stockBatch.findMany({
    where: {
      remaining: { gt: 0 },
      expiryDate: { gte: now, lte: threshold },
    },
    include: {
      product: true,
      deliveryItem: {
        include: { delivery: true },
      },
    },
    orderBy: { expiryDate: "asc" },
  });
};

// Get all expired batches that still have remaining stock (need write-off)
export const getExpiredBatchesService = async () => {
  return await prisma.stockBatch.findMany({
    where: {
      remaining: { gt: 0 },
      expiryDate: { lt: new Date() },
    },
    include: {
      product: true,
      deliveryItem: {
        include: { delivery: true },
      },
    },
    orderBy: { expiryDate: "asc" },
  });
};

// Write off all expired batches:
// zeros remaining + decrements product stock + logs ADJUSTMENT/EXPIRED
export const writeOffExpiredBatchesService = async (employeeId: string) => {
  const expiredBatches = await prisma.stockBatch.findMany({
    where: {
      remaining: { gt: 0 },
      expiryDate: { lt: new Date() },
    },
  });

  if (expiredBatches.length === 0) return { written: 0, totalQty: 0 };

  let totalQty = 0;

  await prisma.$transaction(async (tx) => {
    for (const batch of expiredBatches) {
      const logId = await generateId("inventoryLog");

      await tx.stockBatch.update({
        where: { id: batch.id },
        data: { remaining: 0 },
      });

      await tx.product.update({
        where: { id: batch.productId },
        data: { stock: { decrement: batch.remaining } },
      });

      await tx.inventoryLog.create({
        data: {
          id: logId,
          productId: batch.productId,
          employeeId,
          quantity: batch.remaining,
          type: "ADJUSTMENT",
          lossReason: "EXPIRED",
          referenceId: batch.id,
          referenceType: "STOCK_BATCH",
        },
      });

      totalQty += batch.remaining;
    }
  });

  return { written: expiredBatches.length, totalQty };
};