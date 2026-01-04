-- CreateTable/columns for terminal pairing and hashed keys

-- AlterTable: Terminal
ALTER TABLE "Terminal" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE "Terminal" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "Terminal" ADD COLUMN "deviceModel" TEXT;
ALTER TABLE "Terminal" ADD COLUMN "deviceSerial" TEXT;

-- AlterTable: PrintJob (track which terminal reserved/printed)
ALTER TABLE "PrintJob" ADD COLUMN "terminalId" INTEGER;

-- CreateTable: TerminalApiKey
CREATE TABLE "TerminalApiKey" (
    "id" SERIAL NOT NULL,
    "terminalId" INTEGER NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminalApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TerminalPairingCode
CREATE TABLE "TerminalPairingCode" (
    "id" SERIAL NOT NULL,
    "terminalId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerminalPairingCode_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "TerminalApiKey_terminalId_idx" ON "TerminalApiKey"("terminalId");
CREATE INDEX "TerminalApiKey_keyPrefix_idx" ON "TerminalApiKey"("keyPrefix");

CREATE UNIQUE INDEX "TerminalPairingCode_code_key" ON "TerminalPairingCode"("code");
CREATE INDEX "TerminalPairingCode_terminalId_idx" ON "TerminalPairingCode"("terminalId");
CREATE INDEX "TerminalPairingCode_expiresAt_idx" ON "TerminalPairingCode"("expiresAt");
CREATE INDEX "TerminalPairingCode_usedAt_idx" ON "TerminalPairingCode"("usedAt");

CREATE INDEX "PrintJob_terminalId_idx" ON "PrintJob"("terminalId");

-- Foreign keys
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TerminalApiKey" ADD CONSTRAINT "TerminalApiKey_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TerminalPairingCode" ADD CONSTRAINT "TerminalPairingCode_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "Terminal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

