-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELED', 'ERROR', 'EXPIRED');

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" SERIAL NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentType" "PaymentType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "providerRef" TEXT,
    "idempotencyKey" TEXT,
    "metadata" JSONB,
    "saleDraft" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "merchantId" INTEGER NOT NULL,
    "saleId" INTEGER,
    "terminalId" INTEGER,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" SERIAL NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentId" INTEGER NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_saleId_key" ON "PaymentIntent"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_merchantId_idempotencyKey_key" ON "PaymentIntent"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentIntent_merchantId_createdAt_idx" ON "PaymentIntent"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");

-- CreateIndex
CREATE INDEX "PaymentIntent_provider_idx" ON "PaymentIntent"("provider");

-- CreateIndex
CREATE INDEX "PaymentTransaction_intentId_createdAt_idx" ON "PaymentTransaction"("intentId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_idx" ON "PaymentTransaction"("status");

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
