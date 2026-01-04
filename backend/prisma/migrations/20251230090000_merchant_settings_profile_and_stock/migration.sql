-- Add missing profile + stock fields to MerchantSettings (schema drift fix)
ALTER TABLE "MerchantSettings"
  ADD COLUMN IF NOT EXISTS "tradeName" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "logoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "logoUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stockEnabled" BOOLEAN NOT NULL DEFAULT true;
