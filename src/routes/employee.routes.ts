import { Router } from 'express';
import {
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  loginEmployee,
  loginAdmin
} from '../controllers/employee.controller';
import { validate } from '../middleware/validate';
import { authMiddleware } from '../middleware/authMiddleware';
import { CreateEmployeeDto, UpdateEmployeeDto, LoginEmployeeDto } from '../dto/employee.dto';

const router = Router();

router.post('/login', validate(LoginEmployeeDto), loginEmployee);
router.post('/', authMiddleware(["ADMIN"]),validate(CreateEmployeeDto), createEmployee);
router.get('/', authMiddleware(["ADMIN"]),getEmployees);
router.get('/:id', getEmployee);
router.put('/:id', authMiddleware(["ADMIN"]),validate(UpdateEmployeeDto), updateEmployee);
router.delete('/:id', authMiddleware(["ADMIN"]),deleteEmployee);
router.post('/login', validate(LoginEmployeeDto), loginAdmin);

export default router;