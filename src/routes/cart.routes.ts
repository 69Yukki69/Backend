import { Router } from 'express';
import {
  getCart,
  addCartItem,
  updateCartItem,
  removeCartItem,
  clearCart,
} from '../controllers/cart.controller';
import { validate } from '../middleware/validate';
import { authMiddleware } from '../middleware/authMiddleware';
import { AddCartItemDto, UpdateCartItemDto } from '../dto/cart.dto';

const router = Router();

// All cart routes require CUSTOMER auth
router.get(   '/:customerId',              authMiddleware(['CUSTOMER']), getCart);
router.post(  '/:customerId/items',        authMiddleware(['CUSTOMER']), validate(AddCartItemDto),    addCartItem);
router.patch( '/:customerId/items/:itemId',authMiddleware(['CUSTOMER']), validate(UpdateCartItemDto), updateCartItem);
router.delete('/:customerId/items/:itemId',authMiddleware(['CUSTOMER']), removeCartItem);
router.delete('/:customerId',              authMiddleware(['CUSTOMER']), clearCart);

export default router;