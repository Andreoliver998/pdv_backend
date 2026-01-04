-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'PRINTED', 'ERROR', 'CANCELED');

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" SERIAL NOT NULL,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "copies" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "errorMessage" TEXT,
    "printedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "saleId" INTEGER,
    "intentId" INTEGER,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_saleId_key" ON "PrintJob"("saleId");

-- CreateIndex
CREATE INDEX "PrintJob_merchantId_createdAt_idx" ON "PrintJob"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_status_idx" ON "PrintJob"("status");

-- CreateIndex
CREATE INDEX "PrintJob_intentId_idx" ON "PrintJob"("intentId");

-- CreateIndex
CREATE INDEX "PrintJob_saleId_idx" ON "PrintJob"("saleId");

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

