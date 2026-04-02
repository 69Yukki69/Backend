import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

export const getProducts = async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: { supplier: true }
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get products', error: err });
  }
};

export const getProduct = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: String(req.params.id) },
      include: { supplier: true }
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get product', error: err });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const { productName, category, size, price, stockQuantity, supplierId, image, barcode, expiryDate, status } = req.body;
    const id = await generateId('product');
    const product = await prisma.product.create({
      data: {
        id,
        productName,
        category,
        size: size || null,
        price: Number(price),
        supplierId,
        image: image || null,
        barcode: barcode || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        status: status || 'ACTIVE'
      }
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create product', error: err });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { productName, category, size, price, stockQuantity, image, barcode, expiryDate, status } = req.body;
    const product = await prisma.product.update({
      where: { id: String(req.params.id) },
      data: {
        productName,
        category,
        size: size || null,
        price: Number(price),
        image: image || null,
        barcode: barcode || null,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        status
      }
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update product', error: err });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    await prisma.product.delete({
      where: { id: String(req.params.id) }
    });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete product', error: err });
  }
};