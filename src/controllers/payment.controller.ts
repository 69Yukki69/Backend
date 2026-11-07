import { Request, Response } from 'express';
import prisma from '../config/db';

// ── GET /payments/gcash-ref?ref=1234567890123  (cashier / admin only) ────────
export const checkGcashRef = async (req: Request, res: Response) => {
  const u = (req as any).user as { id: string; role: string } | undefined;
  if (!u || !['CASHIER', 'ADMIN'].includes(u.role)) {
    return res.status(403).json({ message: 'Only cashiers and admins can do this.' });
  }
  const ref = String(req.query.ref ?? '').replace(/\D/g, '');
  if (ref.length !== 13) return res.json({ valid: false, exists: false });
  const p = await prisma.payment.findUnique({ where: { referenceNo: ref }, select: { id: true } });
  res.json({ valid: true, exists: !!p });
};