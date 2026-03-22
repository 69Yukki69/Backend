import { Router } from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer
} from '../controllers/customer.controller';
import { validate } from '../middleware/validate';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';

const router = Router();

router.get('/', getCustomers);
router.get('/:id', getCustomer);
router.post('/', validate(CreateCustomerDto), createCustomer);
router.put('/:id', validate(UpdateCustomerDto), updateCustomer);
router.delete('/:id', deleteCustomer);

export default router;