import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../config/db';
import { generateId } from '../util/generateId';

async function resetInventoryLogs() {
  console.log('🗑️  Deleting all existing inventory logs...');
  await prisma.inventoryLog.deleteMany({});
  console.log('✅ Inventory logs cleared.');

  const products = await prisma.$queryRaw<{ id: string; productName: string; stock: number }[]>`
  SELECT id, "productName", stock FROM "Product"
`;

  const employee = await prisma.employee.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!employee) {
    throw new Error('No ADMIN employee found. Cannot create baseline logs.');
  }

  console.log(`📦 Inserting baseline logs for ${products.length} products...`);

  for (const product of products) {
    const id = `LOG-BASELINE-${product.id}`;
   await prisma.inventoryLog.create({
  data: {
    id,
    productId: product.id,
    employeeId: employee.id,
    quantity: product.stock ?? 0,
    type: 'ADJUSTMENT',
    reason: 'Baseline stock reset — logs re-initialized',
  },
});
    console.log(`  ✔ ${product.productName}: stock = ${product.stock}`);
  }

  console.log('\n🎉 Done! Inventory logs have been reset and baselined.');
}

resetInventoryLogs()
  .catch((err) => {
    console.error('❌ Failed to reset inventory logs:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });