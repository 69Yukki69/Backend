import { Router } from 'express';
import { getInventoryLogs } from '../controllers/inventory.controller';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.get('/', authMiddleware(['ADMIN', 'CASHIER', 'EMPLOYEE', 'STOCK_MANAGER']), getInventoryLogs);

export default router;