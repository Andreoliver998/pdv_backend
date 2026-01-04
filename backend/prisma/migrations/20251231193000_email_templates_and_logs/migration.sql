-- Ensure EmailMessageTemplate / EmailLog exist (schema drift fix)
--
-- Why:
-- The backend seeds default email templates on boot. In some environments the
-- `EmailMessageTemplate` table was missing, causing noise and disabling email features.
--
-- This migration is safe/idempotent:
-- - Creates enum/type and tables only if they do not exist.

DO $$
BEGIN
  -- Enum: EmailLogStatus
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EmailLogStatus') THEN
    CREATE TYPE "EmailLogStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');
  END IF;
END $$;

-- Table: EmailMessageTemplate
CREATE TABLE IF NOT EXISTS "EmailMessageTemplate" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "bodyHtml" TEXT NOT NULL,
  "bodyText" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailMessageTemplate_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'EmailMessageTemplate_key_key'
  ) THEN
    CREATE UNIQUE INDEX "EmailMessageTemplate_key_key" ON "EmailMessageTemplate"("key");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "EmailMessageTemplate_key_idx" ON "EmailMessageTemplate"("key");
CREATE INDEX IF NOT EXISTS "EmailMessageTemplate_isActive_idx" ON "EmailMessageTemplate"("isActive");

-- Table: EmailLog
CREATE TABLE IF NOT EXISTS "EmailLog" (
  "id" SERIAL NOT NULL,
  "merchantId" INTEGER NOT NULL,
  "adminId" INTEGER,
  "templateKey" TEXT,
  "subject" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "status" "EmailLogStatus" NOT NULL DEFAULT 'QUEUED',
  "provider" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailLog_merchantId_createdAt_idx" ON "EmailLog"("merchantId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailLog_adminId_createdAt_idx" ON "EmailLog"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailLog_status_createdAt_idx" ON "EmailLog"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailLog_templateKey_idx" ON "EmailLog"("templateKey");
CREATE INDEX IF NOT EXISTS "EmailLog_toEmail_idx" ON "EmailLog"("toEmail");

-- Foreign keys (robust: only add if referenced tables exist)
DO $$
BEGIN
  IF to_regclass('"Merchant"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'EmailLog_merchantId_fkey'
    ) THEN
      ALTER TABLE "EmailLog"
        ADD CONSTRAINT "EmailLog_merchantId_fkey"
        FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;

  IF to_regclass('"AdminUser"') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'EmailLog_adminId_fkey'
    ) THEN
      ALTER TABLE "EmailLog"
        ADD CONSTRAINT "EmailLog_adminId_fkey"
        FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

