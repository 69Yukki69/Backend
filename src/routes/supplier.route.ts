import { Router } from 'express';
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier
} from '../controllers/supplier.controller';
import { validate } from '../middleware/validate';
import { authMiddleware } from '../middleware/authMiddleware';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';

const router = Router();

router.get('/', authMiddleware(["ADMIN"]),getSuppliers);
router.get('/:id', authMiddleware(["ADMIN"]),getSupplier);
router.post('/', authMiddleware(["ADMIN"]),validate(CreateSupplierDto), createSupplier);
router.put('/:id', authMiddleware(["ADMIN"]),validate(UpdateSupplierDto), updateSupplier);
router.delete('/:id', authMiddleware(["ADMIN"]),deleteSupplier);

export default router;