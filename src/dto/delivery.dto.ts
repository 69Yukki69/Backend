import { z } from "zod";
import { OrderStatus } from '../generated/prisma/client'

export const createDeliverySchema = z.object({
  supplierId: z.string().min(1),
  deliveryDate: z.string(),
  totalItems: z.number().int().nonnegative(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      productId: z.string().min(1),
      quantity: z.number().int().positive(),
      costPrice: z.number().nonnegative(),
    })
  ),
});

export const updateDeliverySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(), // <-- enum-aware validation
  notes: z.string().optional(),
});

export type CreateDeliveryDTO = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryDTO = z.infer<typeof updateDeliverySchema>;
