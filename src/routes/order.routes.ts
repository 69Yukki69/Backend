import { Router } from 'express';
import { placeOrder , getCustomerOrders } from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { PlaceOrderDto } from '../dto/order.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authMiddleware(['CUSTOMER']), validate(PlaceOrderDto), placeOrder);
router.get('/customer/:customerId', authMiddleware(['CUSTOMER']), getCustomerOrders);


 
export default router;