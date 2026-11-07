import { Router } from 'express';
import { checkGcashRef } from '../controllers/payment.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/gcash-ref', authMiddleware(['ADMIN', 'CASHIER', 'CUSTOMER']), checkGcashRef);

export default router;