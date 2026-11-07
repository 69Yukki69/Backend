import cron from 'node-cron';
import prisma from '../config/db';
import { completeSale } from './saleCompletion';

const AUTO_COMPLETE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Call once from index.ts after the server starts. */
export function startAutoCompleteJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - AUTO_COMPLETE_MS);
      const due = await prisma.saleRecord.findMany({
        where: {
          status: 'OUT_FOR_DELIVERY',
          customerId: { not: null },          // account orders only
          outForDeliveryAt: { lte: cutoff },
          // orderType: 'WALK_IN',            // uncomment to exclude online orders
        },
        select: { id: true },
      });
      for (const s of due) {
        try { await completeSale(s.id, 'SYSTEM'); }
        catch (e) { console.error('Auto-complete failed for', s.id, e); }
      }
    } catch (e) {
      console.error('Auto-complete job error:', e);
    }
  });
}