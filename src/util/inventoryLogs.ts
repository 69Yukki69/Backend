import prisma from '../config/db';

type CreateInventoryLogParams = {
  productId: string;
  employeeId: string;
  quantity: number;
  type: any; // you can replace with LogType
  reason?: string;
  referenceId?: string;
  referenceType?: string;
};

export async function createInventoryLog(data: CreateInventoryLogParams) {
  return prisma.$transaction(async (tx) => {
    // Step 1: create with TEMP id
    const log = await tx.inventoryLog.create({
      data: {
        id: 'TEMP',
        ...data,
      },
    });

    // Step 2: update with formatted ID
    return tx.inventoryLog.update({
      where: { seq: log.seq },
      data: {
        id: `LOG-${log.seq}`,
      },
    });
  });
}