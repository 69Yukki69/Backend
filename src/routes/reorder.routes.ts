// routes/reorder.routes.ts
import { Router } from 'express';
import { getReorderSuggestions } from '../controllers/reorder.controller';

const router = Router();
router.get('/suggestions', getReorderSuggestions);

export default router;