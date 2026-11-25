import { z } from 'zod';

export const CreatePromoDto = z.object({
  productId:       z.string().min(1, 'Product ID is required'),
  promoName:       z.string().min(1, 'Promo name is required'),
  // The server recalculates this from the product price, so it is optional here.
  alteredPrice:    z.number().positive('Altered price must be positive').optional(),
  discountPercent: z.number().min(1, 'Discount must be at least 1%').max(99, 'Discount must be at most 99%'),
  dateEffective:   z.string().min(1, 'Start date is required'),
  lastDate:        z.string().min(1, 'End date is required'),
  isActive:        z.boolean().optional(),
});

export const UpdatePromoDto = z.object({
  promoName:       z.string().min(1).optional(),
  alteredPrice:    z.number().positive().optional(),
  // The edit form sends null when no discount is set.
  discountPercent: z.number().min(1).max(99).nullable().optional(),
  dateEffective:   z.string().optional(),
  lastDate:        z.string().optional(),
  isActive:        z.boolean().optional(),
});

export type CreatePromoType = z.infer<typeof CreatePromoDto>;
export type UpdatePromoType = z.infer<typeof UpdatePromoDto>;