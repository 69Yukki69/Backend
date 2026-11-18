// util/stockPieces.ts
//
// Product.stock       = FULL CASES (unchanged: orders, deliveries, completeSale use this)
// Product.loosePieces = bottles from an opened case, always < piecesPerCase
//
// Returns/replacements are expressed in PIECES. These helpers move pieces in and out
// of stock without ever storing fractional cases, and keep StockBatch in sync.

import { Prisma } from '../generated/prisma/client';
import { deductStockFIFOService } from './stockBatch';

type Tx = Prisma.TransactionClient;

export class StockError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

type StockSnapshot = {
  stock: number;
  loosePieces: number;
  reservedStock: number;
  piecesPerCase: number;
};

/**
 * How taking `pieces` out of stock would play out.
 *   - whole cases come straight from `stock`
 *   - the remainder comes from loosePieces; if there aren't enough loose bottles,
 *     one more case is opened (and its leftover bottles become loosePieces)
 */
export function planDeduction(p: StockSnapshot, pieces: number) {
  const perCase    = Math.max(1, p.piecesPerCase);
  const wholeCases = Math.floor(pieces / perCase);
  const remainder  = pieces % perCase;

  let casesToOpen = 0;
  let newLoose    = p.loosePieces;

  if (remainder > 0) {
    if (p.loosePieces >= remainder) {
      newLoose = p.loosePieces - remainder;
    } else {
      casesToOpen = Math.ceil((remainder - p.loosePieces) / perCase);
      newLoose    = p.loosePieces + casesToOpen * perCase - remainder;
    }
  }

  const casesFromStock = wholeCases + casesToOpen;
  // reservedStock belongs to pending online orders, so a replacement must not eat into it
  const availableCases = p.stock - p.reservedStock;

  return { casesFromStock, newLoose, availableCases, ok: casesFromStock <= availableCases };
}

/** Read-only check, used when the cashier approves a request. Does not change anything. */
export async function assertCanFulfill(tx: Tx, productId: string, pieces: number) {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const plan = planDeduction(p, pieces);
  if (!plan.ok) {
    throw new StockError(
      `Not enough stock of "${p.productName}" for the replacement ` +
      `(need ${plan.casesFromStock} case(s) from stock, ${plan.availableCases} available).`
    );
  }
}

/**
 * Takes `pieces` out of inventory (replacement leaves the shelf).
 * Run it inside a Serializable transaction so two dispatches can't read the same loosePieces.
 */
export async function deductPieces(tx: Tx, productId: string, pieces: number) {
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const plan = planDeduction(p, pieces);

  if (!plan.ok) {
    throw new StockError(
      `Not enough stock of "${p.productName}" for the replacement ` +
      `(need ${plan.casesFromStock} case(s) from stock, ${plan.availableCases} available).`
    );
  }

  if (plan.casesFromStock > 0) {
    // same FIFO batch deduction completeSale uses (quantity in cases)
    await deductStockFIFOService(tx, productId, plan.casesFromStock);
  }

  const updated = await tx.product.updateMany({
    where: { id: productId, stock: { gte: plan.casesFromStock } },
    data:  { stock: { decrement: plan.casesFromStock }, loosePieces: plan.newLoose },
  });
  if (updated.count === 0) {
    throw new StockError(`Stock of "${p.productName}" changed. Please try again.`);
  }

  return plan;
}

/**
 * Puts resellable `pieces` back into inventory.
 * Pieces go into loosePieces; every full case worth of loose bottles rolls up into `stock`.
 */
export async function addPieces(tx: Tx, productId: string, pieces: number) {
  const p       = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  const perCase = Math.max(1, p.piecesPerCase);
  const total   = p.loosePieces + pieces;
  const cases   = Math.floor(total / perCase);

  await tx.product.update({
    where: { id: productId },
    data:  { stock: { increment: cases }, loosePieces: total % perCase },
  });

  // keep StockBatch.remaining in step with stock so later FIFO deductions don't run short
  if (cases > 0) {
    const latest = await tx.stockBatch.findFirst({
      where:   { productId },
      orderBy: { receivedAt: 'desc' },
    });
    if (latest) {
      await tx.stockBatch.update({
        where: { id: latest.id },
        data:  { remaining: { increment: cases } },
      });
    }
  }

  return { casesAdded: cases, loosePieces: total % perCase };
}