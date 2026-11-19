/*
  Warnings:

  - You are about to drop the column `receivedAt` on the `ReturnRequestItem` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "receivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReturnRequestItem" DROP COLUMN "receivedAt";
