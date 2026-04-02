// src/lib/inventory.ts
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