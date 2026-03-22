import { z } from 'zod';

export const CreateSupplierDto = z.object({
  supplierName: z.string().min(1, 'Supplier name is required'),
  contactNo: z.string().min(11, 'Contact number must be at least 11 digits'),
  address: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  lastOrdered: z.number().optional(),
  dateChecked: z.string().optional(),
  lastCheckBy: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const UpdateSupplierDto = z.object({
  supplierName: z.string().min(1).optional(),
  contactNo: z.string().min(11).optional(),
  address: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  lastOrdered: z.number().optional(),
  dateChecked: z.string().optional(),
  lastCheckBy: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export type CreateSupplierType = z.infer<typeof CreateSupplierDto>;
export type UpdateSupplierType = z.infer<typeof UpdateSupplierDto>;