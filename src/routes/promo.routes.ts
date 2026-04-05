import { Router } from 'express';
import {
  getPromos,
  getActivePromos,
  getPromo,
  createPromo,
  updatePromo,
  togglePromo,
  deletePromo,
} from '../controllers/promo.controller';
import { validate } from '../middleware/validate';
import { authMiddleware } from '../middleware/authMiddleware';
import { CreatePromoDto, UpdatePromoDto } from '../dto/promo.dto';

const router = Router();

// Public — customers can see active promos
router.get('/active', getActivePromos);

// Admin only
router.get('/',        authMiddleware(['ADMIN']), getPromos);
router.get('/:id',     authMiddleware(['ADMIN']), getPromo);
router.post('/',       authMiddleware(['ADMIN']), validate(CreatePromoDto), createPromo);
router.put('/:id',     authMiddleware(['ADMIN']), validate(UpdatePromoDto), updatePromo);
router.patch('/:id',   authMiddleware(['ADMIN']), togglePromo);
router.delete('/:id',  authMiddleware(['ADMIN']), deletePromo);

export default router;