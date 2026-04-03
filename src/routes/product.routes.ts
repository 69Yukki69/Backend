import { Router } from 'express';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct
} from '../controllers/product.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', getProducts);
router.get('/:id', getProduct);
router.post('/', authMiddleware(["ADMIN"]),createProduct);
router.put('/:id', authMiddleware(["ADMIN"]),updateProduct);
router.delete('/:id', authMiddleware(["ADMIN"]),deleteProduct);

export default router;