import { Router } from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  loginCustomer
} from '../controllers/customer.controller';
import { validate } from '../middleware/validate';
import { CreateCustomerDto, LoginCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware(["ADMIN"]), getCustomers);
router.get('/:id', getCustomer);
router.post('/', authMiddleware(["ADMIN"]), validate(CreateCustomerDto), createCustomer);
router.put('/:id',authMiddleware(["ADMIN"]), validate(UpdateCustomerDto), updateCustomer);
router.delete('/:id',authMiddleware(["ADMIN", "CUSTOMER"]), deleteCustomer);
router.post('/login', validate(LoginCustomerDto), loginCustomer)

export default router;