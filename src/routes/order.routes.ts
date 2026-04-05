import { Router } from 'express';
import { placeOrder , getCustomerOrders, updateOrderStatus } from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { PlaceOrderDto } from '../dto/order.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authMiddleware(['CUSTOMER']), validate(PlaceOrderDto), placeOrder);
router.get('/customer/:customerId', authMiddleware(['CUSTOMER']), getCustomerOrders);
router.patch('/:id/status', authMiddleware(['CUSTOMER']), updateOrderStatus);


 
export default router;