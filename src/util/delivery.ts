import prisma from "../config/db";
import { generateId } from "../util/generateId";
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
            quantity: item.quantity,
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


export const deleteDeliveryService = async (id: string) => {
  return await prisma.delivery.delete({
    where: { id },
  });
};