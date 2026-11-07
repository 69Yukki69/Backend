// src/util/otp.ts
import crypto from 'crypto';
import prisma from '../config/db';
import { sendOtpEmail } from './mailer';

export type OtpPurpose = 'ACCOUNT_CREATION' | 'PASSWORD_CHANGE';

const OTP_TTL_MS         = 10 * 60 * 1000; // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;      // 1 request per minute per email+purpose
const MAX_ATTEMPTS       = 5;

export class OtpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const normalize = (email: string) => email.trim().toLowerCase();

const hashCode = (email: string, purpose: OtpPurpose, code: string) =>
  crypto
    .createHash('sha256')
    .update(`${email}:${purpose}:${code}:${process.env.OTP_SECRET ?? ''}`)
    .digest('hex');

/** Generates a 6-digit code, stores its hash, and emails it. */
export async function sendOtp(rawEmail: string, purpose: OtpPurpose) {
  const email = normalize(rawEmail);

  const last = await prisma.otpCode.findFirst({
    where:   { email, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new OtpError('Please wait a minute before requesting another code.', 429);
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

  // Only one active code per email + purpose
  await prisma.otpCode.deleteMany({ where: { email, purpose } });
  const record = await prisma.otpCode.create({
    data: {
      email,
      purpose,
      codeHash:  hashCode(email, purpose, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  try {
    await sendOtpEmail({ to: email, code, purpose, expiresInMinutes: OTP_TTL_MS / 60000 });
  } catch (err) {
    await prisma.otpCode.delete({ where: { id: record.id } }).catch(() => {});
    throw new OtpError('Could not send the verification email. Please try again.', 502);
  }
}

/** Throws OtpError if the code is wrong/expired. Resolves if valid (and consumes the code). */
export async function verifyOtp(rawEmail: string, purpose: OtpPurpose, code: string) {
  const email = normalize(rawEmail);

  const record = await prisma.otpCode.findFirst({
    where:   { email, purpose },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt.getTime() < Date.now()) {
    if (record) await prisma.otpCode.delete({ where: { id: record.id } }).catch(() => {});
    throw new OtpError('Code expired or not found. Please request a new one.');
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await prisma.otpCode.delete({ where: { id: record.id } }).catch(() => {});
    throw new OtpError('Too many attempts. Please request a new code.', 429);
  }

  const expected = Buffer.from(record.codeHash, 'hex');
  const actual   = Buffer.from(hashCode(email, purpose, String(code).trim()), 'hex');
  const ok = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!ok) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data:  { attempts: { increment: 1 } },
    });
    throw new OtpError('Incorrect code.');
  }

  await prisma.otpCode.delete({ where: { id: record.id } });
}