import { z } from 'zod';

export const AddCartItemDto = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity:  z.number().int().min(1, 'Quantity must be at least 1'),
});

export const UpdateCartItemDto = z.object({
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
});

export type AddCartItemType    = z.infer<typeof AddCartItemDto>;
export type UpdateCartItemType = z.infer<typeof UpdateCartItemDto>;