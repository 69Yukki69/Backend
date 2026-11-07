import { Router } from 'express';
import multer from 'multer';
import {
  uploadProductImage,
  uploadEmployeeImage,
  uploadCustomerImage,
  uploadReceipt
} from '../controllers/upload.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Files are kept in memory and streamed straight to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
  },
});

router.patch('/product/:id', authMiddleware(["ADMIN"]), upload.single('image'), uploadProductImage);
router.patch('/employee/:id', authMiddleware(["ADMIN", "CASHIER", "STOCK_MANAGER"]), upload.single('image'), uploadEmployeeImage);
router.patch('/customer/:id', authMiddleware(["ADMIN", "CUSTOMER"]), upload.single('image'), uploadCustomerImage);
router.post('/receipt', authMiddleware(["ADMIN", "CASHIER", "CUSTOMER"]), upload.single('image'), uploadReceipt);

export default router;