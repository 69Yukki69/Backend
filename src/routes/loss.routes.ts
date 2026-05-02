import { Router } from 'express';
import {
  fileLossReport,
  getLossReports,
  getLossReportSummary,
} from '../controllers/lossReport.controller';
import { validate }       from '../middleware/validate';
import { FileLossReportDto } from '../dto/loss.dto';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Static routes FIRST
// GET   /loss-reports/summary  — admin and stock manager only
router.get('/summary', authMiddleware(['ADMIN', 'STOCK_MANAGER']), getLossReportSummary);

// GET   /loss-reports          — query params: lossReason, productId, from, to, page, limit
router.get('/',        authMiddleware(['ADMIN', 'STOCK_MANAGER']), getLossReports);

// POST  /loss-reports          — stock manager files a loss, admin can too
router.post('/',       authMiddleware(['ADMIN', 'STOCK_MANAGER']), validate(FileLossReportDto), fileLossReport);

export default router;