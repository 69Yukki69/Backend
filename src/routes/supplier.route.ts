import { Router } from 'express';
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier
} from '../controllers/supplier.controller';
import { validate } from '../middleware/validate';
import { CreateSupplierDto, UpdateSupplierDto } from '../dto/supplier.dto';

const router = Router();

router.get('/', getSuppliers);
router.get('/:id', getSupplier);
router.post('/', validate(CreateSupplierDto), createSupplier);
router.put('/:id', validate(UpdateSupplierDto), updateSupplier);
router.delete('/:id', deleteSupplier);

export default router;