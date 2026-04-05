import { z } from 'zod';

export const PlaceOrderDto = z.object({
  customerId: z.string().min(1, 'Customer ID is required'),

  paymentMethod: z.enum(['cod', 'gcash'], {
    error: 'Payment method must be cod or gcash',
  }),

  gcashRef: z.string().optional(),

  note: z.string().optional(),

  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'Product ID is required'),
        quantity:  z.number().int().positive('Quantity must be a positive integer'),
        price:     z.number().positive('Price must be positive'),
      })
    )
    .min(1, 'Order must have at least one item'),
}).refine(
  (data) => data.paymentMethod !== 'gcash' || (data.gcashRef && data.gcashRef.trim().length > 0),
  {
    message: 'GCash reference number is required when paying via GCash',
    path:    ['gcashRef'],
  }
);

export type PlaceOrderType = z.infer<typeof PlaceOrderDto>;
