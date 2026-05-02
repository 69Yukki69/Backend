import { Router } from 'express';
import { processReturn, getOrderReturns } from '../controllers/return.controller';
import { validate }       from '../middleware/validate';
import { ProcessReturnDto } from '../dto/return.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// POST  /orders/:id/returns  — cashier or admin processes the return at the counter
router.post('/:id/returns', authMiddleware(['ADMIN', 'CASHIER']), validate(ProcessReturnDto), processReturn);

// GET   /orders/:id/returns  — staff and the customer who owns the order can view
router.get( '/:id/returns', authMiddleware(['ADMIN', 'CASHIER', 'STOCK_MANAGER', 'CUSTOMER']), getOrderReturns);

export default router;