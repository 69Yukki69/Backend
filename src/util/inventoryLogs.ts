import prisma from '../config/db';
import { LogType,LossReason, Prisma } from '../generated/prisma/client';

type CreateInventoryLogParams = {
  productId: string;
  employeeId: string;
  quantity: number;
  type: LogType;
  reason?: string;
  lossReason?:   LossReason; 
  referenceId?: string;
  referenceType?: string;
};

export async function createInventoryLog(
  data: CreateInventoryLogParams,
  tx?: Prisma.TransactionClient
) {
  const run = async (t: Prisma.TransactionClient) => {
    // Step 1: insert with TEMP id (seq auto-assigned by DB)
    const temp = await t.inventoryLog.create({
      data: { id: 'TEMP_' + Date.now() + '_' + Math.random().toString(36).slice(2), ...data },
    });

    // Step 2: update id using the auto-assigned seq
    return t.inventoryLog.update({
      where: { seq: temp.seq },
      data: { id: `LOG-${temp.seq}` },
    });
  };

  return tx ? run(tx) : prisma.$transaction(run);
}