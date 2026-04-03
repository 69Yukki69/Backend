/*
  Warnings:

  - You are about to drop the column `quantity` on the `DeliveryItem` table. All the data in the column will be lost.
  - Added the required column `orderedQty` to the `DeliveryItem` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LogType" ADD VALUE 'RETURN_IN';
ALTER TYPE "LogType" ADD VALUE 'RETURN_OUT';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_RECEIVED';

-- AlterEnum
ALTER TYPE "SaleStatus" ADD VALUE 'PARTIALLY_RETURNED';

-- AlterTable
ALTER TABLE "DeliveryItem" DROP COLUMN "quantity",
ADD COLUMN     "orderedQty" INTEGER NOT NULL,
ADD COLUMN     "receivedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InventoryLog" ADD COLUMN     "referenceId" TEXT,
ADD COLUMN     "referenceType" TEXT;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "returnedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "stock" INTEGER NOT NULL DEFAULT 0;
