-- CreateEnum
CREATE TYPE "CompletedBy" AS ENUM ('CASHIER', 'CUSTOMER', 'SYSTEM');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "receiptImage" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedBy" "CompletedBy",
ADD COLUMN     "outForDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "walkInStoreName" TEXT;

-- CreateIndex
CREATE INDEX "SaleRecord_status_outForDeliveryAt_idx" ON "SaleRecord"("status", "outForDeliveryAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
