// backend/src/modules/auth/auth.service.js
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const prisma = require("../../config/prisma");
const { sendResetEmail, sendVerificationEmail } = require("../../services/mail");

function isProdEnv() {
  return String(process.env.NODE_ENV || "").trim() === "production";
}

function isDevEnv() {
  return !isProdEnv();
}

function passwordMinLen() {
  const v = Number(process.env.PASSWORD_MIN_LENGTH || 0) || 0;
  return v > 0 ? v : 6; // compatibilidade com comportamento anterior
}

function getGoogleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || "").trim();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const s = String(email || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function buildError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

function getWebResetUrl() {
  // URL pública da página de reset (sem token). Ex.:
  // DEV: http://127.0.0.1:5500/backend/public/reset-password.html
  // PROD: https://seu-dominio.com/reset-password.html
  const explicit = String(process.env.WEB_RESET_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const base = String(process.env.API_PUBLIC_URL || process.env.API_URL || process.env.BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) return "";
  return `${base}/reset-password.html`;
}

function buildResetLink(token) {
  const base = getWebResetUrl();
  if (!base) return "";
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}token=${encodeURIComponent(token)}`;
}

function getWebVerifyUrl() {
  // URL pública da página de verificação (sem token). Ex.:
  // DEV (Live Server): http://127.0.0.1:5500/backend/public/verify-email.html
  // PROD: https://seu-dominio.com/verify-email.html
  const explicit = String(process.env.WEB_VERIFY_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const base = String(process.env.API_PUBLIC_URL || process.env.API_URL || process.env.BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) return "";
  return `${base}/verify-email.html`;
}

function buildVerifyLink(token) {
  const base = getWebVerifyUrl();
  if (!base) return "";
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}token=${encodeURIComponent(token)}`;
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
  if (p.length < passwordMinLen()) throw buildError("WEAK_PASSWORD", 400);

  const exists = await prisma.user.findUnique({ where: { email: e } });
  if (exists) throw buildError("EMAIL_ALREADY_IN_USE", 400);

  const passwordHash = await bcrypt.hash(p, 10);

  const created = await prisma.$transaction(async (tx) => {
    const merchant = await tx.merchant.create({ data: { name: m } });

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

    const user = await tx.user.create({
      data: {
        name: n,
        email: e,
        passwordHash,
        role: "OWNER",
        isActive: true,
        merchantId: merchant.id,
        emailVerified: false,
        emailVerifiedAt: null,
      },
    });

    return { merchant, user };
  });

  // Cria token de verificação e envia e-mail (fora da transação)
  await createAndSendEmailVerificationToken(created.user.id, created.user.email, created.user.name);

  return {
    ok: true,
    message: "Enviamos um e-mail de confirmação. Verifique sua caixa de entrada e spam para ativar a conta.",
    merchant: { id: created.merchant.id, name: created.merchant.name },
  };
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
  if (user.emailVerified === false) throw buildError("EMAIL_NOT_VERIFIED", 403);

  const valid = await bcrypt.compare(p, String(user.passwordHash || ""));
  if (!valid) throw buildError("INVALID_CREDENTIALS", 401);

  if (String(user?.merchant?.status || "").toUpperCase() === "SUSPENDED") {
    throw buildError("MERCHANT_SUSPENDED", 403);
  }
  if (user?.merchant?.isLoginBlocked === true) {
    throw buildError("MERCHANT_LOGIN_BLOCKED", 403);
  }

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

function verificationTtlMs() {
  // default 24h
  const hours = Number(process.env.EMAIL_VERIFY_TTL_HOURS || 0) || 24;
  return Math.max(1, Math.min(168, hours)) * 60 * 60 * 1000;
}

async function createAndSendEmailVerificationToken(userId, toEmail, name) {
  const webBase = getWebVerifyUrl();
  const isProd = isProdEnv();

  if (!webBase) {
    if (isProd) {
      console.error("[MAIL] WEB_VERIFY_URL ausente em produção; verificação de e-mail não pode gerar link.");
    } else {
      console.warn("[MAIL DEV] WEB_VERIFY_URL ausente; não foi possível montar o link.");
      console.warn("[MAIL DEV] Dica: defina WEB_VERIFY_URL apontando para verify-email.html.");
    }
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + verificationTtlMs());

  // Invalida tokens antigos ainda ativos (evita múltiplos links válidos)
  await prisma.emailVerificationToken.updateMany({
    where: { userId: Number(userId), usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.emailVerificationToken.create({
    data: {
      userId: Number(userId),
      tokenHash,
      expiresAt,
      usedAt: null,
    },
  });

  const verifyLink = buildVerifyLink(token);
  await sendVerificationEmail(toEmail, verifyLink);
}

async function verifyEmail({ token }) {
  const t = String(token || "").trim();
  if (!t) throw buildError("MISSING_FIELDS", 400);

  const tokenHash = sha256Hex(t);

  const found = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  // Mantém códigos existentes para não quebrar controller/mapeamento atual
  if (!found) throw buildError("RESET_TOKEN_INVALID", 400);
  if (found.usedAt) throw buildError("RESET_TOKEN_USED", 400);
  if (found.expiresAt && new Date(found.expiresAt).getTime() < Date.now()) throw buildError("RESET_TOKEN_INVALID", 400);

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({
      where: { id: found.id },
      data: { usedAt: new Date() },
    });

    await tx.user.update({
      where: { id: found.userId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        isActive: true,
      },
    });
  });

  return { message: "E-mail verificado com sucesso. Você já pode fazer login." };
}

async function resendVerification({ email }) {
  const e = normalizeEmail(email);
  if (!e || !isValidEmail(e)) return;

  const user = await prisma.user.findUnique({
    where: { email: e },
    select: { id: true, email: true, name: true, emailVerified: true, isActive: true },
  });
  if (!user) return;
  if (user.emailVerified) return;

  // cooldown simples: 1/min por usuário (usa token mais recente)
  const last = await prisma.emailVerificationToken.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last?.createdAt && Date.now() - new Date(last.createdAt).getTime() < 60_000) return;

  await createAndSendEmailVerificationToken(user.id, user.email, user.name);
}

async function forgotPassword({ email }) {
  const e = normalizeEmail(email);

  if (isDevEnv()) {
    console.log("[DEV AUTH] forgot-password handler reached");
    console.log(`[DEV AUTH] email normalized=${e || "(vazio)"}`);
  }

  // Resposta sempre uniforme; validações aqui só para evitar carga desnecessária
  if (!e || !isValidEmail(e)) {
    if (isDevEnv()) console.log("[DEV AUTH] invalid email (skipping)");
    return { ok: true };
  }

  const user = await prisma.user.findUnique({
    where: { email: e },
    select: { id: true, email: true },
  });

  if (!user) {
    if (isDevEnv()) console.log("[DEV AUTH] user not found (no email sent)");
    return { ok: true };
  }

  if (isDevEnv()) console.log("[DEV AUTH] user found (will send reset email)");

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });
  });

  const resetLink = buildResetLink(token);
  if (!resetLink) {
    if (isProdEnv()) {
      console.error("[MAIL] WEB_RESET_URL ausente em produção; reset de senha não pode gerar link.");
    } else {
      console.warn("[MAIL DEV] WEB_RESET_URL ausente; não foi possível montar o link.");
      console.warn("[MAIL DEV] Dica: defina WEB_RESET_URL apontando para reset-password.html.");
      console.warn(`[MAIL DEV] Token: ${token}`);
    }
    return { ok: true };
  }

  if (isDevEnv()) console.log("[MAIL] sending reset email ...");
  await sendResetEmail(user.email, resetLink);

  return { ok: true };
}

async function resetPassword({ token, password }) {
  const t = String(token || "").trim();
  const p = String(password || "");

  if (!t || t.length < 10) throw buildError("RESET_TOKEN_INVALID", 400);
  if (p.length < passwordMinLen()) throw buildError("WEAK_PASSWORD", 400);

  const tokenHash = sha256Hex(t);
  const now = new Date();

  const rec = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!rec) throw buildError("RESET_TOKEN_INVALID", 400);
  if (rec.usedAt) throw buildError("RESET_TOKEN_USED", 400);
  if (rec.expiresAt && rec.expiresAt.getTime() < now.getTime()) {
    throw buildError("RESET_TOKEN_INVALID", 400);
  }

  const passwordHash = await bcrypt.hash(p, 10);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: rec.userId },
      data: { passwordHash },
    });

    await tx.passwordResetToken.update({
      where: { id: rec.id },
      data: { usedAt: now },
    });
  });

  return { ok: true };
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const uid = Number(userId);
  const cur = String(currentPassword || "");
  const next = String(newPassword || "");

  if (!uid || Number.isNaN(uid)) throw buildError("MISSING_FIELDS", 400);
  if (!cur || !next) throw buildError("MISSING_FIELDS", 400);
  if (next.length < passwordMinLen()) throw buildError("WEAK_PASSWORD", 400);

  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true, passwordHash: true },
  });

  if (!user) throw buildError("INVALID_CREDENTIALS", 401);

  const valid = await bcrypt.compare(cur, String(user.passwordHash || ""));
  if (!valid) throw buildError("INVALID_CURRENT_PASSWORD", 400);

  const same = await bcrypt.compare(next, String(user.passwordHash || ""));
  if (same) throw buildError("SAME_PASSWORD", 400);

  const passwordHash = await bcrypt.hash(next, 10);

  await prisma.user.update({
    where: { id: uid },
    data: { passwordHash },
  });

  return { ok: true };
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

// Mantém apenas UMA versão
function maskEmail(input) {
  const e = String(input || "").trim().toLowerCase();
  const [name, domain] = e.split("@");
  if (!name || !domain) return "";
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
}

function isDevLogEnabled() {
  return isDevEnv();
}

let googleClient = null;
function getGoogleClient() {
  if (googleClient) return googleClient;
  const clientId = getGoogleClientId();
  googleClient = new OAuth2Client(clientId || undefined);
  return googleClient;
}

async function verifyGoogleIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!token) throw buildError("MISSING_FIELDS", 400);

  const clientId = getGoogleClientId();
  if (!clientId) throw buildError("GOOGLE_CLIENT_ID_MISSING", 500);

  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: token,
      audience: clientId,
    });
    const payload = ticket.getPayload() || {};

    const iss = String(payload.iss || "");
    if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") {
      throw new Error("issuer invalid");
    }

    const aud = String(payload.aud || "");
    if (aud !== clientId) {
      throw new Error("audience mismatch");
    }

    const exp = Number(payload.exp || 0) || 0;
    const now = Math.floor(Date.now() / 1000);
    if (!exp || exp < now) {
      throw new Error("token expired");
    }

    return payload;
  } catch (err) {
    if (isDevLogEnabled()) {
      console.warn("[GOOGLE AUTH] verify FAIL", {
        message: String(err?.message || err),
      });
    }
    throw buildError("INVALID_GOOGLE_TOKEN", 401);
  }
}

async function googleAuth({ idToken }) {
  const payload = await verifyGoogleIdToken(idToken);

  const googleSub = String(payload.sub || "").trim();
  const email = normalizeEmail(payload.email);
  const name = String(payload.name || payload.given_name || "").trim() || email;
  const picture = String(payload.picture || "").trim() || null;
  const emailVerified = payload.email_verified === true;

  if (!googleSub || !email) throw buildError("INVALID_GOOGLE_TOKEN", 401);
  if (!emailVerified) throw buildError("GOOGLE_EMAIL_NOT_VERIFIED", 401);

  if (isDevLogEnabled()) {
    console.log(`[GOOGLE AUTH] token ok email=${maskEmail(email)}`);
  }

  // 1) Preferir login por googleSub (se já vinculado)
  const bySub = await prisma.user.findUnique({
    where: { googleSub },
    include: { merchant: true },
  });

  if (bySub) {
    if (bySub.isActive === false) throw buildError("USER_INACTIVE", 403);
    if (String(bySub?.merchant?.status || "").toUpperCase() === "SUSPENDED") {
      throw buildError("MERCHANT_SUSPENDED", 403);
    }
    if (bySub?.merchant?.isLoginBlocked === true) {
      throw buildError("MERCHANT_LOGIN_BLOCKED", 403);
    }

    const token = signToken(bySub);

    if (isDevLogEnabled()) console.log(`[GOOGLE AUTH] login email=${maskEmail(bySub.email)} userId=${bySub.id}`);

    return {
      ok: true,
      token,
      user: {
        id: bySub.id,
        name: bySub.name,
        email: bySub.email,
        role: bySub.role,
        merchantId: bySub.merchantId,
        isActive: bySub.isActive,
        emailVerified: bySub.emailVerified === true,
      },
      merchant: bySub.merchant,
      created: false,
      needsEmailVerify: bySub.emailVerified !== true,
    };
  }

  // 2) Login por e-mail (vincular se necessário)
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { merchant: true },
  });

  if (existing) {
    if (existing.isActive === false) throw buildError("USER_INACTIVE", 403);
    if (String(existing?.merchant?.status || "").toUpperCase() === "SUSPENDED") {
      throw buildError("MERCHANT_SUSPENDED", 403);
    }
    if (existing?.merchant?.isLoginBlocked === true) {
      throw buildError("MERCHANT_LOGIN_BLOCKED", 403);
    }

    // Se já estiver vinculado a outro sub, bloqueia
    if (existing.googleSub && existing.googleSub !== googleSub) {
      throw buildError("ACCOUNT_CONFLICT", 409);
    }

    // Vincular (emailVerified aqui já é true)
    if (!existing.googleSub) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          googleSub,
          provider: "GOOGLE",
          avatarUrl: picture,
          emailVerified: emailVerified ? true : existing.emailVerified,
          emailVerifiedAt: emailVerified ? new Date() : existing.emailVerifiedAt,
        },
      });

      if (isDevLogEnabled()) console.log(`[GOOGLE AUTH] linked email=${maskEmail(existing.email)} userId=${existing.id}`);
    } else if (isDevLogEnabled()) {
      console.log(`[GOOGLE AUTH] login email=${maskEmail(existing.email)} userId=${existing.id}`);
    }

    const refreshed = existing.googleSub
      ? existing
      : await prisma.user.findUnique({ where: { id: existing.id }, include: { merchant: true } });

    if (String(refreshed?.merchant?.status || "").toUpperCase() === "SUSPENDED") {
      throw buildError("MERCHANT_SUSPENDED", 403);
    }
    if (refreshed?.merchant?.isLoginBlocked === true) {
      throw buildError("MERCHANT_LOGIN_BLOCKED", 403);
    }

    const token = signToken(refreshed);
    return {
      ok: true,
      token,
      user: {
        id: refreshed.id,
        name: refreshed.name,
        email: refreshed.email,
        role: refreshed.role,
        merchantId: refreshed.merchantId,
        isActive: refreshed.isActive,
        emailVerified: refreshed.emailVerified === true,
      },
      merchant: refreshed.merchant,
      created: false,
      needsEmailVerify: refreshed.emailVerified !== true,
    };
  }

  // 3) Criar conta nova (cria Merchant + Settings como no register)
  const randomPassword = crypto.randomBytes(32).toString("hex");
  const passwordHash = await bcrypt.hash(randomPassword, 10);
  const merchantName = name || "Meu estabelecimento";

  const created = await prisma.$transaction(async (tx) => {
    const merchant = await tx.merchant.create({ data: { name: merchantName } });

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

    const user = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "OWNER",
        isActive: true,
        merchantId: merchant.id,
        provider: "GOOGLE",
        googleSub,
        avatarUrl: picture,
        emailVerified,
        emailVerifiedAt: emailVerified ? new Date() : null,
      },
      include: { merchant: true },
    });

    return user;
  });

  const token = signToken(created);

  if (isDevLogEnabled()) console.log(`[GOOGLE AUTH] created email=${maskEmail(created.email)} userId=${created.id}`);

  return {
    ok: true,
    token,
    user: {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      merchantId: created.merchantId,
      isActive: created.isActive,
      emailVerified: created.emailVerified === true,
    },
    merchant: created.merchant,
    created: true,
    needsEmailVerify: created.emailVerified !== true,
  };
}

module.exports = {
  register,
  login,
  getProfile,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  resendVerification,
  googleAuth,
};
