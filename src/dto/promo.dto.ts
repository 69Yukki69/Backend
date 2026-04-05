import { z } from 'zod';

export const CreatePromoDto = z.object({
  productId:       z.string().min(1, 'Product ID is required'),
  promoName:       z.string().min(1, 'Promo name is required'),
  alteredPrice:    z.number().positive('Altered price must be positive'),
  discountPercent: z.number().min(0).max(100).optional(),
  dateEffective:   z.string().min(1, 'Start date is required'),
  lastDate:        z.string().min(1, 'End date is required'),
  isActive:        z.boolean().optional(),
});

export const UpdatePromoDto = z.object({
  promoName:       z.string().min(1).optional(),
  alteredPrice:    z.number().positive().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  dateEffective:   z.string().optional(),
  lastDate:        z.string().optional(),
  isActive:        z.boolean().optional(),
});

export type CreatePromoType = z.infer<typeof CreatePromoDto>;
export type UpdatePromoType = z.infer<typeof UpdatePromoDto>;