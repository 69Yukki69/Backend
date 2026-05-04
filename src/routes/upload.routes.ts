import { Router }  from 'express';
import multer       from 'multer';
import {
  uploadProductImage,
  uploadEmployeeImage,
  uploadCustomerImage,
} from '../controllers/upload.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Store file in memory (buffer) — we stream it directly to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
  },
});

// PATCH /upload/product/:id  — admin only
router.patch(
  '/product/:id',
  authMiddleware(['ADMIN']),
  upload.single('image'),
  uploadProductImage
);

// PATCH /upload/employee/:id — admin or the employee themselves
router.patch(
  '/employee/:id',
  authMiddleware(['ADMIN', 'CASHIER', 'STOCK_MANAGER']),
  upload.single('image'),
  uploadEmployeeImage
);

// PATCH /upload/customer/:id — customer themselves or admin
router.patch(
  '/customer/:id',
  authMiddleware(['ADMIN', 'CUSTOMER']),
  upload.single('image'),
  uploadCustomerImage
);

export default router;