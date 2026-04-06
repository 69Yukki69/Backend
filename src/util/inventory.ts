import prisma from '../config/db';
import { Prisma } from '../generated/prisma/client';
import { createInventoryLog } from './inventoryLogs';

export async function getStock(productId: string): Promise<number> {
  const result = await prisma.inventoryLog.aggregate({
    where: { productId },
    _sum: { quantity: true },
  });
  return result._sum.quantity ?? 0;
}

export async function getStockMany(
  productIds: string[]
): Promise<Record<string, number>> {
  const logs = await prisma.inventoryLog.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { quantity: true },
  });
  return Object.fromEntries(
    logs.map((l) => [l.productId, l._sum.quantity ?? 0])
  );
}

export async function stockIn(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    employeeId: string;
    quantity: number;
    referenceId?: string;
    referenceType?: string;
    reason?: string;
  }
) {
  await tx.product.update({
    where: { id: params.productId },
    data: { stock: { increment: params.quantity } },
  });

  return createInventoryLog(
    {
      productId: params.productId,
      employeeId: params.employeeId,
      quantity: params.quantity,
      type: 'STOCK_IN',
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      reason: params.reason,
    },
    tx
  );
}

export async function stockOut(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    employeeId: string;
    quantity: number;
    referenceId?: string;
    referenceType?: string;
    reason?: string;
  }
) {
  const product = await tx.product.findUnique({
    where: { id: params.productId },
    select: { stock: true, productName: true },
  });

  if (!product) throw new Error(`Product ${params.productId} not found`);
  if (product.stock < params.quantity) {
    throw new Error(
      `Insufficient stock for "${product.productName}": available ${product.stock}, requested ${params.quantity}`
    );
  }

  await tx.product.update({
    where: { id: params.productId },
    data: { stock: { decrement: params.quantity } },
  });

  return createInventoryLog(
    {
      productId: params.productId,
      employeeId: params.employeeId,
      quantity: -params.quantity,
      type: 'STOCK_OUT',
      referenceId: params.referenceId,
      referenceType: params.referenceType,
      reason: params.reason,
    },
    tx
  );
}

export async function adjustStock(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    employeeId: string;
    quantity: number;
    reason: string;
  }
) {
  await tx.product.update({
    where: { id: params.productId },
    data: { stock: { increment: params.quantity } },
  });

  return createInventoryLog(
    {
      productId: params.productId,
      employeeId: params.employeeId,
      quantity: params.quantity,
      type: 'ADJUSTMENT',
      reason: params.reason,
    },
    tx
  );
}