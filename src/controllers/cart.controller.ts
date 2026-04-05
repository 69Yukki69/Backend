import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

const now = () => new Date();

const activePromoWhere = () => ({
  isActive: true,
  dateEffective: { lte: now() },
  lastDate: { gte: now() },
});

const productWithPromo = () => ({
  include: {
    promotionSales: {
      where: activePromoWhere(),
      take: 1,
    },
  },
});

const itemsWithPromo = () => ({
  include: {
    product: productWithPromo(),
  },
});

// ── Shape a single cart item: flatten alteredPrice → finalPrice ──────────────
const shapeItem = (item: any) => {
  const activePromo = item.product?.promotionSales?.[0];
  return {
    ...item,
    product: {
      ...item.product,
      finalPrice: activePromo ? activePromo.alteredPrice : item.product.price,
      promotionSales: undefined,
    },
  };
};

// ── Shape a full cart ────────────────────────────────────────────────────────
const shapeCart = (cart: any) => ({
  ...cart,
  items: cart.items.map(shapeItem),
});

// ── Helper: get or create a cart for a customer ──────────────────────────────
const getOrCreateCart = async (customerId: string) => {
  const include = { items: itemsWithPromo() };

  let cart = await prisma.shoppingCart.findUnique({
    where: { customerId },
    include,
  });

  if (!cart) {
    const id = await generateId('shoppingCart');
    cart = await prisma.shoppingCart.create({
      data: { id, customerId },
      include,
    });
  }

  return cart;
};

// GET cart by customerId
export const getCart = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId);

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    const cart = await getOrCreateCart(customerId);
    res.json(shapeCart(cart));
  } catch (err) {
    res.status(500).json({ message: 'Failed to get cart', error: err });
  }
};

// ADD item to cart
export const addCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId);
    const { productId, quantity } = req.body;

    const product = await prisma.product.findUnique({ where: { id: String(productId) } });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    if (product.stock < quantity) {
      return res.status(400).json({ message: `Insufficient stock. Only ${product.stock} available.` });
    }

    const cart = await getOrCreateCart(customerId);

    const existingItem = await prisma.shoppingCartItem.findFirst({
      where: { shoppingCartId: cart.id, productId: String(productId) },
    });

    if (existingItem) {
      const newQty = existingItem.quantity + quantity;
      if (product.stock < newQty) {
        return res.status(400).json({ message: `Insufficient stock. Only ${product.stock} available.` });
      }
      const updated = await prisma.shoppingCartItem.update({
        where: { id: String(existingItem.id) },
        data: { quantity: newQty },
        include: { product: productWithPromo() },
      });
      return res.json(shapeItem(updated));
    }

    const id = await generateId('shoppingCartItem');
    const item = await prisma.shoppingCartItem.create({
      data: { id, shoppingCartId: cart.id, productId: String(productId), quantity },
      include: { product: productWithPromo() },
    });

    res.json(shapeItem(item));
  } catch (err) {
    res.status(500).json({ message: 'Failed to add item to cart', error: err });
  }
};

// UPDATE cart item quantity
export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const itemId = String(req.params.itemId);
    const { quantity } = req.body;

    const item = await prisma.shoppingCartItem.findUnique({
      where: { id: itemId },
      include: { product: true },
    });
    if (!item) return res.status(404).json({ message: 'Cart item not found' });

    if (item.product.stock < quantity) {
      return res.status(400).json({ message: `Insufficient stock. Only ${item.product.stock} available.` });
    }

    const updated = await prisma.shoppingCartItem.update({
      where: { id: itemId },
      data: { quantity },
      include: { product: productWithPromo() },
    });

    res.json(shapeItem(updated));
  } catch (err) {
    res.status(500).json({ message: 'Failed to update cart item', error: err });
  }
};

// REMOVE single item from cart
export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const itemId = String(req.params.itemId);

    const item = await prisma.shoppingCartItem.findUnique({ where: { id: itemId } });
    if (!item) return res.status(404).json({ message: 'Cart item not found' });

    await prisma.shoppingCartItem.delete({ where: { id: itemId } });
    res.json({ message: 'Item removed from cart' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to remove cart item', error: err });
  }
};

// CLEAR entire cart
export const clearCart = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId);

    const cart = await prisma.shoppingCart.findUnique({ where: { customerId } });
    if (!cart) return res.status(404).json({ message: 'Cart not found' });

    await prisma.shoppingCartItem.deleteMany({ where: { shoppingCartId: cart.id } });
    res.json({ message: 'Cart cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to clear cart', error: err });
  }
};