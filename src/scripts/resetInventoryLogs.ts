import prisma from '../config/db';

async function resetInventoryLogs() {
  console.log('🗑️  Deleting all existing inventory logs...');
  await prisma.inventoryLog.deleteMany({});
  console.log('✅ Inventory logs cleared.');

  const products = await prisma.product.findMany({
    select: { id: true, stock: true, productName: true },
  });

  const employee = await prisma.employee.findFirst({
    where: { role: 'ADMIN' },
  });

  if (!employee) {
    throw new Error('No ADMIN employee found. Cannot create baseline logs.');
  }

  console.log(`📦 Inserting baseline STOCK_IN logs for ${products.length} products...`);

  for (const product of products) {
    const id = `LOG-BASELINE-${product.id}`;
    await prisma.inventoryLog.create({
      data: {
        id,
        productId: product.id,
        employeeId: employee.id,
        quantity: product.stock,   // current stock = baseline
        type: 'ADJUSTMENT',
        reason: 'Baseline stock reset — logs re-initialized',
        referenceId: null,
        referenceType: 'MANUAL',
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