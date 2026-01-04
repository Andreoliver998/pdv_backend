-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "printJobId" INTEGER;

-- CreateIndex
CREATE INDEX "PaymentIntent_printJobId_idx" ON "PaymentIntent"("printJobId");

