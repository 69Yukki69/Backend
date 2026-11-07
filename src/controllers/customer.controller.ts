import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import prisma from '../config/db';
import { generateId } from '../util/generateId';
import { OtpError, sendOtp, verifyOtp } from '../util/otp';

const EMAIL_RE     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const normalizeEmail = (e: unknown): string =>
  typeof e === 'string' ? e.trim().toLowerCase() : '';

const maskEmail = (email: string) => {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
};

const handleError = (res: Response, err: any, fallback: string) => {
  if (err instanceof OtpError) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err?.code === 'P2002') {
    return res.status(409).json({ message: 'Name, email, or phone is already in use.' });
  }
  console.error(fallback, err);
  return res.status(500).json({ message: fallback });
};

// GET all customers
export const getCustomers = async (req: Request, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
      omit:    { hashPassword: true },
    });
    res.json(customers);
  } catch (err) {
    handleError(res, err, 'Failed to get customers');
  }
};

// GET single customer
export const getCustomer = async (req: Request, res: Response) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: String(req.params.id) },
      omit:  { hashPassword: true },
    });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (err) {
    handleError(res, err, 'Failed to get customer');
  }
};

// ── STEP 1 of account creation (ADMIN) ───────────────────────────────────────
// POST /customers/request-otp  { email }
// Sends a verification code to the CUSTOMER's email.
export const requestAccountOtp = async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const existing = await prisma.customer.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      return res.status(409).json({ message: 'A customer with this email already exists.' });
    }

    await sendOtp(email, 'ACCOUNT_CREATION');
    res.json({ message: `Verification code sent to ${maskEmail(email)}.` });
  } catch (err) {
    handleError(res, err, 'Failed to send verification code');
  }
};

// ── STEP 2 of account creation (ADMIN) ───────────────────────────────────────
// POST /customers  { name, email, phone, address, password, userStatus, otp }
export const createCustomer = async (req: Request, res: Response) => {
  try {
    const { name, phone, address, password, userStatus, otp } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Name is required.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }
    if (!otp) {
      return res.status(400).json({ message: 'Verification code is required.' });
    }

    // Check duplicates BEFORE consuming the OTP, so a typo doesn't waste the code
    const duplicate = await prisma.customer.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { name: name.trim() },
          ...(phone ? [{ phone }] : []),
        ],
      },
    });
    if (duplicate) {
      return res.status(409).json({ message: 'Name, email, or phone is already in use.' });
    }

    await verifyOtp(email, 'ACCOUNT_CREATION', String(otp));

    const id           = await generateId('customer'); // ← CUS-1000, CUS-1001...
    const hashPassword = await bcrypt.hash(password, 10);

    const customer = await prisma.customer.create({
      data: {
        id,
        name:       name.trim(),
        email,
        phone:      phone || null,
        address:    address || null,
        hashPassword,
        userStatus: userStatus || 'ACTIVE',
      },
      omit: { hashPassword: true },
    });

    res.status(201).json(customer);
  } catch (err) {
    handleError(res, err, 'Failed to create customer');
  }
};

// UPDATE customer
export const updateCustomer = async (req: Request, res: Response) => {
  try {
    const { name, phone, address, userStatus } = req.body;
    const email = req.body.email ? normalizeEmail(req.body.email) : null;

    const customer = await prisma.customer.update({
      where: { id: String(req.params.id) },
      data: {
        name,
        email,
        phone:   phone || null,
        address: address || null,
        userStatus,
      },
      omit: { hashPassword: true },
    });

    res.json(customer);
  } catch (err) {
    handleError(res, err, 'Failed to update customer');
  }
};

// DELETE customer
export const deleteCustomer = async (req: Request, res: Response) => {
  try {
    await prisma.customer.delete({
      where: { id: String(req.params.id) },
    });
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    handleError(res, err, 'Failed to delete customer');
  }
};

// LOGIN customer
export const loginCustomer = async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    const customer = await prisma.customer.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const isPasswordValid = await bcrypt.compare(password, customer.hashPassword);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: customer.id, role: 'CUSTOMER', status: customer.userStatus },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1d' }
    );

    res.json({
      message: 'Login successful',
      token,
      customer: {
        id:    customer.id,
        email: customer.email,
        role:  'CUSTOMER',
      },
    });
  } catch (err) {
    handleError(res, err, 'Failed to login');
  }
};

// ── PASSWORD CHANGE, STEP 1 (logged-in CUSTOMER) ─────────────────────────────
// POST /customers/password/request-otp
// Sends a code to the email saved on the customer's account.
export const requestPasswordOtp = async (req: Request, res: Response) => {
  try {
    const { id } = (req as any).user as { id: string };

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    if (!customer.email) {
      return res.status(400).json({
        message: 'No email is saved on this account. Please ask the admin to add one.',
      });
    }

    await sendOtp(customer.email, 'PASSWORD_CHANGE');
    res.json({ message: `Verification code sent to ${maskEmail(customer.email)}.` });
  } catch (err) {
    handleError(res, err, 'Failed to send verification code');
  }
};

// ── PASSWORD CHANGE, STEP 2 (logged-in CUSTOMER) ─────────────────────────────
// POST /customers/password/change  { otp, newPassword }
export const changePassword = async (req: Request, res: Response) => {
  try {
    const { id } = (req as any).user as { id: string };
    const { otp, newPassword } = req.body;

    if (!otp) {
      return res.status(400).json({ message: 'Verification code is required.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer || !customer.email) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    await verifyOtp(customer.email, 'PASSWORD_CHANGE', String(otp));

    const hashPassword = await bcrypt.hash(newPassword, 10);
    await prisma.customer.update({ where: { id }, data: { hashPassword } });

    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    handleError(res, err, 'Failed to change password');
  }
};