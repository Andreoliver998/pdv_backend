/*
  Warnings:

  - You are about to drop the column `password` on the `User` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Merchant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Product` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Sale` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Terminal` table without a default value. This is not possible if the table is not empty.
  - Added the required column `passwordHash` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "MerchantSettings" ALTER COLUMN "reportsMaxRows" SET DEFAULT 100;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Terminal" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "password",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" TEXT NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_usedAt_idx" ON "PasswordResetToken"("usedAt");

-- CreateIndex
CREATE INDEX "Terminal_identifier_idx" ON "Terminal"("identifier");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_merchantId_isActive_idx" ON "User"("merchantId", "isActive");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
