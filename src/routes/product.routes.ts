import { Router } from 'express';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustStock
} from '../controllers/product.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', getProducts);
router.get('/:id', getProduct);
router.post('/', authMiddleware(["ADMIN"]),createProduct);
router.put('/:id', authMiddleware(["ADMIN"]),updateProduct);
router.delete('/:id', authMiddleware(["ADMIN"]),deleteProduct);
router.patch('/:id/adjust-stock',authMiddleware(["STOCK_MANAGER"]), adjustStock);

export default router;