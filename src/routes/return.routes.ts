import { Router } from 'express';
import {
  submitReturnRequest,
  reviewReturnRequest,
  dispatchReplacement,
  completeReturn,
  cancelReturnRequest,
  getReturnRequests,
  getActiveReturns,
  getReturnRequestById,
} from '../controllers/return.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// POST   /returns            — customer submits a return request (with photo proof)
router.post('/', authMiddleware(['ADMIN', 'CUSTOMER']), submitReturnRequest);

// GET    /returns            — list return requests with filters
router.get('/', authMiddleware(['ADMIN', 'CASHIER', 'STOCK_MANAGER', 'CUSTOMER', 'DRIVER']), getReturnRequests);

// GET    /returns/active     — active transactions (APPROVED / OUT_FOR_DELIVERY)
// must stay ABOVE '/:id', otherwise "active" is treated as an id
router.get('/active', authMiddleware(['ADMIN', 'CASHIER', 'CUSTOMER', 'DRIVER']), getActiveReturns);

// GET    /returns/:id        — single return request
router.get('/:id', authMiddleware(['ADMIN', 'CASHIER', 'STOCK_MANAGER', 'CUSTOMER', 'DRIVER']), getReturnRequestById);

// PATCH  /returns/:id/dispatch — cashier sends the replacement out with a driver (deducts inventory)
router.patch('/:id/dispatch', authMiddleware(['ADMIN', 'CASHIER']), dispatchReplacement);

// PATCH  /returns/:id/complete — replacement delivered, bad items collected
router.patch('/:id/complete', authMiddleware(['ADMIN', 'CASHIER', 'DRIVER']), completeReturn);

// PATCH  /returns/:id/cancel   — cancel an approved request before dispatch
router.patch('/:id/cancel', authMiddleware(['ADMIN', 'CASHIER']), cancelReturnRequest);

// PATCH  /returns/:id          — cashier approves or rejects a pending request
router.patch('/:id', authMiddleware(['ADMIN', 'CASHIER']), reviewReturnRequest);

export default router;