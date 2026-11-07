import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

// The admin UI sends date-only strings ("2026-11-07"). Interpret them in
// Philippine time so a promo runs from 00:00 on its first day through
// 23:59:59.999 on its last day (instead of ending at 8 AM on the last day).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const startOfDay = (v: string) => new Date(DATE_ONLY.test(v) ? `${v}T00:00:00+08:00` : v);
const endOfDay   = (v: string) => new Date(DATE_ONLY.test(v) ? `${v}T23:59:59.999+08:00` : v);

// GET all promotions
export const getPromos = async (req: Request, res: Response) => {
  try {
    const promos = await prisma.promotionSale.findMany({
      orderBy: { createdAt: 'desc' },
      include: { product: true }
    });
    res.json(promos);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get promotions', error: err });
  }
};

// GET active promotions only
export const getActivePromos = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const promos = await prisma.promotionSale.findMany({
      where: {
        isActive: true,
        dateEffective: { lte: now },
        lastDate:      { gte: now },
      },
      orderBy: { createdAt: 'desc' },
      include: { product: true }
    });
    res.json(promos);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get active promotions', error: err });
  }
};

// GET single promotion
export const getPromo = async (req: Request, res: Response) => {
  try {
    const promo = await prisma.promotionSale.findUnique({
      where: { id: String(req.params.id) },
      include: { product: true }
    });
    if (!promo) {
      return res.status(404).json({ message: 'Promotion not found' });
    }
    res.json(promo);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get promotion', error: err });
  }
};

// ── helpers ───────────────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;

// A discount must be a number from 1 to 99. Returns null when it is not valid.
const parsePercent = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
};

// CREATE promotion
export const createPromo = async (req: Request, res: Response) => {
  try {
    const { productId, promoName, discountPercent, dateEffective, lastDate, isActive } = req.body;

    if (!productId) return res.status(400).json({ message: 'Please select a product.' });
    if (!promoName) return res.status(400).json({ message: 'Promo title is required.' });
    if (!dateEffective || !lastDate) {
      return res.status(400).json({ message: 'Start and end dates are required.' });
    }

    const pct = parsePercent(discountPercent);
    if (pct === null) {
      return res.status(400).json({ message: 'Discount must be between 1 and 99 percent.' });
    }

    const start = startOfDay(String(dateEffective));
    const end   = endOfDay(String(lastDate));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return res.status(400).json({ message: 'Invalid dates. The start date must not be after the end date.' });
    }

    // Validate product exists
    const product = await prisma.product.findUnique({ where: { id: String(productId) } });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const id = await generateId('promotionSale');

    const promo = await prisma.promotionSale.create({
      data: {
        id,
        productId:       String(productId),
        promoName,
        // The promo price is worked out here from the product price,
        // so it can never be 0 or out of step with the percentage.
        alteredPrice:    round2(product.price * (1 - pct / 100)),
        discountPercent: pct,
        dateEffective:   start,
        lastDate:        end,
        isActive:        isActive ?? true,
      },
      include: { product: true }
    });

    res.json(promo);
  } catch (err: any) {
    console.error('createPromo failed:', err);
    if (err?.code === 'P2002') {
      return res.status(409).json({ message: 'Could not create the promo (duplicate ID). Please try again.' });
    }
    res.status(500).json({ message: 'Failed to create promotion.' });
  }
};

// UPDATE promotion
export const updatePromo = async (req: Request, res: Response) => {
  try {
    const { promoName, discountPercent, dateEffective, lastDate, isActive } = req.body;

    const existing = await prisma.promotionSale.findUnique({
      where:   { id: String(req.params.id) },
      include: { product: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    // Only change the discount when a new one is sent; keep the price in step with it.
    let pct: number | undefined;
    let alteredPrice: number | undefined;
    if (discountPercent !== undefined && discountPercent !== null && discountPercent !== '') {
      const parsed = parsePercent(discountPercent);
      if (parsed === null) {
        return res.status(400).json({ message: 'Discount must be between 1 and 99 percent.' });
      }
      pct          = parsed;
      alteredPrice = round2(existing.product.price * (1 - parsed / 100));
    }

    const start = dateEffective ? startOfDay(String(dateEffective)) : undefined;
    const end   = lastDate      ? endOfDay(String(lastDate))        : undefined;
    if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) {
      return res.status(400).json({ message: 'Invalid dates.' });
    }
    if ((start ?? existing.dateEffective) > (end ?? existing.lastDate)) {
      return res.status(400).json({ message: 'The start date must not be after the end date.' });
    }

    const promo = await prisma.promotionSale.update({
      where: { id: String(req.params.id) },
      data: {
        promoName,
        alteredPrice,
        discountPercent: pct,
        dateEffective:   start,
        lastDate:        end,
        isActive:        isActive ?? undefined,
      },
      include: { product: true }
    });

    res.json(promo);
  } catch (err) {
    console.error('updatePromo failed:', err);
    res.status(500).json({ message: 'Failed to update promotion.' });
  }
};

// TOGGLE isActive
export const togglePromo = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.promotionSale.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    const promo = await prisma.promotionSale.update({
      where: { id: String(req.params.id) },
      data:  { isActive: !existing.isActive },
      include: { product: true }
    });

    res.json(promo);
  } catch (err) {
    res.status(500).json({ message: 'Failed to toggle promotion', error: err });
  }
};

// DELETE promotion
export const deletePromo = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.promotionSale.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    await prisma.promotionSale.delete({ where: { id: String(req.params.id) } });
    res.json({ message: 'Promotion deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete promotion', error: err });
  }
};