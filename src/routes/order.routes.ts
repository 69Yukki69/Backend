import { Router } from 'express';
import { placeOrder, getCustomerOrders, updateOrderStatus, getAllCompletedOrders, getActiveOrders } from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { PlaceOrderDto } from '../dto/order.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// ── Static routes FIRST (before any /:param routes) ──────────────────────────
router.get(   '/active',               authMiddleware(['ADMIN', 'CASHIER', 'EMPLOYEE']), getActiveOrders);
router.get(   '/completed',            authMiddleware(['ADMIN', 'CASHIER', 'EMPLOYEE']), getAllCompletedOrders);
router.get(   '/customer/:customerId', authMiddleware(['CUSTOMER']),                     getCustomerOrders);

// ── Action routes ─────────────────────────────────────────────────────────────
router.post(  '/',             authMiddleware(['CUSTOMER']),                       validate(PlaceOrderDto), placeOrder);
router.patch( '/:id/status',  authMiddleware(['ADMIN', 'CASHIER', 'EMPLOYEE']),                            updateOrderStatus);

export default router;