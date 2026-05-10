import prisma from "../config/db";
import { generateId, generateIds } from "../util/generateId";
import { createInventoryLog } from "../util/inventoryLogs";
import { CreateDeliveryDTO, UpdateDeliveryDTO } from "../dto/delivery.dto";

export const createDeliveryService = async (data: CreateDeliveryDTO) => {
  const deliveryId = await generateId("delivery");

  return await prisma.delivery.create({
    data: {
      id: deliveryId,
      supplierId: data.supplierId,
      deliveryDate: new Date(data.deliveryDate),
      totalItems: data.totalItems,
      notes: data.notes,
      items: {
        create: await Promise.all(
          data.items.map(async (item) => ({
            id: await generateId("deliveryItem"),
            productId: item.productId,
            orderedQty: item.quantity,
            receivedQty: 0,
            returnedQty: 0,
            costPrice: item.costPrice,
          }))
        ),
      },
    },
    include: { items: true, supplier: true },
  });
};

export const getAllDeliveriesService = async () => {
  return await prisma.delivery.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        include: { product: true }, // ← include product so frontend gets productName
      },
      supplier: true,
    },
  });
};

export const getDeliveryByIdService = async (id: string) => {
  return await prisma.delivery.findUnique({
    where: { id },
    include: {
      items: {
        include: { product: true },
      },
      supplier: true,
    },
  });
};

export const updateDeliveryService = async (
  id: string,
  data: UpdateDeliveryDTO
) => {
  return await prisma.delivery.update({
    where: { id },
    data,
  });
};

// Called when items are physically received — updates stock + logs inventory
export const receiveDeliveryItemsService = async (
  deliveryId: string,
  employeeId: string,
  receivedItems: {
    deliveryItemId: string;
    receivedQty: number;
    expiryDate?: string | null;
  }[]
) => {
  // ── FIX: Do NOT pre-generate log IDs outside the transaction.
  //    generateIds reads the DB max outside the tx, causing duplicate-ID
  //    collisions under concurrency (or when inventoryLog uses seq-based IDs).
  //    Instead, delegate to createInventoryLog() inside the tx — it uses the
  //    auto-increment seq to assign a collision-free ID every time.

  return await prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error("Delivery not found");
    }

    for (const received of receivedItems) {
      const deliveryItem = await tx.deliveryItem.findFirst({
        where: { id: received.deliveryItemId, deliveryId },
      });

      if (!deliveryItem) {
        throw new Error(`DeliveryItem ${received.deliveryItemId} not found`);
      }

      if (received.receivedQty <= 0) {
        throw new Error("Received quantity must be greater than 0");
      }

      if (received.receivedQty + deliveryItem.receivedQty > deliveryItem.orderedQty) {
        throw new Error("Received quantity exceeds ordered quantity");
      }

      // ── Update delivery item: receivedQty + expiryDate ──────────────────
      await tx.deliveryItem.update({
        where: { id: received.deliveryItemId },
        data: {
          receivedQty: { increment: received.receivedQty },
          ...(received.expiryDate !== undefined && {
            expiryDate: received.expiryDate ? new Date(received.expiryDate) : null,
          }),
        },
      });

      // ── Upsert stock batch (handles partial receives on same item) ───────
      const batchId = await generateId("stockBatch");
      await tx.stockBatch.upsert({
        where: { deliveryItemId: received.deliveryItemId },
        create: {
          id: batchId,
          productId: deliveryItem.productId,
          deliveryItemId: received.deliveryItemId,
          quantity: received.receivedQty,
          remaining: received.receivedQty,
          expiryDate: received.expiryDate ? new Date(received.expiryDate) : null,
        },
        update: {
          quantity:  { increment: received.receivedQty },
          remaining: { increment: received.receivedQty },
          ...(received.expiryDate !== undefined && {
            expiryDate: received.expiryDate ? new Date(received.expiryDate) : null,
          }),
        },
      });

      // ── Update product stock ─────────────────────────────────────────────
      await tx.product.update({
        where: { id: deliveryItem.productId },
        data: { stock: { increment: received.receivedQty } },
      });

      // ── FIX: use createInventoryLog() so ID is assigned via auto-increment
      //    seq — same pattern used everywhere else in the codebase.
      //    The old direct tx.inventoryLog.create with a pre-generated ID
      //    was the source of silent transaction rollbacks.
      await createInventoryLog(
        {
          productId:     deliveryItem.productId,
          employeeId,
          quantity:      received.receivedQty,
          type:          "STOCK_IN",
          reason:        "Received from supplier delivery",
          referenceId:   deliveryId,
          referenceType: "DELIVERY",
        },
        tx
      );
    }

    // ── Update delivery status based on received quantities ──────────────
    const allItems = await tx.deliveryItem.findMany({ where: { deliveryId } });
    const allFullyReceived = allItems.every((i) => i.receivedQty >= i.orderedQty);
    const anyReceived      = allItems.some((i) => i.receivedQty > 0);

    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        status: allFullyReceived
          ? "DELIVERED"
          : anyReceived
          ? "PARTIALLY_RECEIVED"
          : "PENDING",
      },
    });

    return tx.delivery.findUnique({
      where: { id: deliveryId },
      include: {
        items: {
          include: { product: true },
        },
        supplier: true,
      },
    });
  });
};

// Returns all delivery items expiring within the next `days` days
export const getExpiringItemsService = async (days: number = 30) => {
  const now = new Date();
  const threshold = new Date();
  threshold.setDate(now.getDate() + days);

  return await prisma.deliveryItem.findMany({
    where: {
      expiryDate: {
        gte: now,
        lte: threshold,
      },
    },
    include: {
      product: true,
      delivery: {
        include: { supplier: true },
      },
    },
    orderBy: { expiryDate: "asc" },
  });
};

// Returns all delivery items that are already expired
export const getExpiredItemsService = async () => {
  return await prisma.deliveryItem.findMany({
    where: {
      expiryDate: {
        lt: new Date(),
      },
    },
    include: {
      product: true,
      delivery: {
        include: { supplier: true },
      },
    },
    orderBy: { expiryDate: "asc" },
  });
};

// Returns the earliest expiry date per product (for dashboard warnings)
export const getProductExpiryStatusService = async () => {
  return await prisma.deliveryItem.groupBy({
    by: ["productId"],
    _min: { expiryDate: true },
    where: { expiryDate: { not: null } },
  });
};

export const deleteDeliveryService = async (id: string) => {
  return await prisma.delivery.delete({
    where: { id },
  });
};