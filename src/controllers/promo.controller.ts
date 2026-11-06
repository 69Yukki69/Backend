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

// CREATE promotion
export const createPromo = async (req: Request, res: Response) => {
  try {
    const { productId, promoName, alteredPrice, discountPercent, dateEffective, lastDate, isActive } = req.body;

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
        alteredPrice:    Number(alteredPrice),
        discountPercent: discountPercent ? Number(discountPercent) : null,
        dateEffective:   startOfDay(String(dateEffective)),
        lastDate:        endOfDay(String(lastDate)),
        isActive:        isActive ?? true,
      },
      include: { product: true }
    });

    res.json(promo);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create promotion', error: err });
  }
};

// UPDATE promotion
export const updatePromo = async (req: Request, res: Response) => {
  try {
    const { promoName, alteredPrice, discountPercent, dateEffective, lastDate, isActive } = req.body;

    const existing = await prisma.promotionSale.findUnique({ where: { id: String(req.params.id) } });
    if (!existing) {
      return res.status(404).json({ message: 'Promotion not found' });
    }

    const promo = await prisma.promotionSale.update({
      where: { id: String(req.params.id) },
      data: {
        promoName,
        alteredPrice:    alteredPrice    ? Number(alteredPrice)            : undefined,
        discountPercent: discountPercent ? Number(discountPercent)         : null,
        dateEffective:   dateEffective   ? startOfDay(String(dateEffective)) : undefined,
        lastDate:        lastDate        ? endOfDay(String(lastDate))        : undefined,
        isActive:        isActive        ?? undefined,
      },
      include: { product: true }
    });

    res.json(promo);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update promotion', error: err });
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