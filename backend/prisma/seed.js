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
  const passwordHash = await bcrypt.hash(String(adminPassword), 10);

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

  console.log("✅ Seed executado com sucesso:");
  console.log({
    merchant: { id: merchant.id, name: merchant.name },
    admin: {
      id: admin.id,
      email: admin.email,
      password: adminPassword,
      role: admin.role,
      merchantId: admin.merchantId,
    },
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
