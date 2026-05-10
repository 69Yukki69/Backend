import prisma from "../config/db";
import { generateId, generateIds } from "../util/generateId";
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
    include: { items: true, supplier: true },
  });
};

export const getDeliveryByIdService = async (id: string) => {
  return await prisma.delivery.findUnique({
    where: { id },
    include: { items: true, supplier: true },
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
    expiryDate?: string | null; // ← new: batch expiry date from the box
  }[]
) => {
  const logIds = await generateIds("inventoryLog", receivedItems.length);

  return await prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({
      where: { id: deliveryId },
    });

    if (!delivery) {
      throw new Error("Delivery not found");
    }

    for (let i = 0; i < receivedItems.length; i++) {
      const received = receivedItems[i];

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
          // Only set expiryDate if provided — keeps existing date if not re-submitted
          ...(received.expiryDate !== undefined && {
            expiryDate: received.expiryDate ? new Date(received.expiryDate) : null,
          }),
        },
      });

      await tx.product.update({
        where: { id: deliveryItem.productId },
        data: { stock: { increment: received.receivedQty } },
      });

      await tx.inventoryLog.create({
        data: {
          id: logIds[i],
          productId: deliveryItem.productId,
          employeeId,
          quantity: received.receivedQty,
          type: "STOCK_IN",
          referenceId: deliveryId,
          referenceType: "DELIVERY",
        },
      });
    }

    const allItems = await tx.deliveryItem.findMany({ where: { deliveryId } });
    const allFullyReceived = allItems.every((i) => i.receivedQty >= i.orderedQty);
    const anyReceived = allItems.some((i) => i.receivedQty > 0);

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
      include: { items: true, supplier: true },
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

export const deleteDeliveryService = async (id: string) => {
  return await prisma.delivery.delete({
    where: { id },
  });
};