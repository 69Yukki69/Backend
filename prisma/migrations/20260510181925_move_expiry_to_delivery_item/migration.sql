/*
  Warnings:

  - You are about to drop the column `expiryDate` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DeliveryItem" ADD COLUMN     "expiryDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" DROP COLUMN "expiryDate";
