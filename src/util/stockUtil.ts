import prisma from '../config/db';
import { LossReason, Prisma } from '../generated/prisma/client';
import { createInventoryLog } from './inventoryLogs';


// ── RESERVE / RELEASE ─────────────────────────────────────────────────────────

/**
 * Reserve stock when an order is placed (PENDING).
 * Increments reservedStock only — does NOT touch stock.
 * quantity is in PIECES.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    quantity:  number;   // in pieces
  }
) {
  const product = await tx.product.findUnique({
    where:  { id: params.productId },
    select: { stock: true, reservedStock: true, productName: true },
  });

  if (!product) throw new Error(`Product ${params.productId} not found.`);

  const available = product.stock - product.reservedStock;
  if (available < params.quantity) {
    throw new Error(
      `Insufficient stock for "${product.productName}": ` +
      `available ${available} pcs, requested ${params.quantity} pcs.`
    );
  }

  return tx.product.update({
    where: { id: params.productId },
    data:  { reservedStock: { increment: params.quantity } },
  });
}

/**
 * Release a reservation without deducting stock.
 * Used when an order is CANCELLED before completion.
 * quantity is in PIECES.
 */
export async function releaseReservation(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    quantity:  number;   // in pieces
  }
) {
  return tx.product.update({
    where: { id: params.productId },
    data:  { reservedStock: { decrement: params.quantity } },
  });
}

// ── STOCK MOVEMENTS ───────────────────────────────────────────────────────────

/**
 * STOCK IN — delivery received, stock increases.
 * Increments stock and appends a STOCK_IN log.
 * quantity is in PIECES.
 */
export async function stockIn(
  tx: Prisma.TransactionClient,
  params: {
    productId:     string;
    employeeId:    string;
    quantity:      number;   // in pieces
    referenceId?:  string;
    referenceType?: string;
    reason?:       string;
  }
) {
  await tx.product.update({
    where: { id: params.productId },
    data:  { stock: { increment: params.quantity } },
  });

  return createInventoryLog(
    {
      productId:     params.productId,
      employeeId:    params.employeeId,
      quantity:      params.quantity,   // positive
      type:          'STOCK_IN',
      referenceId:   params.referenceId,
      referenceType: params.referenceType,
      reason:        params.reason,
    },
    tx
  );
}

/**
 * STOCK OUT — sale completed, stock decreases.
 * Decrements both stock and reservedStock, appends a STOCK_OUT log.
 * quantity is in PIECES.
 */
export async function stockOut(
  tx: Prisma.TransactionClient,
  params: {
    productId:     string;
    employeeId:    string;
    quantity:      number;   // in pieces
    referenceId?:  string;
    referenceType?: string;
    reason?:       string;
  }
) {
  const product = await tx.product.findUnique({
    where:  { id: params.productId },
    select: { stock: true, productName: true },
  });

  if (!product) throw new Error(`Product ${params.productId} not found.`);
  if (product.stock < params.quantity) {
    throw new Error(
      `Insufficient stock for "${product.productName}": ` +
      `available ${product.stock} pcs, requested ${params.quantity} pcs.`
    );
  }

  await tx.product.update({
    where: { id: params.productId },
    data:  {
      stock:         { decrement: params.quantity },
      reservedStock: { decrement: params.quantity },
    },
  });

  return createInventoryLog(
    {
      productId:     params.productId,
      employeeId:    params.employeeId,
      quantity:      -params.quantity,   // negative = leaving stock
      type:          'STOCK_OUT',
      referenceId:   params.referenceId,
      referenceType: params.referenceType,
      reason:        params.reason,
    },
    tx
  );
}

/**
 * ADJUST STOCK — manual correction or loss report.
 * quantity can be positive (correction upward) or negative (loss).
 * lossReason is required when quantity is negative.
 */
export async function adjustStock(
  tx: Prisma.TransactionClient,
  params: {
    productId:   string;
    employeeId:  string;
    quantity:    number;       // positive = gain, negative = loss
    reason:      string;
    lossReason?: LossReason;   // required when quantity < 0
  }
) {
  if (params.quantity < 0 && !params.lossReason) {
    throw new Error('lossReason is required when reporting a stock loss.');
  }

  await tx.product.update({
    where: { id: params.productId },
    data:  { stock: { increment: params.quantity } },
  });

  return createInventoryLog(
    {
      productId:     params.productId,
      employeeId:    params.employeeId,
      quantity:      params.quantity,
      type:          'ADJUSTMENT',
      reason:        params.reason,
      lossReason:    params.lossReason,
      referenceType: 'MANUAL',
    },
    tx
  );
}

/**
 * RETURN IN — customer return, stock increases.
 * Increments stock and appends a RETURN_IN log.
 * quantity is in PIECES.
 */
export async function returnIn(
  tx: Prisma.TransactionClient,
  params: {
    productId:     string;
    employeeId:    string;
    quantity:      number;   // in pieces
    referenceId?:  string;
    referenceType?: string;
    reason?:       string;
  }
) {
  await tx.product.update({
    where: { id: params.productId },
    data:  { stock: { increment: params.quantity } },
  });

  return createInventoryLog(
    {
      productId:     params.productId,
      employeeId:    params.employeeId,
      quantity:      params.quantity,   // positive = coming back in
      type:          'RETURN_IN',
      referenceId:   params.referenceId,
      referenceType: params.referenceType,
      reason:        params.reason,
    },
    tx
  );
}

/**
 * RETURN OUT — return to supplier, stock decreases.
 * Decrements stock and appends a RETURN_OUT log.
 * quantity is in PIECES.
 */
export async function returnOut(
  tx: Prisma.TransactionClient,
  params: {
    productId:     string;
    employeeId:    string;
    quantity:      number;   // in pieces
    referenceId?:  string;
    referenceType?: string;
    reason?:       string;
  }
) {
  const product = await tx.product.findUnique({
    where:  { id: params.productId },
    select: { stock: true, productName: true },
  });

  if (!product) throw new Error(`Product ${params.productId} not found.`);
  if (product.stock < params.quantity) {
    throw new Error(
      `Cannot return ${params.quantity} pcs of "${product.productName}" to supplier: ` +
      `only ${product.stock} pcs in stock.`
    );
  }

  await tx.product.update({
    where: { id: params.productId },
    data:  { stock: { decrement: params.quantity } },
  });

  return createInventoryLog(
    {
      productId:     params.productId,
      employeeId:    params.employeeId,
      quantity:      -params.quantity,   // negative = leaving stock
      type:          'RETURN_OUT',
      referenceId:   params.referenceId,
      referenceType: params.referenceType,
      reason:        params.reason,
    },
    tx
  );
}