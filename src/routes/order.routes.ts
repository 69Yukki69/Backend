import { Router } from 'express';
import { placeOrder, getCustomerOrders, updateOrderStatus, getAllCompletedOrders, getActiveOrders } from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { PlaceOrderDto, UpdateOrderStatusDto } from '../dto/order.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();  // SCUBBBBAAAA SCUB SCUB SCUB SCUBAAAAAA SCUB SCUB SCUBBAAAA

// ── Static routes FIRST (before any /:param routes) ──────────────────────────
router.get(  '/active',               authMiddleware(['ADMIN', 'CASHIER']),              getActiveOrders);
router.get(  '/completed',            authMiddleware(['ADMIN', 'CASHIER']),              getAllCompletedOrders);
router.get(  '/customer/:customerId', authMiddleware(['ADMIN', 'CASHIER',  'CUSTOMER']),  getCustomerOrders);

// ── Action routes ─────────────────────────────────────────────────────────────
router.post( '/',           authMiddleware(['CUSTOMER', "CASHIER"]),                              validate(PlaceOrderDto),          placeOrder);
router.patch('/:id/status', authMiddleware(['ADMIN', 'CASHIER', 'CUSTOMER']), validate(UpdateOrderStatusDto), updateOrderStatus);

export default router;