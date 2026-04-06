-- DropForeignKey
ALTER TABLE "SaleRecord" DROP CONSTRAINT "SaleRecord_employeeId_fkey";

-- AlterTable
ALTER TABLE "SaleRecord" ALTER COLUMN "employeeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "SaleRecord" ADD CONSTRAINT "SaleRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
