-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'DRIVER';

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "hashPassword" DROP NOT NULL;
