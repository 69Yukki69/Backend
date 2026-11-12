import { Router } from 'express';
import {
  placeOrder,
  getCustomerOrders,
  updateOrderStatus,
  getAllCompletedOrders,
  getActiveOrders,
  getDrivers,
} from '../controllers/order.controller';
import { placeWalkInOrder } from '../controllers/walkIn.controller';
import { validate } from '../middleware/validate';
import { PlaceOrderDto, UpdateOrderStatusDto } from '../dto/order.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// ── Static routes FIRST (before any /:param routes) ──────────────────────────
router.get(  '/active',               authMiddleware(['ADMIN', 'CASHIER']),              getActiveOrders);
router.get(  '/completed',            authMiddleware(['ADMIN', 'CASHIER']),              getAllCompletedOrders);
router.get(  '/drivers',              authMiddleware(['ADMIN', 'CASHIER']),              getDrivers);
router.get(  '/customer/:customerId', authMiddleware(['ADMIN', 'CASHIER', 'CUSTOMER']),  getCustomerOrders);

// ── Action routes ─────────────────────────────────────────────────────────────
router.post( '/walk-in',    authMiddleware(['ADMIN', 'CASHIER']),                                 placeWalkInOrder);
router.post( '/',           authMiddleware(['CUSTOMER', 'CASHIER']),                              validate(PlaceOrderDto), placeOrder);
router.patch('/:id/status', authMiddleware(['ADMIN', 'CASHIER', 'CUSTOMER']), validate(UpdateOrderStatusDto), updateOrderStatus);

export default router;