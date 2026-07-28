import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const ENV = {
  PORT:                  process.env.PORT ?? '3000',
  DATABASE_URL:          required('DATABASE_URL'),
  NODE_ENV:              process.env.NODE_ENV ?? 'development',
  RESEND_API_KEY:        required('RESEND_API_KEY'),
  CLOUDINARY_CLOUD_NAME: required('CLOUDINARY_CLOUD_NAME'),
  CLOUDINARY_API_KEY:    required('CLOUDINARY_API_KEY'),
  CLOUDINARY_API_SECRET: required('CLOUDINARY_API_SECRET'),
};