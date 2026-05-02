import { z } from 'zod';

export const ProcessReturnDto = z.object({
  items: z
    .array(
      z.object({
        orderLineId: z.string().min(1, 'Order line ID is required'),
        returnQty:   z.number().int().positive('Return quantity must be a positive integer'),
      })
    )
    .min(1, 'At least one return item is required'),
});

export type ProcessReturnType = z.infer<typeof ProcessReturnDto>;