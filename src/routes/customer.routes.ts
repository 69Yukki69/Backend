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
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware(["ADMIN"]), getCustomers);
router.get('/:id', getCustomer);
router.post('/', authMiddleware(["ADMIN"]), validate(CreateCustomerDto), createCustomer);
router.put('/:id',authMiddleware(["ADMIN"]), validate(UpdateCustomerDto), updateCustomer);
router.delete('/:id',authMiddleware(["ADMIN", "CUSTOMER"]), deleteCustomer);

export default router;