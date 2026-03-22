import { z } from 'zod';

export const CreateEmployeeDto = z.object({
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ADMIN', 'CASHIER', 'STOCK_MANAGER'] as const),
  phone: z.string().min(11, 'Phone must be at least 11 digits'),
});

export const UpdateEmployeeDto = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'CASHIER', 'STOCK_MANAGER'] as const).optional(),
  phone: z.string().min(11).optional(),
  userStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const).optional(),
});

export const LoginEmployeeDto = z.object({
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type CreateEmployeeType = z.infer<typeof CreateEmployeeDto>;
export type UpdateEmployeeType = z.infer<typeof UpdateEmployeeDto>;
export type LoginEmployeeType = z.infer<typeof LoginEmployeeDto>;