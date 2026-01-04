const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/prisma");

function isDev() {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() === "development";
}

function requireDevMode(req, res) {
  if (!isDev()) {
    res.status(404).json({ ok: false, error: "NotFound", message: "Not Found" });
    return false;
  }
  return true;
}

function requireDevResetToken(req, res) {
  const expected = String(process.env.DEV_RESET_TOKEN || "").trim();
  if (!expected) {
    res.status(500).json({ ok: false, error: "Misconfigured", message: "DEV_RESET_TOKEN not configured" });
    return false;
  }

  const provided = String(req.headers["x-dev-reset-token"] || "").trim();
  if (!provided) {
    res.status(401).json({ ok: false, error: "Unauthorized", message: "x-dev-reset-token header missing" });
    return false;
  }
  if (provided !== expected) {
    res.status(403).json({ ok: false, error: "Forbidden", message: "Invalid reset token" });
    return false;
  }

  return true;
}

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const s = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function reset(req, res, next) {
  try {
    if (!requireDevMode(req, res)) return;
    if (!requireDevResetToken(req, res)) return;

    const result = await prisma.$transaction(async (tx) => {
      const deleted = {};

      deleted.saleItem = await tx.saleItem.deleteMany({});
      deleted.sale = await tx.sale.deleteMany({});

      deleted.paymentTransaction = await tx.paymentTransaction.deleteMany({});
      deleted.paymentIntent = await tx.paymentIntent.deleteMany({});

      deleted.printJob = await tx.printJob.deleteMany({});

      deleted.terminalApiKey = await tx.terminalApiKey.deleteMany({});
      deleted.terminalPairingCode = await tx.terminalPairingCode.deleteMany({});
      deleted.terminalProvisioningCode = await tx.terminalProvisioningCode.deleteMany({});

      deleted.product = await tx.product.deleteMany({});

      // Mantemos Merchant/User para não quebrar login do painel (reset "operacional")
      deleted.terminal = await tx.terminal.deleteMany({});

      return deleted;
    });

    return res.json({ ok: true, deleted: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.count])) });
  } catch (err) {
    return next(err);
  }
}

async function seed(req, res, next) {
  try {
    if (!requireDevMode(req, res)) return;
    if (!requireDevResetToken(req, res)) return;

    const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 0) || 10;

    const merchantName = "Demo Merchant";
    const userEmail = "demo@pdv.local";
    const userPassword = "123456";
    const userName = "Demo";

    const created = await prisma.$transaction(async (tx) => {
      let merchant = await tx.merchant.findFirst({
        where: { name: merchantName },
        select: { id: true, name: true },
      });
      if (!merchant) {
        merchant = await tx.merchant.create({ data: { name: merchantName }, select: { id: true, name: true } });
      }

      await tx.merchantSettings.upsert({
        where: { merchantId: merchant.id },
        update: {},
        create: {
          merchantId: merchant.id,
          allowCredit: true,
          allowDebit: true,
          allowPix: true,
          allowCash: true,
          defaultPayment: "PIX",
          stockEnabled: true,
          allowNegativeStock: false,
          decrementStockOnSale: true,
          reportsDefaultRange: "today",
          reportsMaxRows: 100,
        },
      });

      const passwordHash = await bcrypt.hash(userPassword, rounds);
      const user = await tx.user.upsert({
        where: { email: userEmail },
        update: {
          name: userName,
          passwordHash,
          role: "OWNER",
          isActive: true,
          merchantId: merchant.id,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
        create: {
          name: userName,
          email: userEmail,
          passwordHash,
          role: "OWNER",
          isActive: true,
          merchantId: merchant.id,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        },
      });

      // Terminal demo + chave (exibida uma vez)
      const terminalKey = randomBase64Url(32);
      const terminal = await tx.terminal.create({
        data: {
          merchantId: merchant.id,
          name: "SmartPOS Demo",
          identifier: `demo_${Date.now().toString(36)}`,
          apiKey: terminalKey, // legado/compat
          status: "OFFLINE",
        },
        select: { id: true, merchantId: true, name: true, identifier: true, status: true },
      });

      await tx.terminalApiKey.create({
        data: {
          terminalId: terminal.id,
          keyPrefix: terminalKey.slice(0, 8),
          keyHash: sha256Hex(terminalKey),
        },
      });

      // Produtos demo
      const products = await tx.product.createMany({
        data: [
          { merchantId: merchant.id, name: "Água", price: 3.5, stock: 100, category: "Bebidas", active: true },
          { merchantId: merchant.id, name: "Refrigerante", price: 7.9, stock: 50, category: "Bebidas", active: true },
          { merchantId: merchant.id, name: "Salgado", price: 9.9, stock: 30, category: "Lanches", active: true },
          { merchantId: merchant.id, name: "Doce", price: 6.5, stock: 40, category: "Lanches", active: true },
          { merchantId: merchant.id, name: "Café", price: 4.0, stock: 80, category: "Bebidas", active: true },
        ],
      });

      return { merchant, user, terminal, terminalKey, productsCreated: products.count };
    });

    return res.status(201).json({
      ok: true,
      merchant: { id: created.merchant.id, name: created.merchant.name },
      user: { email: userEmail, password: userPassword },
      terminal: created.terminal,
      terminalKey: created.terminalKey,
      productsCreated: created.productsCreated,
    });
  } catch (err) {
    return next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    if (!requireDevMode(req, res)) return;
    if (!requireDevResetToken(req, res)) return;

    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ ok: false, error: "MISSING_FIELDS", message: "email is required" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: "INVALID_EMAIL", message: "invalid email" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, isActive: true, emailVerified: true, emailVerifiedAt: true },
    });

    if (!user) {
      return res.status(404).json({ ok: false, error: "NotFound", message: "User not found" });
    }

    if (user.emailVerified === true) {
      return res.json({
        ok: true,
        alreadyVerified: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          emailVerified: true,
          emailVerifiedAt: user.emailVerifiedAt,
        },
      });
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { emailVerified: true, emailVerifiedAt: now, isActive: true },
      });
    });

    return res.json({
      ok: true,
      alreadyVerified: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isActive: true,
        emailVerified: true,
        emailVerifiedAt: now,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { reset, seed, verifyEmail };
