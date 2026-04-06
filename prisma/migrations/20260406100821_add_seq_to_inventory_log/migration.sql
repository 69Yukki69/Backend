/*
  Warnings:

  - A unique constraint covering the columns `[seq]` on the table `InventoryLog` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "InventoryLog" ADD COLUMN     "seq" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLog_seq_key" ON "InventoryLog"("seq");
