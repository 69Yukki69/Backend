-- CreateEnum
CREATE TYPE "LossReason" AS ENUM ('EXPIRED', 'DAMAGED', 'THEFT', 'COUNT_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "InventoryLog" ADD COLUMN     "lossReason" "LossReason";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "piecesPerCase" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reservedStock" INTEGER NOT NULL DEFAULT 0;
