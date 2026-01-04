// backend/prisma/seed.js
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function envOrDefault(key, def) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : def;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function main() {
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const isDev = nodeEnv !== "production";

  const merchantName = envOrDefault("SEED_MERCHANT_NAME", "Minha Loja");
  const adminName = envOrDefault("SEED_ADMIN_NAME", "Admin");
  const adminEmail = normalizeEmail(envOrDefault("SEED_ADMIN_EMAIL", "admin@minhaloja.com"));
  const adminPassword = envOrDefault("SEED_ADMIN_PASSWORD", "123456");

  // =========================
  // 1) Merchant (find ou create)
  // =========================
  let merchant = await prisma.merchant.findFirst({
    where: { name: merchantName },
  });

  if (!merchant) {
    merchant = await prisma.merchant.create({
      data: { name: merchantName },
    });
  }

  // =========================
  // 2) MerchantSettings (upsert)
  // =========================
  await prisma.merchantSettings.upsert({
    where: { merchantId: merchant.id },
    update: {},
    create: {
      merchantId: merchant.id,

      // defaults úteis para o sistema não "estranhar"
      allowCredit: true,
      allowDebit: true,
      allowPix: true,
      allowCash: true,
      defaultPayment: "PIX",

      allowNegativeStock: false,
      decrementStockOnSale: true,

      reportsDefaultRange: "today",
      reportsMaxRows: 100,
    },
  });

  // =========================
  // 3) Admin user (OWNER)
  // =========================
  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 0) || 10;
  const passwordHash = await bcrypt.hash(String(adminPassword), rounds);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      passwordHash, // ✅ CORRETO (schema atual)
      role: "OWNER",
      isActive: true,
      merchantId: merchant.id, // garante vínculo correto
    },
    create: {
      name: adminName,
      email: adminEmail,
      passwordHash, // ✅ CORRETO (schema atual)
      role: "OWNER",
      merchantId: merchant.id,
      isActive: true,
    },
  });

  // Logs apenas em DEV (sem vazar segredos)
  // =========================
  // 4) AdminUser (SUPER_ADMIN)
  // =========================
  // Preferimos SUPERADMIN_* (novo padrÃ£o). Mantemos compatibilidade com ADMIN_*.
  const superEmail = normalizeEmail(envOrDefault("SUPERADMIN_EMAIL", envOrDefault("ADMIN_EMAIL", "")));
  const superPassword = envOrDefault("SUPERADMIN_PASSWORD", envOrDefault("ADMIN_PASSWORD", ""));
  let superAdmin = null;

  if (superEmail && superPassword) {
    const superName = envOrDefault("SUPERADMIN_NAME", envOrDefault("ADMIN_NAME", "SuperDono"));
    const superHash = await bcrypt.hash(String(superPassword), rounds);

    superAdmin = await prisma.adminUser.upsert({
      where: { email: superEmail },
      update: { name: superName, passwordHash: superHash, isActive: true, role: "SUPER_ADMIN" },
      create: { email: superEmail, name: superName, passwordHash: superHash, isActive: true, role: "SUPER_ADMIN" },
    });
  }

  if (isDev) console.log("? Seed executado com sucesso:");
  if (isDev)
    console.log({
    merchant: { id: merchant.id, name: merchant.name },
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      merchantId: admin.merchantId,
    },
    superAdmin: superAdmin
      ? { id: superAdmin.id, email: superAdmin.email, role: superAdmin.role, isActive: superAdmin.isActive }
      : null,
    });
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
