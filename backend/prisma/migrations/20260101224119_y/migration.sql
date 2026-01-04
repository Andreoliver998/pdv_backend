-- AlterTable
ALTER TABLE "AdminUser" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "EmailMessageTemplate" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Merchant" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "acquirer" TEXT,
ADD COLUMN     "authorizationCode" TEXT,
ADD COLUMN     "transactionId" TEXT;

-- CreateTable
CREATE TABLE "SystemMaintenance" (
    "id" SERIAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "message" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" INTEGER,

    CONSTRAINT "SystemMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingDueAt" TIMESTAMP(3),
    "graceDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "type" "BillingEventType" NOT NULL,
    "amountCents" INTEGER,
    "note" TEXT,
    "createdByAdminId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SystemMaintenance_enabled_idx" ON "SystemMaintenance"("enabled");

-- CreateIndex
CREATE INDEX "SystemMaintenance_updatedAt_idx" ON "SystemMaintenance"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_merchantId_key" ON "Subscription"("merchantId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_plan_idx" ON "Subscription"("plan");

-- CreateIndex
CREATE INDEX "Subscription_billingDueAt_idx" ON "Subscription"("billingDueAt");

-- CreateIndex
CREATE INDEX "BillingEvent_merchantId_createdAt_idx" ON "BillingEvent"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_type_createdAt_idx" ON "BillingEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_createdByAdminId_idx" ON "BillingEvent"("createdByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_usedAt_idx" ON "EmailVerificationToken"("usedAt");

-- CreateIndex
CREATE INDEX "AdminUser_email_idx" ON "AdminUser"("email");

-- AddForeignKey
ALTER TABLE "SystemMaintenance" ADD CONSTRAINT "SystemMaintenance_updatedByAdminId_fkey" FOREIGN KEY ("updatedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
