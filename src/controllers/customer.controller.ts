import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

// GET all customers
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get customers', error: err });
  }
};

// GET single customer
export const getCustomer = async (req: Request, res: Response) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: String(req.params.id) }
    });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get customer', error: err });
  }
};

// CREATE customer
export const createCustomer = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, address, password, userStatus } = req.body;

    const id = await generateId('customer'); // ← CUS-1000, CUS-1001...
    const hashPassword = await bcrypt.hash(password, 10);

    const customer = await prisma.customer.create({
      data: {
        id,
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        hashPassword,
        userStatus: userStatus || 'ACTIVE'
      }
    });

    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create customer', error: err });
  }
};

// UPDATE customer
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, address, userStatus } = req.body;

    const customer = await prisma.customer.update({
      where: { id: String(req.params.id) },
      data: {
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        userStatus
      }
    });

    res.json(customer);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update customer', error: err });
  }
};

// DELETE customer
export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    await prisma.customer.delete({
      where: { id: String(req.params.id) }
    });
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete customer', error: err });
  }
};
// LOGIN customer
export const loginCustomer = async (req: Request, res: Response) => {
  try {
    const { name, password } = req.body;

    const customer = await prisma.customer.findFirst({
      where: { name }
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const isPasswordValid = await bcrypt.compare(password, customer.hashPassword);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: customer.id, role: "CUSTOMER", status: customer.userStatus },
      process.env.JWT_SECRET || "secret",
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      customer: {
        id: customer.id,
        name: customer.name,
        role: "CUSTOMER"
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to login", error: err });
  }
};

