import { z } from 'zod';

export const FileLossReportDto = z.object({
  productId: z.string().min(1, 'Product ID is required'),

  quantity: z.number().int().positive('Quantity must be a positive integer'),

  lossReason: z.enum(
    ['EXPIRED', 'DAMAGED', 'THEFT', 'COUNT_ERROR', 'OTHER'],
    { error: 'Loss reason must be one of: EXPIRED, DAMAGED, THEFT, COUNT_ERROR, OTHER' }
  ),

  reason: z.string().optional(),
});

export type FileLossReportType = z.infer<typeof FileLossReportDto>;