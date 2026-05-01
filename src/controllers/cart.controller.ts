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

    // FIX 4: validate quantity
    if (!quantity || quantity < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    const product = await prisma.product.findUnique({ where: { id: String(productId) } });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // FIX 1: check available stock (stock minus already reserved)
    const availableStock = product.stock - product.reservedStock;
    if (availableStock < quantity) {
      return res.status(400).json({ message: `Insufficient stock. Only ${availableStock} available.` });
    }

    const cart = await getOrCreateCart(customerId);

    const existingItem = await prisma.shoppingCartItem.findFirst({
      where: { shoppingCartId: cart.id, productId: String(productId) },
    });

    if (existingItem) {
      const newQty = existingItem.quantity + quantity;
      // FIX 1: use availableStock for the combined quantity check too
      if (availableStock < newQty) {
        return res.status(400).json({ message: `Insufficient stock. Only ${availableStock} available.` });
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
// Route should be: PATCH /cart/:customerId/items/:itemId
export const updateCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId);
    const itemId = String(req.params.itemId);
    const { quantity } = req.body;

    // FIX 4: validate quantity
    if (!quantity || quantity < 1) {
      return res.status(400).json({ message: 'Quantity must be at least 1' });
    }

    const item = await prisma.shoppingCartItem.findUnique({
      where: { id: itemId },
      include: { product: true },
    });
    if (!item) return res.status(404).json({ message: 'Cart item not found' });

    // FIX 2: verify item belongs to this customer's cart
    const cart = await prisma.shoppingCart.findUnique({ where: { customerId } });
    if (!cart || item.shoppingCartId !== cart.id) {
      return res.status(403).json({ message: 'Item does not belong to this cart' });
    }

    // FIX 1: check available stock (stock minus already reserved)
    const availableStock = item.product.stock - item.product.reservedStock;
    if (availableStock < quantity) {
      return res.status(400).json({ message: `Insufficient stock. Only ${availableStock} available.` });
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
// Route should be: DELETE /cart/:customerId/items/:itemId
export const removeCartItem = async (req: Request, res: Response) => {
  try {
    const customerId = String(req.params.customerId);
    const itemId = String(req.params.itemId);

    const item = await prisma.shoppingCartItem.findUnique({ where: { id: itemId } });
    if (!item) return res.status(404).json({ message: 'Cart item not found' });

    // FIX 3: verify item belongs to this customer's cart
    const cart = await prisma.shoppingCart.findUnique({ where: { customerId } });
    if (!cart || item.shoppingCartId !== cart.id) {
      return res.status(403).json({ message: 'Item does not belong to this cart' });
    }

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