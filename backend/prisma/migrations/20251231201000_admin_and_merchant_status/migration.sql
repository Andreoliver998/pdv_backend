-- Schema drift fix: merchant/admin/audit/email enums + core tables/columns
-- Goal: make DB compatible with current Prisma schema without breaking existing data.

-- =========================
-- Enums (create if missing)
-- =========================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuthProvider') THEN
    CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'GOOGLE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MerchantStatus') THEN
    CREATE TYPE "MerchantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AdminRole') THEN
    CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'FINANCE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionPlan') THEN
    CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'BASIC', 'PRO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'OVERDUE', 'SUSPENDED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingEventType') THEN
    CREATE TYPE "BillingEventType" AS ENUM ('PAYMENT', 'EXTEND_DUE', 'PLAN_CHANGE', 'SUSPEND', 'UNSUSPEND');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditActorType') THEN
    CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'USER');
  END IF;
END $$;

-- =========================
-- Existing enums (add values)
-- =========================
-- SaleStatus: add missing values used by the app/schema (safe: only adds).
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- =========================
-- Merchant: add missing columns
-- =========================
ALTER TABLE "Merchant"
  ADD COLUMN IF NOT EXISTS "status" "MerchantStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "billingDueAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "isLoginBlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "loginBlockedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "adminNotes" TEXT;

-- Make updatedAt less fragile for raw SQL inserts
ALTER TABLE "Merchant" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Merchant_status_idx" ON "Merchant"("status");

-- =========================
-- User: auth provider + email verification
-- =========================
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "provider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN IF NOT EXISTS "googleSub" TEXT,
  ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='User_googleSub_key'
  ) THEN
    CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
  END IF;
END $$;

-- =========================
-- Admin tables (Superdono)
-- =========================
CREATE TABLE IF NOT EXISTS "AdminUser" (
  "id" SERIAL NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'SUPER_ADMIN',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='AdminUser_email_key'
  ) THEN
    CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AdminUser_isActive_idx" ON "AdminUser"("isActive");
CREATE INDEX IF NOT EXISTS "AdminUser_role_idx" ON "AdminUser"("role");

CREATE TABLE IF NOT EXISTS "AdminPasswordResetToken" (
  "id" SERIAL NOT NULL,
  "adminId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminPasswordResetToken_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='AdminPasswordResetToken_tokenHash_key'
  ) THEN
    CREATE UNIQUE INDEX "AdminPasswordResetToken_tokenHash_key" ON "AdminPasswordResetToken"("tokenHash");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AdminPasswordResetToken_adminId_idx" ON "AdminPasswordResetToken"("adminId");
CREATE INDEX IF NOT EXISTS "AdminPasswordResetToken_expiresAt_idx" ON "AdminPasswordResetToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "AdminPasswordResetToken_usedAt_idx" ON "AdminPasswordResetToken"("usedAt");

DO $$
BEGIN
  IF to_regclass('"AdminUser"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminPasswordResetToken_adminId_fkey') THEN
      ALTER TABLE "AdminPasswordResetToken"
        ADD CONSTRAINT "AdminPasswordResetToken_adminId_fkey"
        FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- =========================
-- AuditLog (for admin/user actions)
-- =========================
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" SERIAL NOT NULL,
  "actorType" "AuditActorType" NOT NULL,
  "actorId" INTEGER NOT NULL,
  "merchantId" INTEGER,
  "action" TEXT NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorType_actorId_createdAt_idx" ON "AuditLog"("actorType", "actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

DO $$
BEGIN
  IF to_regclass('"Merchant"') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_merchantId_fkey') THEN
      ALTER TABLE "AuditLog"
        ADD CONSTRAINT "AuditLog_merchantId_fkey"
        FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

