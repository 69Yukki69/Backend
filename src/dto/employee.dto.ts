import { z } from 'zod';

const EMPLOYEE_ROLES = ['ADMIN', 'CASHIER', 'STOCK_MANAGER', 'DRIVER'] as const;

export const CreateEmployeeDto = z
  .object({
    name: z.string().min(1, 'Name is required'),
    // Optional here; required below for every role except DRIVER
    password: z.string().optional(),
    role: z.enum(EMPLOYEE_ROLES),
    phone: z.string().min(11, 'Phone must be at least 11 digits'),
  })
  .refine(
    (d) => d.role === 'DRIVER' || (d.password !== undefined && d.password.length >= 8),
    { message: 'Password must be at least 8 characters', path: ['password'] }
  );

export const UpdateEmployeeDto = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(EMPLOYEE_ROLES).optional(),
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