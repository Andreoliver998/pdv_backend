const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/prisma");

function readEnv(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return dotenv.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function applyEnv(parsed) {
  if (!parsed) return;
  Object.entries(parsed).forEach(([key, value]) => {
    if (process.env[key] != null) return;
    process.env[key] = value;
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const s = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function isBcryptHash(value) {
  return String(value || "").startsWith("$2");
}

function bcryptRounds() {
  const raw = Number(process.env.BCRYPT_SALT_ROUNDS || 0) || 0;
  return raw >= 4 && raw <= 15 ? raw : 10;
}

async function main() {
  // Carrega .env e .env.local (sem sobrescrever env já definido externamente)
  const envPath = path.join(__dirname, "..", ".env");
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  applyEnv(readEnv(envPath));
  applyEnv(readEnv(envLocalPath));

  const email = normalizeEmail(process.env.ADMIN_SEED_EMAIL);
  const password = String(process.env.ADMIN_SEED_PASSWORD || "").trim();

  if (!email || !password) {
    console.error("[admin:seed] Missing ADMIN_SEED_EMAIL/ADMIN_SEED_PASSWORD");
    process.exitCode = 1;
    return;
  }
  if (!isValidEmail(email)) {
    console.error("[admin:seed] Invalid ADMIN_SEED_EMAIL");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, isActive: true, passwordHash: true },
  });

  const nextHash = await bcrypt.hash(password, bcryptRounds());

  if (!existing) {
    await prisma.adminUser.create({
      data: { email, name: "SuperDono", role: "SUPER_ADMIN", isActive: true, passwordHash: nextHash },
      select: { id: true },
    });
    console.log("[admin:seed] SuperAdmin created.");
    return;
  }

  const needsMigration = !isBcryptHash(existing.passwordHash);
  const needsRole = existing.role !== "SUPER_ADMIN";
  const needsActive = existing.isActive === false;

  if (needsMigration || needsRole || needsActive) {
    await prisma.adminUser.update({
      where: { id: existing.id },
      data: {
        role: "SUPER_ADMIN",
        isActive: true,
        ...(needsMigration ? { passwordHash: nextHash } : {}),
      },
    });
    console.log("[admin:seed] SuperAdmin updated.");
    return;
  }

  console.log("[admin:seed] SuperAdmin already exists.");
}

main()
  .catch((err) => {
    console.error("[admin:seed] Failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {}
  });

