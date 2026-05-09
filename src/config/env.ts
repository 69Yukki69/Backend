import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export const ENV = {
  PORT:           process.env.PORT,
  DATABASE_URL:   process.env.DATABASE_URL,
  NODE_ENV:       process.env.NODE_ENV,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
};