import { Router } from 'express';
import { placeOrder } from '../controllers/order.controller';
import { validate } from '../middleware/validate';
import { PlaceOrderDto } from '../dto/order.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authMiddleware(['CUSTOMER']), validate(PlaceOrderDto), placeOrder);

export default router;