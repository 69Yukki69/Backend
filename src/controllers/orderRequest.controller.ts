import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';
import { io } from '../index';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const REQUEST_INCLUDE = {
  supplier:    { select: { id: true, supplierName: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  reviewedBy:  { select: { id: true, name: true } },
  items: {
    include: {
      product: { select: { id: true, productName: true, size: true } },
    },
  },
} as const;

// ── POST /order-requests  (STOCK_MANAGER) ─────────────────────────────────────
// The stock manager asks the admin to buy stock from a supplier.
export const createOrderRequest = async (req: Request, res: Response) => {
  const requester = (req as any).user as { id: string; role: string };
  const { supplierId, notes, items } = req.body as {
    supplierId: string;
    notes?: string;
    items: { productId: string; quantity: number; costPrice: number; unit?: string }[];
  };

  if (requester.role !== 'STOCK_MANAGER') {
    return res.status(403).json({ message: 'Only stock managers can create purchase order requests.' });
  }

  try {
    // Merge duplicate products into one line
    const merged = new Map<string, { quantity: number; costPrice: number; unit?: string }>();
    for (const it of items) {
      const existing = merged.get(it.productId);
      if (existing) existing.quantity += it.quantity;
      else merged.set(it.productId, { quantity: it.quantity, costPrice: it.costPrice, unit: it.unit });
    }

    const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier || supplier.status !== 'ACTIVE') {
      return res.status(400).json({ message: 'Supplier not found or inactive.' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: [...merged.keys()] } },
    });
    if (products.length !== merged.size) {
      return res.status(400).json({ message: 'One or more products were not found.' });
    }
    const wrongSupplier = products.find((p) => p.supplierId !== supplierId);
    if (wrongSupplier) {
      return res.status(400).json({
        message: `"${wrongSupplier.productName}" does not belong to this supplier.`,
      });
    }

    const created = await prisma.orderRequest.create({
      data: {
        supplierId,
        requestedById: requester.id,
        notes: notes?.trim() || null,
        status: 'PENDING',
        items: {
          create: [...merged.entries()].map(([productId, v]) => ({
            productId,
            quantity: v.quantity,
            costPrice: v.costPrice,
            unit: v.unit ?? null,
          })),
        },
      },
      include: REQUEST_INCLUDE,
    });

    // Let admins know (harmless if no admin is in this room)
    io.to('admins').emit('orderRequest:new', {
      requestId: created.id,
      message: `New purchase order request from ${created.requestedBy.name}.`,
    });

    res.status(201).json(created);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to create purchase order request.' });
  }
};

// ── GET /order-requests  (ADMIN: all, STOCK_MANAGER: own) ─────────────────────
export const getOrderRequests = async (req: Request, res: Response) => {
  const requester = (req as any).user as { id: string; role: string };
  try {
    const requests = await prisma.orderRequest.findMany({
      where: requester.role === 'ADMIN' ? {} : { requestedById: requester.id },
      orderBy: { createdAt: 'desc' },
      include: REQUEST_INCLUDE,
    });
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to fetch purchase order requests.' });
  }
};

// ── PATCH /order-requests/:id  (ADMIN) ────────────────────────────────────────
// Body: { status: 'APPROVED' | 'REJECTED', adminRemarks?: string }
// APPROVED creates the purchase order (Delivery) in the SAME transaction, so a
// request can never be approved without its PO, or produce a duplicate PO.
export const reviewOrderRequest = async (req: Request, res: Response) => {
  const id        = String(req.params.id);
  const reviewer  = (req as any).user as { id: string; role: string };
  const { status, adminRemarks } = req.body as {
    status: 'APPROVED' | 'REJECTED';
    adminRemarks?: string;
  };

  if (reviewer.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Only admins can review purchase order requests.' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const request = await tx.orderRequest.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!request) throw new HttpError(404, 'Request not found.');

      // Claim the request: only one reviewer can move it out of PENDING
      const claim = await tx.orderRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status,
          adminRemarks: adminRemarks?.trim() || null,
          reviewedById: reviewer.id,
          reviewedAt: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new HttpError(409, 'This request has already been reviewed.');
      }

      if (status === 'APPROVED') {
        const deliveryId = await generateId('delivery');
        const itemRows: {
          id: string; productId: string; orderedQty: number; costPrice: number;
        }[] = [];
        for (const it of request.items) {
          itemRows.push({
            id: await generateId('deliveryItem'),
            productId: it.productId,
            orderedQty: it.quantity,
            costPrice: it.costPrice,
          });
        }

        await tx.delivery.create({
          data: {
            id: deliveryId,
            supplierId: request.supplierId,
            deliveryDate: new Date(),
            status: 'PENDING',
            totalItems: request.items.reduce((s, i) => s + i.quantity, 0),
            notes: request.notes,
            items: { create: itemRows },
          },
        });

        await tx.orderRequest.update({
          where: { id },
          data: { deliveryId },
        });
      }

      return tx.orderRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
    });

    if (result) {
      io.to(`user:${result.requestedById}`).emit('orderRequest:reviewed', {
        requestId: result.id,
        status: result.status,
        message:
          result.status === 'APPROVED'
            ? 'Your purchase order request was approved.'
            : 'Your purchase order request was rejected.',
      });
    }

    res.json(result);
  } catch (err: any) {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ message: err.message });
    }
    res.status(500).json({ message: err?.message || 'Failed to review request.' });
  }
};