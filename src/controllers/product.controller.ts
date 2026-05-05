import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';
import { getStock, getStockMany } from '../util/stock';

export const getProducts = async (req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: { supplier: true,
        promotionSales: true
       }
    });

    const stockMap = await getStockMany(products.map(p => p.id));
        const result = products.map(p => {
        const stock = stockMap[p.id] ?? 0;

        let finalPrice = p.price;

        const now = new Date();

        const activePromo = p.promotionSales.find(ps =>
          ps.isActive &&
          now >= new Date(ps.dateEffective) &&
          now <= new Date(ps.lastDate)
        );
        if (activePromo) {
          if (activePromo.discountPercent) {
            finalPrice = p.price - (p.price * activePromo.discountPercent) / 100;
          } else {
            finalPrice = activePromo.alteredPrice;
          }

          if (finalPrice < 0) finalPrice = 0;
        }

        return {
          ...p,
          stock,
          finalPrice,
          activePromo
        };
      });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get products', error: err });
  }
};

export const getProduct = async (req: Request, res: Response) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: String(req.params.id) },
      include: { supplier: true,
        promotionSales: true
       }
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const stock = await getStock(product.id);

    const now = new Date();

    const activePromo = product.promotionSales.find(ps =>
      ps.isActive &&
      now >= new Date(ps.dateEffective) &&
      now <= new Date(ps.lastDate)
    );

    let finalPrice = product.price;

    if (activePromo) {
      if (activePromo.discountPercent) {
        finalPrice = product.price - (product.price * activePromo.discountPercent) / 100;
      } else {
        finalPrice = activePromo.alteredPrice;
      }

      if (finalPrice < 0) finalPrice = 0;
    }

    res.json({
      ...product,
      stock,
      finalPrice,
      activePromo
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get product', error: err });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    // removed stockQuantity from destructure
    const { productName, category, size, price, supplierId, image, barcode, expiryDate, status, piecesPerCase } = req.body;
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
        status: status || 'ACTIVE',
        piecesPerCase: piecesPerCase ? parseInt(piecesPerCase, 10) : 1, // ← add
      }
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create product', error: err });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const { productName, category, size, price, image, barcode, expiryDate, status, piecesPerCase } = req.body; // ← add piecesPerCase
    const product = await prisma.product.update({
      where: { id: String(req.params.id) },
      data: {
        productName,
        category,
        size: size || null,
        price: Number(price),
        piecesPerCase: piecesPerCase ? parseInt(piecesPerCase, 10) : 1, // ← add this
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