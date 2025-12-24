// backend/src/modules/auth/auth.service.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../../config/prisma");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const s = String(email || "").trim();
  // validação simples e suficiente para backend
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function buildError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function signToken(user) {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) throw buildError("JWT_SECRET_MISSING", 500);

  const expiresIn = process.env.JWT_EXPIRES_IN || "12h";

  return jwt.sign(
    {
      merchantId: user.merchantId,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    secret,
    {
      subject: String(user.id),
      expiresIn,
    }
  );
}

async function register({ name, email, password, merchantName }) {
  const n = String(name || "").trim();
  const m = String(merchantName || "").trim();
  const e = normalizeEmail(email);
  const p = String(password || "");

  if (!n || !m || !e || !p) throw buildError("MISSING_FIELDS", 400);
  if (!isValidEmail(e)) throw buildError("INVALID_EMAIL", 400);
  if (p.length < 6) throw buildError("WEAK_PASSWORD", 400);

  const exists = await prisma.user.findUnique({ where: { email: e } });
  if (exists) throw buildError("EMAIL_ALREADY_IN_USE", 400);

  const passwordHash = await bcrypt.hash(p, 10);

  return prisma.$transaction(async (tx) => {
    // 1) cria merchant
    const merchant = await tx.merchant.create({
      data: { name: m },
    });

    // 2) cria settings default (ambiente nasce consistente e “limpo”)
    // Ajuste os defaults conforme seu schema real (aqui está alinhado com seu app.js)
    await tx.merchantSettings.create({
      data: {
        merchantId: merchant.id,
        allowCredit: true,
        allowDebit: true,
        allowPix: true,
        allowCash: true,
        defaultPayment: "PIX",
        allowNegativeStock: false,
        decrementStockOnSale: true,
        receiptHeader: null,
        receiptFooter: null,
        reportsDefaultRange: "today",
        reportsMaxRows: 50,
      },
    });

    // 3) cria usuário OWNER
    const user = await tx.user.create({
      data: {
        name: n,
        email: e,
        passwordHash,
        role: "OWNER",
        isActive: true,
        merchantId: merchant.id,
      },
    });

    // 4) token
    const token = signToken(user);

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      merchantId: user.merchantId,
      isActive: user.isActive,
    };

    return { token, merchant, user: safeUser };
  });
}

async function login({ email, password }) {
  const e = normalizeEmail(email);
  const p = String(password || "");

  if (!e || !p) throw buildError("MISSING_FIELDS", 400);
  if (!isValidEmail(e)) throw buildError("INVALID_EMAIL", 400);

  const user = await prisma.user.findUnique({
    where: { email: e },
    include: { merchant: true },
  });

  if (!user) throw buildError("INVALID_CREDENTIALS", 401);
  if (user.isActive === false) throw buildError("USER_INACTIVE", 403);

  const valid = await bcrypt.compare(p, String(user.passwordHash || ""));
  if (!valid) throw buildError("INVALID_CREDENTIALS", 401);

  const token = signToken(user);

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    merchantId: user.merchantId,
    isActive: user.isActive,
  };

  return { token, user: safeUser, merchant: user.merchant };
}

async function getProfile(userId) {
  const id = Number(userId);
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      merchantId: true,
      merchant: true,
    },
  });
}

module.exports = {
  register,
  login,
  getProfile,
};
