import { Router } from 'express';
import {
  getEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  loginEmployee
} from '../controllers/employee.controller';
import { validate } from '../middleware/validate';
import { CreateEmployeeDto, UpdateEmployeeDto, LoginEmployeeDto } from '../dto/employee.dto';

const router = Router();

router.post('/login', validate(LoginEmployeeDto), loginEmployee);
router.post('/', validate(CreateEmployeeDto), createEmployee);
router.get('/:id', getEmployee);
router.put('/:id', validate(UpdateEmployeeDto), updateEmployee);
router.delete('/:id', deleteEmployee);

export default router;