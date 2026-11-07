/*
  Warnings:

  - A unique constraint covering the columns `[referenceNo]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('ONLINE', 'WALK_IN');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "referenceNo" TEXT;

-- AlterTable
ALTER TABLE "SaleRecord" ADD COLUMN     "orderType" "OrderType" NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "walkInAddress" TEXT,
ADD COLUMN     "walkInName" TEXT,
ADD COLUMN     "walkInPhone" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_referenceNo_key" ON "Payment"("referenceNo");
