import { Request, Response } from 'express';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

// GET all suppliers
export const getSuppliers = async (req: Request, res: Response) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { id: 'asc' },
      include: {
        products: {
          select: {
            id: true,
            productName: true
          }
        }
      }
    });
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get suppliers', error: err });
  }
};

// GET single supplier
export const getSupplier = async (req: Request, res: Response) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: String(req.params.id) },
      include: {
        products:{
          select:{
            id: true,
            productName: true
          }

        }
      }
    });
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    res.json(supplier);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get supplier', error: err });
  }
};

// CREATE supplier
export const createSupplier = async (req: Request, res: Response) => {
  try {
    const { supplierName, contactNo, address, email, lastOrdered, dateChecked, lastCheckBy, status } = req.body;

    const id = await generateId('supplier'); // ← SUP-1000, SUP-1001...

    const supplier = await prisma.supplier.create({
      data: {
        id,
        supplierName,
        contactNo,
        address: address || null,
        email: email || null,
        lastOrdered: lastOrdered ? Number(lastOrdered) : null,
        dateChecked: dateChecked ? new Date(dateChecked) : null,
        lastCheckBy: lastCheckBy || null,
        status
      }
    });

    res.json(supplier);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create supplier', error: err });
  }
};

// UPDATE supplier
export const updateSupplier = async (req: Request, res: Response) => {
  try {
    const { supplierName, contactNo, address, email, lastOrdered, dateChecked, lastCheckBy, status } = req.body;

    const supplier = await prisma.supplier.update({
      where: { id: String(req.params.id) },
      data: {
        supplierName,
        contactNo,
        address: address || null,
        email: email || null,
        lastOrdered: lastOrdered ? Number(lastOrdered) : null,
        dateChecked: dateChecked ? new Date(dateChecked) : null,
        lastCheckBy: lastCheckBy || null,
        status
      }
    });

    res.json(supplier);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update supplier', error: err });
  }
};

// DELETE supplier
export const deleteSupplier = async (req: Request, res: Response) => {
  try {
    await prisma.supplier.delete({
      where: { id: String(req.params.id) }
    });
    res.json({ message: 'Supplier deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete supplier', error: err });
  }
};