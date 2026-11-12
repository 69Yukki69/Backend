import { z } from 'zod';

export const CreateOrderRequestDto = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  notes:      z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'Product is required'),
        quantity:  z.number().int().positive('Quantity must be a positive whole number'),
        costPrice: z.number().nonnegative('Cost price cannot be negative'),
        unit:      z.string().optional(),
      })
    )
    .min(1, 'Add at least one product'),
});

export const ReviewOrderRequestDto = z.object({
  status:       z.enum(['APPROVED', 'REJECTED']),
  adminRemarks: z.string().max(500).optional(),
});

export type CreateOrderRequestType = z.infer<typeof CreateOrderRequestDto>;
export type ReviewOrderRequestType = z.infer<typeof ReviewOrderRequestDto>;