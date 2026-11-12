-- CreateEnum
CREATE TYPE "ReturnCondition" AS ENUM ('RESELLABLE', 'DAMAGED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReturnRequestStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "ReturnRequestStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "closeNote" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT;

-- AlterTable
ALTER TABLE "ReturnRequestItem" ADD COLUMN     "condition" "ReturnCondition",
ADD COLUMN     "receivedQty" INTEGER;
