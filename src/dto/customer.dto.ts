import { z } from 'zod';

export const CreateCustomerDto = z.object({
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().min(11, 'Phone must be at least 11 digits').optional().or(z.literal('')),
  address: z.string().optional(),
  userStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export const UpdateCustomerDto = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(11).optional().or(z.literal('')),
  address: z.string().optional(),
  userStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export const LoginCustomerDto = z.object({
  name: z.string().min(1, "Name is required"),
  password: z.string().min(8, "minimumm is 8"),

});

export type CreateCustomerType = z.infer<typeof CreateCustomerDto>;
export type UpdateCustomerType = z.infer<typeof UpdateCustomerDto>;
export type LoginCustomerDto = z.infer<typeof LoginCustomerDto>;