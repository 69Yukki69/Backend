import prisma from "../config/db";
import { generateId, generateIds } from "../util/generateId";
import { createInventoryLog } from "../util/inventoryLogs";
import { CreateDeliveryDTO, UpdateDeliveryDTO } from "../dto/delivery.dto";

const MAX_ID_RETRIES = 3;

export const createDeliveryService = async (data: CreateDeliveryDTO) => {
  // generateId/generateIds read the current max ID from the DB and don't reserve it,
  // so IDs must be allocated in ONE batch (never in parallel via Promise.all),
  // and the insert is retried if a concurrent request grabbed the same number (P2002).
  for (let attempt = 1; attempt <= MAX_ID_RETRIES; attempt++) {
    try {
      const deliveryId = await generateId("delivery");
      const itemIds = await generateIds("deliveryItem", data.items.length);

      return await prisma.delivery.create({
        data: {
          id: deliveryId,
          supplierId: data.supplierId,
          deliveryDate: new Date(data.deliveryDate),
          totalItems: data.totalItems,
          notes: data.notes,
          items: {
            create: data.items.map((item, i) => ({
              id: itemIds[i],
              productId: item.productId,
              orderedQty: item.quantity,
              receivedQty: 0,
              returnedQty: 0,
              costPrice: item.costPrice,
            })),
          },
        },
        include: { items: true, supplier: true },
      });
    } catch (e: any) {
      if (e?.code !== "P2002" || attempt === MAX_ID_RETRIES) throw e;
    }
  }
  throw new Error("Could not generate a unique delivery ID");
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
  // Allocate all stock batch IDs once, up front. generateId uses the global prisma
  // client (not tx), so calling it inside the loop returns the same ID for every item.
  // Unused IDs (when an item hits the upsert "update" branch) are harmless.
  const batchIds = await generateIds("stockBatch", receivedItems.length);

  return await prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error("Delivery not found");
    }

    for (const [i, received] of receivedItems.entries()) {
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
      await tx.stockBatch.upsert({
        where: { deliveryItemId: received.deliveryItemId },
        create: {
          id: batchIds[i],
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

      // ── Inventory log (ID assigned via auto-increment seq inside the tx) ──
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