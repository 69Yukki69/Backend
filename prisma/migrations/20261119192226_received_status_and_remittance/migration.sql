-- AlterEnum
ALTER TYPE "SaleStatus" ADD VALUE 'RECEIVED';

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN     "receivedAt" TIMESTAMP(3),
ADD COLUMN     "remittedAmount" DOUBLE PRECISION,
ADD COLUMN     "remittedAt" TIMESTAMP(3),
ADD COLUMN     "remittedById" TEXT;
