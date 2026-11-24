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

// Manual deduction (Expired / Damaged / Audit Correction):
// lowers batch `remaining`, earliest expiry first.
// Does NOT throw if batches hold less than requested (old data may be out of sync).
// Returns the number of cases that no batch could cover.
export const deductBatchesForAdjustmentService = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productId: string,
  qtyCases: number
) => {
  let left = Math.floor(qtyCases);
  if (left <= 0) return 0;

  const batches = await tx.stockBatch.findMany({
    where: { productId, remaining: { gt: 0 } },
    orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }],
  });

  for (const batch of batches) {
    if (left <= 0) break;
    const deduct = Math.min(batch.remaining, left);
    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { remaining: { decrement: deduct } },
    });
    left -= deduct;
  }
  return left;
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

export const getAllActiveBatchesService = () =>
  prisma.stockBatch.findMany({
    where: { remaining: { gt: 0 } },
    orderBy: { expiryDate: "asc" },
    select: { id: true, productId: true, remaining: true, expiryDate: true, receivedAt: true },
  });

export const updateBatchExpiryService = async (id: string, expiryDate: Date | null) =>
  prisma.stockBatch.update({ where: { id }, data: { expiryDate } });

// Write off ONE expired batch (stock manager presses "Deduct" on the Expiration tab):
// zeros the batch, decrements the product's stock, logs ADJUSTMENT / EXPIRED.
// Product stock is clamped at 0 in case old data was out of sync with the batches.
export const writeOffBatchService = async (batchId: string, employeeId: string) => {
  const logId = await generateId("inventoryLog");

  return prisma.$transaction(async (tx) => {
    const batch = await tx.stockBatch.findUnique({
      where: { id: batchId },
      include: { product: true },
    });
    if (!batch) throw new Error("BATCH_NOT_FOUND");
    if (batch.remaining <= 0) throw new Error("BATCH_EMPTY");

    // Same rule as the page: expired only once the expiry DAY has passed
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    if (!batch.expiryDate || batch.expiryDate >= startOfToday) throw new Error("BATCH_NOT_EXPIRED");

    const qty = batch.remaining;
    // Product stock is clamped at 0 in case old data was out of sync with the batches
    const productDeduct = Math.min(qty, Math.max(0, batch.product.stock));
    const shortfall     = qty - productDeduct; // cases the batch held that the product total did not

    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { remaining: 0 },
    });

    if (productDeduct > 0) {
      await tx.product.update({
        where: { id: batch.productId },
        data: { stock: { decrement: productDeduct } },
      });

      // The log must match what actually left product.stock, otherwise the
      // inventory log total drifts away from the stock (this was the Kasalo Coke bug).
      await tx.inventoryLog.create({
        data: {
          id: logId,
          productId: batch.productId,
          employeeId,
          quantity: -productDeduct, // negative = loss (matches loss-report entries)
          type: "ADJUSTMENT",
          lossReason: "EXPIRED",
          reason:
            `Expired batch written off (${batch.id})` +
            (shortfall > 0 ? ` — batch held ${qty} but product stock only allowed ${productDeduct}` : ""),
          referenceId: batch.id,
          referenceType: "STOCK_BATCH",
        },
      });
    }

    return { batchId: batch.id, productId: batch.productId, writtenOff: qty, productDeducted: productDeduct, shortfall };
  });
};