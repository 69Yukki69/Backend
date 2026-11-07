import { Router } from 'express';
import { checkGcashRef } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// GET /api/payments/gcash-ref?ref=1234567890123 — cashier or admin
router.get('/gcash-ref', authMiddleware(['ADMIN', 'CASHIER']), checkGcashRef);

export default router;