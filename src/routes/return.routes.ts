import { Router } from 'express';
import {
  submitReturnRequest,
  reviewReturnRequest,
  getReturnRequests,
  getReturnRequestById,
} from '../controllers/return.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// POST   /returns         — customer submits a return request
router.post('/',     authMiddleware(['ADMIN', 'CUSTOMER']), submitReturnRequest);

// PATCH  /returns/:id     — employee approves or rejects a return request
router.patch('/:id', authMiddleware(['ADMIN', 'STOCK_MANAGER']),             reviewReturnRequest);

// GET    /returns         — list return requests with filters
router.get('/',      authMiddleware(['ADMIN', 'CASHIER', 'STOCK_MANAGER', 'CUSTOMER']), getReturnRequests);

// GET    /returns/:id     — get a single return request
router.get('/:id',   authMiddleware(['ADMIN', 'CASHIER', 'STOCK_MANAGER', 'CUSTOMER']), getReturnRequestById);

export default router;