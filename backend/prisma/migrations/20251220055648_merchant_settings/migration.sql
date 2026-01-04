-- CreateTable
CREATE TABLE "MerchantSettings" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "allowCredit" BOOLEAN NOT NULL DEFAULT true,
    "allowDebit" BOOLEAN NOT NULL DEFAULT true,
    "allowPix" BOOLEAN NOT NULL DEFAULT true,
    "allowCash" BOOLEAN NOT NULL DEFAULT true,
    "defaultPayment" "PaymentType" NOT NULL DEFAULT 'PIX',
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "decrementStockOnSale" BOOLEAN NOT NULL DEFAULT true,
    "receiptHeader" TEXT,
    "receiptFooter" TEXT,
    "reportsDefaultRange" TEXT NOT NULL DEFAULT 'today',
    "reportsMaxRows" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantSettings_merchantId_key" ON "MerchantSettings"("merchantId");

-- CreateIndex
CREATE INDEX "MerchantSettings_merchantId_idx" ON "MerchantSettings"("merchantId");

-- AddForeignKey
ALTER TABLE "MerchantSettings" ADD CONSTRAINT "MerchantSettings_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
