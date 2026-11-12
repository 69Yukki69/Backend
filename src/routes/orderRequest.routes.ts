import { Router } from 'express';
import {
  createOrderRequest,
  getOrderRequests,
  reviewOrderRequest,
} from '../controllers/orderRequest.controller';
import { validate } from '../middleware/validate';
import { CreateOrderRequestDto, ReviewOrderRequestDto } from '../dto/orderRequest.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get(  '/',    authMiddleware(['ADMIN', 'STOCK_MANAGER']), getOrderRequests);
router.post( '/',    authMiddleware(['STOCK_MANAGER']),          validate(CreateOrderRequestDto), createOrderRequest);
router.patch('/:id', authMiddleware(['ADMIN']),                  validate(ReviewOrderRequestDto), reviewOrderRequest);

export default router;