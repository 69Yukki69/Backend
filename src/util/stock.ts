import  prisma from '../config/db'

export async function getStock(productId: string): Promise<number> {
  const result = await prisma.inventoryLog.aggregate({
    where: { productId },
    _sum: { quantity: true }
  })
  return result._sum.quantity ?? 0
}

export async function getStockMany(productIds: string[]): Promise<Record<string, number>> {
  const logs = await prisma.inventoryLog.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { quantity: true }
  })

  return Object.fromEntries(
    logs.map(l => [l.productId, l._sum.quantity ?? 0])
  )
}
/** Get available (unreserved) stock for a single product. */
export async function getAvailableStock(productId: string): Promise<number> {
  const product = await prisma.product.findUnique({
    where:  { id: productId },
    select: { stock: true, reservedStock: true },
  });
  if (!product) throw new Error(`Product ${productId} not found.`);
  return product.stock - product.reservedStock;
}

/** Get available (unreserved) stock for multiple products at once. */
export async function getAvailableStockMany(
  productIds: string[]
): Promise<Record<string, number>> {
  const products = await prisma.product.findMany({
    where:  { id: { in: productIds } },
    select: { id: true, stock: true, reservedStock: true },
  });
  return Object.fromEntries(
    products.map((p) => [p.id, p.stock - p.reservedStock])
  );
}