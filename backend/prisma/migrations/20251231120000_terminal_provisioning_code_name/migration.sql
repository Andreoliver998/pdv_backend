-- Add optional terminal name to provisioning codes (used by web panel at generation time)
--
-- IMPORTANT:
-- Some environments were missing the "TerminalProvisioningCode" table entirely (schema drift).
-- This migration is robust:
-- - If the table doesn't exist: create it with the expected columns/indexes/FKs.
-- - If it exists: add the "name" column (idempotent).

DO $$
BEGIN
  IF to_regclass('"TerminalProvisioningCode"') IS NULL THEN
    CREATE TABLE "TerminalProvisioningCode" (
      "id" SERIAL NOT NULL,
      "code" TEXT NOT NULL,
      "name" TEXT,
      "merchantId" INTEGER NOT NULL,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      "usedAt" TIMESTAMP(3),
      "terminalId" INTEGER,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

      CONSTRAINT "TerminalProvisioningCode_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "TerminalProvisioningCode_code_key" ON "TerminalProvisioningCode"("code");
    CREATE INDEX "TerminalProvisioningCode_merchantId_createdAt_idx" ON "TerminalProvisioningCode"("merchantId", "createdAt");
    CREATE INDEX "TerminalProvisioningCode_expiresAt_idx" ON "TerminalProvisioningCode"("expiresAt");
    CREATE INDEX "TerminalProvisioningCode_usedAt_idx" ON "TerminalProvisioningCode"("usedAt");
    CREATE INDEX "TerminalProvisioningCode_terminalId_idx" ON "TerminalProvisioningCode"("terminalId");

    ALTER TABLE "TerminalProvisioningCode"
      ADD CONSTRAINT "TerminalProvisioningCode_merchantId_fkey"
      FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    ALTER TABLE "TerminalProvisioningCode"
      ADD CONSTRAINT "TerminalProvisioningCode_terminalId_fkey"
      FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "TerminalProvisioningCode" ADD COLUMN IF NOT EXISTS "name" TEXT;
