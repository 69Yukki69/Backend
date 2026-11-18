-- CreateEnum
CREATE TYPE "LogUnit" AS ENUM ('CASE', 'PIECE');

-- AlterEnum
ALTER TYPE "ReturnRequestStatus" ADD VALUE 'OUT_FOR_DELIVERY';

-- AlterTable
ALTER TABLE "InventoryLog" ADD COLUMN     "unit" "LogUnit" NOT NULL DEFAULT 'CASE';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "loosePieces" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "outForDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "proofImages" TEXT[],
ADD COLUMN     "stockDeductedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_driverId_idx" ON "ReturnRequest"("driverId");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
