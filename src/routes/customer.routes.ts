import { Router } from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  loginCustomer,
  requestAccountOtp,
  requestPasswordOtp,
  changePassword,
} from '../controllers/customer.controller';
import { validate } from '../middleware/validate';
import { LoginCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware(["ADMIN", "CASHIER"]), getCustomers);
router.get('/:id', getCustomer);

// Account creation (ADMIN only, 2 steps: request OTP -> create with OTP)
// Validation (name, email, password, otp) is done inside createCustomer.
router.post('/request-otp', authMiddleware(["ADMIN"]), requestAccountOtp);
router.post('/', authMiddleware(["ADMIN"]), createCustomer);

// Password change (logged-in CUSTOMER, 2 steps: request OTP -> change with OTP)
router.post('/password/request-otp', authMiddleware(["CUSTOMER"]), requestPasswordOtp);
router.post('/password/change', authMiddleware(["CUSTOMER"]), changePassword);

router.put('/:id', authMiddleware(["ADMIN"]), validate(UpdateCustomerDto), updateCustomer);
router.delete('/:id', authMiddleware(["ADMIN", "CUSTOMER"]), deleteCustomer);
router.post('/login-customer', validate(LoginCustomerDto), loginCustomer);

export default router;