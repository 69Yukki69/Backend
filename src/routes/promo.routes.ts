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
router.get('/',        authMiddleware(["ADMIN", "CASHIER", "CUSTOMER"]), getPromos);
router.get('/:id',     authMiddleware(["ADMIN", "CASHIER", "CUSTOMER"]), getPromo);
router.post('/',       authMiddleware(["ADMIN"]), validate(CreatePromoDto), createPromo);
router.put('/:id',     authMiddleware(["ADMIN"]), validate(UpdatePromoDto), updatePromo);
router.patch('/:id/toggle', authMiddleware(["ADMIN"]), togglePromo);   // was '/:id'
router.delete('/:id',  authMiddleware(["ADMIN"]), deletePromo);

export default router;