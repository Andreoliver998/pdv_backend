-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'OPERATOR');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CREDIT', 'DEBIT', 'PIX', 'CASH');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cnpj" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" INTEGER NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Terminal" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" INTEGER NOT NULL,

    CONSTRAINT "Terminal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "imageUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" INTEGER NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchantId" INTEGER NOT NULL,
    "terminalId" INTEGER,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" SERIAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_cnpj_key" ON "Merchant"("cnpj");

-- CreateIndex
CREATE INDEX "Merchant_name_idx" ON "Merchant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_merchantId_idx" ON "User"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_identifier_key" ON "Terminal"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "Terminal_apiKey_key" ON "Terminal"("apiKey");

-- CreateIndex
CREATE INDEX "Terminal_merchantId_idx" ON "Terminal"("merchantId");

-- CreateIndex
CREATE INDEX "Product_merchantId_active_idx" ON "Product"("merchantId", "active");

-- CreateIndex
CREATE INDEX "Product_merchantId_name_idx" ON "Product"("merchantId", "name");

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "Product"("category");

-- CreateIndex
CREATE INDEX "Sale_merchantId_createdAt_idx" ON "Sale"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_terminalId_createdAt_idx" ON "Sale"("terminalId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Sale_paymentType_idx" ON "Sale"("paymentType");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Terminal" ADD CONSTRAINT "Terminal_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
