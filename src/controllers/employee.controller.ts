import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { generateId } from '../util/generateId';

// GET all employees
export const getEmployees = async (req: Request, res: Response) => {
  try {
    const employees = await prisma.employee.findMany({
      where:{role: {
        in: ['CASHIER', 'STOCK_MANAGER']
      }}
    });
    res.json(employees);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get employees', error: err });
  }
};

// GET single employee
export const getEmployee = async (req: Request, res: Response) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: String(req.params.id) }
    });
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Failed to get employee', error: err });
  }
};

// CREATE employee
export const createEmployee = async (req: Request, res: Response) => {
  try {
    const { name, password, role, phone } = req.body;

    const id = await generateId('employee');  // ← EMP-1000, EMP-1001...
    const hashPassword = await bcrypt.hash(password, 10);

    const employee = await prisma.employee.create({
      data: {
        id,
        name,
        hashPassword,
        role,
        phone,
        userStatus: 'ACTIVE'

      }
    });

    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create employee', error: err });
  }
};

// UPDATE employee
export const updateEmployee = async (req: Request, res: Response) => {
  try {
    const { name, role, phone, userStatus } = req.body;

    const employee = await prisma.employee.update({
      where: { id: String(req.params.id) },
      data: { name, role, phone, userStatus }
    });

    res.json(employee);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update employee', error: err });
  }
};

// DELETE employee
export const deleteEmployee = async (req: Request, res: Response) => {
  try {
    await prisma.employee.delete({
      where: { id: String(req.params.id) }
    });
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete employee', error: err });
  }
};

// LOGIN employee
export const loginEmployee = async (req: Request, res: Response) => {
  try {
    const { name, password } = req.body;

    const employee = await prisma.employee.findUnique({
      where: { name }
    });

    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    if (employee.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Access denied. Only ADMIN can login.' });
    }

    if (employee.userStatus !== 'ACTIVE') {
      return res.status(403).json({ message: 'Account is inactive or suspended.' });
    }

    const isPasswordValid = await bcrypt.compare(password, employee.hashPassword);

    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: employee.id, role: employee.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      employee: {
        id: employee.id,
        name: employee.name,
        role: employee.role,
        userStatus: employee.userStatus
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to login', error: err });
  }
};