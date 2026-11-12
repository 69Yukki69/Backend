-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN     "driverId" TEXT;

-- CreateIndex
CREATE INDEX "SaleRecord_driverId_idx" ON "SaleRecord"("driverId");

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
