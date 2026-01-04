const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const prisma = require("../../config/prisma");
const { writeAuditLog } = require("../../services/auditLog");
const billing = require("../../services/billing");
const { sendAdminResetEmail } = require("../../services/mail");
const { sendEmail } = require("../mailer/mailer.service");
const { interpolate } = require("../mailer/mailer.templates");
const { isValidEmail: isValidEmailAddr, normalizeEmail: normalizeEmailAddr, escapeHtml } = require("../mailer/mailer.validators");

function buildError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function isDevEnv() {
  return String(process.env.NODE_ENV || "development")
    .trim()
    .toLowerCase() === "development";
}

function prismaHasModel(modelName) {
  const name = String(modelName || "").trim();
  if (!name) return false;

  // Prisma Client >= 5: `_runtimeDataModel` (obj keyed by model name)
  const runtimeModels = prisma?._runtimeDataModel?.models;
  if (runtimeModels && typeof runtimeModels === "object") {
    if (runtimeModels[name]) return true;
  }

  // Older Prisma Client: `_dmmf` (array of models)
  const dmmfModels = prisma?._dmmf?.datamodel?.models;
  if (!Array.isArray(dmmfModels)) return false;
  return dmmfModels.some((m) => m?.name === name);
}

function prismaHasField(modelName, fieldName) {
  const mName = String(modelName || "").trim();
  const fName = String(fieldName || "").trim();
  if (!mName || !fName) return false;

  // Prisma Client >= 5: `_runtimeDataModel`
  const runtimeModels = prisma?._runtimeDataModel?.models;
  const runtimeModel = runtimeModels && typeof runtimeModels === "object" ? runtimeModels[mName] : null;
  const runtimeFields = runtimeModel?.fields;
  if (Array.isArray(runtimeFields)) {
    return runtimeFields.some((f) => f?.name === fName);
  }

  // Older Prisma Client: `_dmmf`
  const dmmfModels = prisma?._dmmf?.datamodel?.models;
  if (!Array.isArray(dmmfModels)) return false;
  const model = dmmfModels.find((m) => m?.name === mName);
  const fields = model?.fields;
  if (!Array.isArray(fields)) return false;
  return fields.some((f) => f?.name === fName);
}

function bcryptRounds() {
  const raw = Number(process.env.BCRYPT_SALT_ROUNDS || 0) || 0;
  return raw >= 4 && raw <= 15 ? raw : 10;
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

function passwordMinLen() {
  const v = Number(process.env.PASSWORD_MIN_LENGTH || 0) || 0;
  return v > 0 ? v : 6;
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

function getAdminJwtSecret() {
  return String(process.env.ADMIN_JWT_SECRET || "").trim();
}

function signAdminToken(admin) {
  const secret = getAdminJwtSecret();
  if (!secret) throw buildError("ADMIN_JWT_SECRET_MISSING", 500);

  const expiresIn = String(process.env.ADMIN_JWT_EXPIRES_IN || "7d").trim();

  return jwt.sign(
    {
      role: admin.role,
      email: admin.email,
      name: admin.name,
      type: "ADMIN",
    },
    secret,
    {
      subject: String(admin.id),
      expiresIn,
    }
  );
}

async function login({ email, password }) {
  const e = normalizeEmail(email);
  const p = String(password || "");

  if (!e || !p) throw buildError("MISSING_FIELDS", 400);
  if (!isValidEmail(e)) throw buildError("INVALID_EMAIL", 400);

  const admin = await prisma.adminUser.findUnique({
    where: { email: e },
    select: { id: true, email: true, name: true, role: true, isActive: true, passwordHash: true },
  });

  // Nao vazar se existe/esta desativado
  if (!admin) throw buildError("INVALID_CREDENTIALS", 401);
  if (admin.isActive === false) throw buildError("INVALID_CREDENTIALS", 401);

  const stored = String(admin.passwordHash || "");
  const looksHashed = isBcryptHash(stored);
  let valid = false;

  if (looksHashed) {
    valid = await bcrypt.compare(p, stored);
  } else {
    // compat: se algum admin foi criado/alterado via Studio com senha em texto puro,
    // permite login uma vez e faz upgrade para hash.
    valid = p === stored;
    if (valid) {
      const upgradedHash = await bcrypt.hash(p, bcryptRounds());
      await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash: upgradedHash } });
    }
  }

  if (!valid) throw buildError("INVALID_CREDENTIALS", 401);

  const token = signAdminToken(admin);

  return {
    ok: true,
    token,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role, isActive: admin.isActive },
  };
}

function normalizeMerchantStatus(v) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "ACTIVE" || s === "SUSPENDED") return s;
  return null;
}

function getAdminBootstrapToken() {
  return String(process.env.ADMIN_BOOTSTRAP_TOKEN || "").trim();
}

async function bootstrapFirstSuperAdmin({ headerToken, email, password, name }) {
  const expected = getAdminBootstrapToken();
  if (!expected) throw buildError("Not found", 404);
  if (!headerToken || String(headerToken).trim() !== expected) throw buildError("Forbidden", 403);

  const e = normalizeEmail(email);
  const p = String(password || "").trim();
  const n = String(name || "").trim() || "SuperDono";

  if (!e || !p) throw buildError("MISSING_FIELDS", 400);
  if (!isValidEmail(e)) throw buildError("INVALID_EMAIL", 400);
  if (p.length < passwordMinLen()) throw buildError("WEAK_PASSWORD", 400);

  const count = await prisma.adminUser.count();
  if (count > 0) throw buildError("ADMIN_ALREADY_EXISTS", 409);

  const hash = await bcrypt.hash(p, bcryptRounds());

  const created = await prisma.adminUser.create({
    data: { email: e, name: n, passwordHash: hash, role: "SUPER_ADMIN", isActive: true },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return { admin: created };
}

async function devBootstrapSuperAdminFromEnv() {
  const email = normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL || process.env.SUPERADMIN_EMAIL);
  const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || process.env.SUPERADMIN_PASSWORD || "").trim();
  const name = String(process.env.SUPERADMIN_NAME || "SuperDono").trim() || "SuperDono";

  if (!email || !password) throw buildError("ADMIN_BOOTSTRAP_ENV_MISSING", 400);
  if (!isValidEmail(email)) throw buildError("INVALID_EMAIL", 400);

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  const nextHash = await bcrypt.hash(password, bcryptRounds());

  if (existing) {
    const updated = await prisma.adminUser.update({
      where: { id: existing.id },
      data: { email, name, role: "SUPER_ADMIN", isActive: true, passwordHash: nextHash },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    return { admin: updated, migratedPlainText: !isBcryptHash(existing.passwordHash) };
  }

  const created = await prisma.adminUser.create({
    data: { email, name, role: "SUPER_ADMIN", isActive: true, passwordHash: nextHash },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return { admin: created, migratedPlainText: false };
}

function adminResetTtlMs() {
  const hours = Number(process.env.ADMIN_RESET_TOKEN_TTL_HOURS || 0) || 24;
  return Math.max(1, Math.min(168, hours)) * 60 * 60 * 1000;
}

function getAdminResetUrlBase() {
  const explicit = String(process.env.ADMIN_WEB_RESET_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const apiUrl = String(process.env.API_URL || "").trim().replace(/\/$/, "");
  if (apiUrl) return `${apiUrl}/admin/reset-password.html`;

  return "";
}

function buildAdminResetLink(token) {
  const base = getAdminResetUrlBase();
  if (!base) return "";
  const join = base.includes("?") ? "&" : "?";
  return `${base}${join}token=${encodeURIComponent(token)}`;
}

async function forgotPassword({ email }) {
  const e = normalizeEmail(email);
  if (!e || !isValidEmail(e)) return;

  const admin = await prisma.adminUser.findUnique({
    where: { email: e },
    select: { id: true, email: true, isActive: true },
  });
  if (!admin) return;
  if (admin.isActive === false) return;

  const base = getAdminResetUrlBase();
  if (!base) {
    console.warn("[MAIL DEV] ADMIN_WEB_RESET_URL/API_URL ausente; não foi possível montar link de reset do admin.");
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + adminResetTtlMs());

  // invalida tokens anteriores ativos
  await prisma.adminPasswordResetToken.updateMany({
    where: { adminId: admin.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  await prisma.adminPasswordResetToken.create({
    data: { adminId: admin.id, tokenHash, expiresAt, usedAt: null },
  });

  const link = buildAdminResetLink(token);
  await sendAdminResetEmail(admin.email, link);
}

async function resetPassword({ token, newPassword }) {
  const t = String(token || "").trim();
  const next = String(newPassword || "");

  if (!t || !next) throw buildError("MISSING_FIELDS", 400);
  if (next.length < passwordMinLen()) throw buildError("WEAK_PASSWORD", 400);

  const tokenHash = sha256Hex(t);

  const found = await prisma.adminPasswordResetToken.findUnique({
    where: { tokenHash },
    include: { admin: true },
  });

  if (!found) throw buildError("RESET_TOKEN_INVALID", 400);
  if (found.usedAt) throw buildError("RESET_TOKEN_USED", 400);
  if (found.expiresAt && new Date(found.expiresAt).getTime() < Date.now()) throw buildError("RESET_TOKEN_INVALID", 400);

  const nextHash = await bcrypt.hash(next, bcryptRounds());

  await prisma.$transaction(async (tx) => {
    await tx.adminPasswordResetToken.update({
      where: { id: found.id },
      data: { usedAt: new Date() },
    });

    await tx.adminUser.update({
      where: { id: found.adminId },
      data: { passwordHash: nextHash, isActive: true },
    });
  });

  return { message: "Senha atualizada com sucesso." };
}

function emailRateLimits() {
  const perMerchantDay = Number(process.env.ADMIN_EMAIL_MAX_PER_MERCHANT_PER_DAY || 0) || 5;
  const perAdminHour = Number(process.env.ADMIN_EMAIL_MAX_PER_ADMIN_PER_HOUR || 0) || 40;
  return { perMerchantDay, perAdminHour };
}

async function getMerchantPrimaryEmail(merchantId) {
  const mid = Number(merchantId);
  if (!mid) throw buildError("Invalid merchant id", 400);

  const merchant = await prisma.merchant.findUnique({
    where: { id: mid },
    select: {
      id: true,
      name: true,
      status: true,
      subscription: { select: { status: true, plan: true, billingDueAt: true, graceDays: true } },
      settings: { select: { tradeName: true, phone: true, address: true } },
      cnpj: true,
      users: { where: { role: "OWNER" }, select: { email: true }, take: 1 },
    },
  });

  if (!merchant) throw buildError("Merchant not found", 404);

  const ownerEmail = merchant?.users?.[0]?.email || "";
  const email = normalizeEmailAddr(ownerEmail);
  return { merchant, email };
}

function buildHtmlFromPlainText(text) {
  const safe = escapeHtml(text).replace(/\r?\n/g, "<br/>");
  return `<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4">${safe}</div>`;
}

function buildTemplateVars({ merchant, metadata }) {
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const supportEmail = String(process.env.SUPPORT_EMAIL || "").trim() || "suporte@paytech.app.br";
  const portalUrl = String(process.env.ADMIN_PORTAL_URL || "").trim() || "";
  const billingUrl = String(meta.billingUrl || "").trim() || portalUrl || "";

  return {
    merchantName: merchant?.name || "",
    plan: merchant?.subscription?.plan || "",
    overdueDays: meta.overdueDays ?? "",
    supportEmail,
    portalUrl,
    billingUrl,
  };
}

async function listEmailTemplates() {
  if (!prisma.emailMessageTemplate) throw buildError("EMAIL_SCHEMA_NOT_READY", 500);
  const templates = await prisma.emailMessageTemplate.findMany({
    where: { isActive: true },
    orderBy: { key: "asc" },
    select: { id: true, key: true, subject: true, bodyHtml: true, bodyText: true, isActive: true, createdAt: true, updatedAt: true },
  });
  return { templates };
}

async function createEmailTemplate({ key, subject, bodyHtml, bodyText, isActive }) {
  if (!prisma.emailMessageTemplate) throw buildError("EMAIL_SCHEMA_NOT_READY", 500);
  const k = String(key || "").trim().toUpperCase();
  const s = String(subject || "").trim();
  const html = String(bodyHtml || "").trim();
  const text = bodyText === undefined ? null : String(bodyText || "").trim() || null;

  if (!k || !s || !html) throw buildError("MISSING_FIELDS", 400);

  const created = await prisma.emailMessageTemplate.create({
    data: { key: k, subject: s, bodyHtml: html, bodyText: text, isActive: isActive !== false },
  });

  return { template: created };
}

async function patchEmailTemplate({ id, patch }) {
  if (!prisma.emailMessageTemplate) throw buildError("EMAIL_SCHEMA_NOT_READY", 500);
  const tid = Number(id);
  if (!tid) throw buildError("Invalid template id", 400);

  const data = {};
  if (patch?.key !== undefined) data.key = String(patch.key || "").trim().toUpperCase();
  if (patch?.subject !== undefined) data.subject = String(patch.subject || "").trim();
  if (patch?.bodyHtml !== undefined) data.bodyHtml = String(patch.bodyHtml || "").trim();
  if (patch?.bodyText !== undefined) data.bodyText = patch.bodyText === null ? null : String(patch.bodyText || "").trim() || null;
  if (patch?.isActive !== undefined) data.isActive = Boolean(patch.isActive);

  const updated = await prisma.emailMessageTemplate.update({ where: { id: tid }, data });
  return { template: updated };
}

async function sendMerchantEmail({ merchantId, adminId, templateKey, subject, message, reason, metadata }) {
  if (!prisma.emailLog || !prisma.emailMessageTemplate) throw buildError("EMAIL_SCHEMA_NOT_READY", 500);
  const { merchant, email } = await getMerchantPrimaryEmail(merchantId);

  if (!email || !isValidEmailAddr(email)) throw buildError("INVALID_EMAIL", 400);

  const { perMerchantDay, perAdminHour } = emailRateLimits();
  const now = Date.now();

  const merchantCount = await prisma.emailLog.count({
    where: { merchantId: merchant.id, createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
  });
  if (merchantCount >= perMerchantDay) throw buildError("EMAIL_RATE_LIMIT", 429);

  if (adminId) {
    const adminCount = await prisma.emailLog.count({
      where: { adminId: Number(adminId), createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
    });
    if (adminCount >= perAdminHour) throw buildError("EMAIL_RATE_LIMIT", 429);
  }

  const tKey = String(templateKey || "").trim().toUpperCase() || null;
  const subjIn = String(subject || "").trim();
  const msgIn = String(message || "").trim();

  let finalSubject = subjIn;
  let finalText = msgIn;
  let finalHtml = msgIn ? buildHtmlFromPlainText(msgIn) : "";

  if (tKey) {
    const template = await prisma.emailMessageTemplate.findUnique({ where: { key: tKey } });
    if (!template || template.isActive === false) throw buildError("TEMPLATE_NOT_FOUND", 404);

    const vars = buildTemplateVars({ merchant, metadata });

    // defaults do template
    finalSubject = interpolate(template.subject, vars);
    finalText = template.bodyText ? interpolate(template.bodyText, vars) : "";
    finalHtml = interpolate(template.bodyHtml, vars);

    // overrides opcionais pelo portal
    if (subjIn) finalSubject = interpolate(subjIn, vars);
    if (msgIn) {
      finalText = interpolate(msgIn, vars);
      finalHtml = buildHtmlFromPlainText(finalText);
    }
  } else {
    if (!finalSubject || !finalText) throw buildError("MISSING_FIELDS", 400);
  }

  const log = await prisma.emailLog.create({
    data: {
      merchantId: merchant.id,
      adminId: adminId ? Number(adminId) : null,
      templateKey: tKey,
      subject: finalSubject,
      toEmail: email,
      status: "QUEUED",
      provider: "SMTP",
      metadata: {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        reason: String(reason || "").trim() || null,
      },
    },
    select: { id: true, status: true },
  });

  try {
    const sent = await sendEmail({ to: email, subject: finalSubject, text: finalText, html: finalHtml });

    const updated = await prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: "SENT",
        provider: sent.provider,
        providerMessageId: sent.providerMessageId,
        sentAt: new Date(),
      },
      select: { id: true, status: true },
    });

    await writeAuditLog({
      actorType: "ADMIN",
      actorId: adminId ? Number(adminId) : 0,
      merchantId: merchant.id,
      action: "ADMIN_EMAIL_SENT",
      ip: null,
      userAgent: null,
      payload: { templateKey: tKey, toEmail: email },
    });

    return { logId: updated.id, status: updated.status };
  } catch (err) {
    await prisma.emailLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        provider: "SMTP",
        errorMessage: String(err?.message || err || "").slice(0, 2000),
      },
    });
    throw buildError("EMAIL_SEND_FAILED", 500);
  }
}

async function listMerchantEmails({ merchantId, page, limit }) {
  if (!prisma.emailLog) throw buildError("EMAIL_SCHEMA_NOT_READY", 500);
  const mid = Number(merchantId);
  if (!mid) throw buildError("Invalid merchant id", 400);

  const take = Math.min(100, Math.max(1, Number(limit || 0) || 20));
  const skip = Math.max(0, (Number(page || 0) || 0) * take);

  const logs = await prisma.emailLog.findMany({
    where: { merchantId: mid },
    orderBy: { createdAt: "desc" },
    take,
    skip,
    select: {
      id: true,
      templateKey: true,
      subject: true,
      toEmail: true,
      status: true,
      provider: true,
      providerMessageId: true,
      errorMessage: true,
      metadata: true,
      createdAt: true,
      sentAt: true,
      admin: { select: { id: true, email: true, name: true } },
    },
  });

  return { logs };
}

function normalizeSort(sort) {
  const s = String(sort || "").trim().toLowerCase();
  if (!s) return "activity_desc";
  if (s === "activity" || s === "last_activity" || s === "lastactivity" || s === "activity_desc") return "activity_desc";
  if (s === "activity_asc") return "activity_asc";
  if (s === "sales" || s === "sales_desc") return "sales_desc";
  if (s === "sales_asc") return "sales_asc";
  if (s === "name" || s === "name_asc") return "name_asc";
  if (s === "name_desc") return "name_desc";
  if (s === "created" || s === "created_desc") return "created_desc";
  if (s === "created_asc") return "created_asc";
  return "activity_desc";
}

function sortNullableDate(a, b, dir) {
  const av = a ? new Date(a).getTime() : 0;
  const bv = b ? new Date(b).getTime() : 0;
  return dir === "asc" ? av - bv : bv - av;
}

async function listMerchants({ status, search, query, sort }) {
  const s = status ? normalizeMerchantStatus(status) : null;
  const q = String(query || search || "").trim();

  const where = {};
  if (s) where.status = s;
  // Se a loja foi "apagada" parcialmente (ex.: usuário OWNER removido no banco),
  // ela não deve aparecer no Admin como cliente válido.
  where.users = { some: { role: "OWNER" } };

  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { cnpj: { contains: q } },
      { users: { some: { email: { contains: q, mode: "insensitive" } } } },
      { users: { some: { name: { contains: q, mode: "insensitive" } } } },
      { settings: { is: { tradeName: { contains: q, mode: "insensitive" } } } },
      { settings: { is: { phone: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const merchantSelect = {
    id: true,
    name: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    users: { where: { role: "OWNER" }, select: { id: true, name: true, email: true }, take: 1 },
    _count: { select: { users: true, sales: true, terminals: true } },
  };

  if (prismaHasField("Merchant", "cnpj")) merchantSelect.cnpj = true;
  if (prismaHasField("Merchant", "billingDueAt")) merchantSelect.billingDueAt = true;
  if (prismaHasField("Merchant", "suspendedReason")) merchantSelect.suspendedReason = true;
  if (prismaHasField("Merchant", "isLoginBlocked")) merchantSelect.isLoginBlocked = true;
  if (prismaHasField("Merchant", "loginBlockedReason")) merchantSelect.loginBlockedReason = true;
  if (prismaHasField("Merchant", "adminNotes")) merchantSelect.adminNotes = true;

  if (prismaHasField("Merchant", "settings")) merchantSelect.settings = { select: { tradeName: true, phone: true } };
  if (prismaHasField("Merchant", "subscription"))
    merchantSelect.subscription = { select: { status: true, billingDueAt: true, graceDays: true } };

  const merchants = await prisma.merchant.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: merchantSelect,
    take: 500,
  });

  const merchantIds = merchants.map((m) => m.id);

  const [loginAgg, activityAgg] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["merchantId"],
      where: { merchantId: { in: merchantIds }, actorType: "USER", action: "AUTH_LOGIN" },
      _max: { createdAt: true },
    }),
    prisma.auditLog.groupBy({
      by: ["merchantId"],
      where: { merchantId: { in: merchantIds }, actorType: "USER" },
      _max: { createdAt: true },
    }),
  ]);

  const lastLoginByMerchantId = new Map(loginAgg.map((r) => [r.merchantId, r._max.createdAt]));
  const lastActivityByMerchantId = new Map(activityAgg.map((r) => [r.merchantId, r._max.createdAt]));

  const mapped = merchants.map((m) => ({
    id: m.id,
    name: m.name,
    tradeName: m.settings?.tradeName || null,
    owner: m.users?.[0] ? { id: m.users[0].id, name: m.users[0].name, email: m.users[0].email } : null,
    phone: m.settings?.phone || null,
    cnpj: m.cnpj || null,
    status: m.status,
    suspendedReason: m.suspendedReason || null,
    billingDueAt: m.billingDueAt || null,
    paymentStatus: m.subscription?.status || null,
    isLoginBlocked: Boolean(m.isLoginBlocked),
    loginBlockedReason: m.loginBlockedReason || null,
    adminNotes: m.adminNotes || null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    lastLoginAt: lastLoginByMerchantId.get(m.id) || null,
    lastActivityAt: lastActivityByMerchantId.get(m.id) || null,
    counts: {
      users: m._count?.users ?? 0,
      sales: m._count?.sales ?? 0,
      terminals: m._count?.terminals ?? 0,
    },
  }));

  const sortKey = normalizeSort(sort);
  mapped.sort((a, b) => {
    if (sortKey === "name_asc") return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
    if (sortKey === "name_desc") return String(b.name || "").localeCompare(String(a.name || ""), "pt-BR");
    if (sortKey === "sales_desc") return (b.counts?.sales || 0) - (a.counts?.sales || 0);
    if (sortKey === "sales_asc") return (a.counts?.sales || 0) - (b.counts?.sales || 0);
    if (sortKey === "created_asc") return sortNullableDate(a.createdAt, b.createdAt, "asc");
    if (sortKey === "created_desc") return sortNullableDate(a.createdAt, b.createdAt, "desc");
    if (sortKey === "activity_asc") return sortNullableDate(a.lastActivityAt, b.lastActivityAt, "asc");
    return sortNullableDate(a.lastActivityAt, b.lastActivityAt, "desc");
  });

  const stats = mapped.reduce(
    (acc, m) => {
      acc.total += 1;
      if (String(m.status).toUpperCase() === "ACTIVE") acc.active += 1;
      if (String(m.status).toUpperCase() === "SUSPENDED") acc.suspended += 1;
      acc.sales += m.counts?.sales || 0;
      acc.terminals += m.counts?.terminals || 0;
      return acc;
    },
    { total: 0, active: 0, suspended: 0, sales: 0, terminals: 0 }
  );

  return { merchants: mapped, stats };
}

async function getMerchant({ id }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const merchantSelect = {
    id: true,
    name: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    settings: true,
    terminals: {
      select: { id: true, name: true, identifier: true, status: true, lastSeenAt: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "desc" },
    },
    users: { select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true }, orderBy: { createdAt: "desc" } },
    _count: { select: { users: true, sales: true, terminals: true, products: true, paymentIntents: true, printJobs: true } },
  };

  if (prismaHasField("Merchant", "cnpj")) merchantSelect.cnpj = true;
  if (prismaHasField("Merchant", "billingDueAt")) merchantSelect.billingDueAt = true;
  if (prismaHasField("Merchant", "suspendedReason")) merchantSelect.suspendedReason = true;
  if (prismaHasField("Merchant", "isLoginBlocked")) merchantSelect.isLoginBlocked = true;
  if (prismaHasField("Merchant", "loginBlockedReason")) merchantSelect.loginBlockedReason = true;
  if (prismaHasField("Merchant", "adminNotes")) merchantSelect.adminNotes = true;
  if (prismaHasField("Merchant", "subscription"))
    merchantSelect.subscription = { select: { status: true, billingDueAt: true, graceDays: true } };

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: merchantSelect,
  });

  if (!merchant) throw buildError("Merchant not found", 404);

  const [lastLogin, lastActivity] = await Promise.all([
    prisma.auditLog.findFirst({
      where: { merchantId, actorType: "USER", action: "AUTH_LOGIN" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { merchantId, actorType: "USER" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    merchant: {
      ...merchant,
      lastLoginAt: lastLogin?.createdAt || null,
      lastActivityAt: lastActivity?.createdAt || null,
      paymentStatus: merchant.subscription?.status || null,
    },
  };
}

async function patchMerchant({ id, data, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const update = {};

  if (data.name !== undefined) {
    const n = String(data.name || "").trim();
    if (!n) throw buildError("Invalid name", 400);
    update.name = n;
  }

  if (data.cnpj !== undefined && prismaHasField("Merchant", "cnpj")) {
    const c = String(data.cnpj || "").trim();
    update.cnpj = c || null;
  }

  if (data.status !== undefined) {
    const s = normalizeMerchantStatus(data.status);
    if (!s) throw buildError("Invalid status", 400);
    update.status = s;
  }

  if (data.billingDueAt !== undefined) {
    if (!prismaHasField("Merchant", "billingDueAt")) throw buildError("FEATURE_NOT_AVAILABLE", 501);
    if (data.billingDueAt === null || data.billingDueAt === "") {
      update.billingDueAt = null;
    } else {
      const d = new Date(data.billingDueAt);
      if (Number.isNaN(d.getTime())) throw buildError("Invalid billingDueAt", 400);
      update.billingDueAt = d;
    }
  }

  if (data.suspendedReason !== undefined && prismaHasField("Merchant", "suspendedReason")) {
    const r = String(data.suspendedReason || "").trim();
    update.suspendedReason = r || null;
  }

  if (data.adminNotes !== undefined && prismaHasField("Merchant", "adminNotes")) {
    const notes = String(data.adminNotes || "").trim();
    update.adminNotes = notes || null;
  }

  const updated = await prisma.merchant.update({
    where: { id: merchantId },
    data: update,
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_MERCHANT_PATCH",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { patch: update },
  });

  return { merchant: updated };
}

async function suspendMerchant({ id, suspendedReason, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const reason = String(suspendedReason || "").trim() || "Conta suspensa. Contate o suporte.";
  const updated = await prisma.merchant.update({
    where: { id: merchantId },
    data: { status: "SUSPENDED", suspendedReason: reason },
  });

  await prisma.subscription.upsert({
    where: { merchantId },
    update: { status: "SUSPENDED" },
    create: { merchantId, plan: "FREE", status: "SUSPENDED", billingDueAt: updated.billingDueAt || null, graceDays: 3 },
  });

  await prisma.billingEvent.create({
    data: { merchantId, type: "SUSPEND", note: reason, createdByAdminId: adminId ? Number(adminId) : null },
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_MERCHANT_SUSPEND",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { suspendedReason: reason },
  });

  return { merchant: updated };
}

async function unsuspendMerchant({ id, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const updated = await prisma.merchant.update({
    where: { id: merchantId },
    data: { status: "ACTIVE", suspendedReason: null },
  });

  await prisma.subscription.upsert({
    where: { merchantId },
    update: { status: "ACTIVE" },
    create: { merchantId, plan: "FREE", status: "ACTIVE", billingDueAt: updated.billingDueAt || null, graceDays: 3 },
  });

  await prisma.billingEvent.create({
    data: { merchantId, type: "UNSUSPEND", note: "Manual unsuspend", createdByAdminId: adminId ? Number(adminId) : null },
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_MERCHANT_UNSUSPEND",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: null,
  });

  return { merchant: updated };
}

async function patchMerchantStatus({ id, status, reason, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const nextStatus = normalizeMerchantStatus(status);
  if (!nextStatus) throw buildError("Invalid status", 400);

  const current = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, status: true, suspendedReason: true, billingDueAt: true },
  });
  if (!current) throw buildError("Merchant not found", 404);

  // Idempotente: se j· estiver no status alvo, apenas atualiza motivo (quando aplic·vel) e retorna.
  if (current.status === nextStatus) {
    if (nextStatus !== "SUSPENDED") return { merchant: current };
    const r = String(reason || "").trim();
    if (!r || r === String(current.suspendedReason || "").trim()) return { merchant: current };

    const updated = await prisma.merchant.update({
      where: { id: merchantId },
      data: { suspendedReason: r },
    });

    await writeAuditLog({
      actorType: "ADMIN",
      actorId: adminId ? Number(adminId) : 0,
      merchantId,
      action: "ADMIN_MERCHANT_STATUS_PATCH",
      ip: ip || null,
      userAgent: userAgent || null,
      payload: { status: nextStatus, reason: r },
    });

    return { merchant: updated };
  }

  if (nextStatus === "SUSPENDED") {
    return suspendMerchant({ id: merchantId, suspendedReason: reason, adminId, ip, userAgent });
  }

  return unsuspendMerchant({ id: merchantId, adminId, ip, userAgent });
}

async function patchMerchantAccess({ id, isLoginBlocked, reason, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  if (!prismaHasField("Merchant", "isLoginBlocked")) throw buildError("FEATURE_NOT_AVAILABLE", 501);

  const blocked = Boolean(isLoginBlocked);
  const r = blocked ? String(reason || "").trim() : "";

  if (isDevEnv()) {
    console.info("[admin] patchMerchantAccess", {
      merchantId,
      isLoginBlocked: blocked,
      hasReason: Boolean(r),
      adminId: adminId ? Number(adminId) : null,
    });
  }

  const current = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, isLoginBlocked: true, loginBlockedReason: true },
  });
  if (!current) throw buildError("Merchant not found", 404);

  if (Boolean(current.isLoginBlocked) === blocked && String(current.loginBlockedReason || "").trim() === (r || "")) {
    return { merchant: current };
  }

  const updated = await prisma.merchant.update({
    where: { id: merchantId },
    data: {
      isLoginBlocked: blocked,
      loginBlockedReason: blocked ? r || "Acesso bloqueado pelo suporte." : null,
    },
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_MERCHANT_ACCESS_PATCH",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { isLoginBlocked: blocked, reason: blocked ? updated.loginBlockedReason : null },
  });

  if (isDevEnv()) {
    console.info("[admin] patchMerchantAccess:updated", {
      merchantId,
      isLoginBlocked: Boolean(updated.isLoginBlocked),
      hasReason: Boolean(updated.loginBlockedReason),
    });
  }

  return { merchant: updated };
}

async function getAudit({ merchantId, take }) {
  const mId = merchantId ? Number(merchantId) : null;
  if (merchantId != null && !mId) throw buildError("Invalid merchant id", 400);

  const limit = Math.min(200, Math.max(1, Number(take || 0) || 50));

  const logs = await prisma.auditLog.findMany({
    where: { ...(mId ? { merchantId: mId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, actorType: true, actorId: true, merchantId: true, action: true, ip: true, userAgent: true, payload: true, createdAt: true },
  });

  return { logs };
}

async function getSystemMaintenance() {
  // NÆo derruba o portal se o Prisma Client ainda nÆo estiver atualizado.
  if (!prisma.systemMaintenance || !prismaHasModel("SystemMaintenance")) {
    return {
      schemaReady: false,
      maintenance: { enabled: false, message: null, startsAt: null, endsAt: null, updatedAt: null, updatedByAdminId: null },
    };
  }

  // Singleton: sempre usar o registro id=1 (mantém compatibilidade com versões antigas que podem ter criado múltiplos registros).
  let m = await prisma.systemMaintenance.findUnique({
    where: { id: 1 },
    select: { id: true, enabled: true, message: true, startsAt: true, endsAt: true, updatedAt: true, updatedByAdminId: true },
  });

  if (!m) {
    m = await prisma.systemMaintenance.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { id: true, enabled: true, message: true, startsAt: true, endsAt: true, updatedAt: true, updatedByAdminId: true },
    });
  }

  return {
    maintenance: m || {
      enabled: false,
      message: null,
      startsAt: null,
      endsAt: null,
      updatedAt: null,
      updatedByAdminId: null,
    },
  };
}

async function setSystemMaintenance({ patch, adminId, ip, userAgent }) {
  if (!prisma.systemMaintenance || !prismaHasModel("SystemMaintenance")) {
    return {
      schemaReady: false,
      maintenance: { enabled: false, message: null, startsAt: null, endsAt: null, updatedAt: null, updatedByAdminId: null },
    };
  }

  function parseEnabled(v) {
    if (v === true || v === false) return v;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1") return true;
      if (s === "false" || s === "0") return false;
    }
    if (typeof v === "number") {
      if (v === 1) return true;
      if (v === 0) return false;
    }
    return Boolean(v);
  }

  if (isDevEnv()) {
    console.info("[admin] setSystemMaintenance", {
      adminId: adminId ? Number(adminId) : null,
      patch: {
        enabled: patch?.enabled,
        message: patch?.message,
        startsAt: patch?.startsAt,
        endsAt: patch?.endsAt,
      },
    });
  }

  const data = {};
  if (patch?.enabled !== undefined) data.enabled = parseEnabled(patch.enabled);
  if (patch?.message !== undefined) {
    const msg = String(patch.message || "").trim();
    data.message = msg || null;
  }
  if (patch?.startsAt !== undefined) {
    if (patch.startsAt === null || patch.startsAt === "") data.startsAt = null;
    else {
      const d = new Date(patch.startsAt);
      if (Number.isNaN(d.getTime())) throw buildError("Invalid startsAt", 400);
      data.startsAt = d;
    }
  }
  if (patch?.endsAt !== undefined) {
    if (patch.endsAt === null || patch.endsAt === "") data.endsAt = null;
    else {
      const d = new Date(patch.endsAt);
      if (Number.isNaN(d.getTime())) throw buildError("Invalid endsAt", 400);
      data.endsAt = d;
    }
  }

  const updated = await prisma.systemMaintenance.upsert({
    where: { id: 1 },
    update: { ...data, updatedByAdminId: adminId ? Number(adminId) : null },
    create: { id: 1, ...data, updatedByAdminId: adminId ? Number(adminId) : null },
    select: { id: true, enabled: true, message: true, startsAt: true, endsAt: true, updatedAt: true, updatedByAdminId: true },
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId: null,
    action: "ADMIN_SYSTEM_MAINTENANCE_SET",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { patch: data },
  });

  if (isDevEnv()) {
    console.info("[admin] setSystemMaintenance:updated", {
      id: updated?.id ?? null,
      enabled: Boolean(updated?.enabled),
      updatedAt: updated?.updatedAt || null,
    });
  }

  return { maintenance: updated };
}

async function getMerchantBilling({ id }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);
  const data = await billing.getBilling({ merchantId });
  return data;
}

async function patchMerchantBilling({ id, patch, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const subscription = await billing.patchBilling({ merchantId, patch, createdByAdminId: adminId ? Number(adminId) : null });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_BILLING_PATCH",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { patch },
  });

  return { subscription };
}

async function markMerchantPaid({ id, amountCents, note, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const result = await billing.markPaid({ merchantId, amountCents, note, createdByAdminId: adminId ? Number(adminId) : null });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_BILLING_MARK_PAID",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { amountCents: amountCents ?? null, note: String(note || "").trim() || null },
  });

  return result;
}

async function extendMerchantBilling({ id, days, note, adminId, ip, userAgent }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const result = await billing.extendDue({ merchantId, days, note, createdByAdminId: adminId ? Number(adminId) : null });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: adminId ? Number(adminId) : 0,
    merchantId,
    action: "ADMIN_BILLING_EXTEND",
    ip: ip || null,
    userAgent: userAgent || null,
    payload: { days: days ?? null, note: String(note || "").trim() || null },
  });

  return result;
}

async function getMerchantAudit({ id }) {
  const merchantId = Number(id);
  if (!merchantId) throw buildError("Invalid merchant id", 400);

  const logs = await prisma.auditLog.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, actorType: true, actorId: true, action: true, ip: true, userAgent: true, payload: true, createdAt: true },
  });

  return { logs };
}

async function changePassword({ adminId, currentPassword, newPassword, ip, userAgent }) {
  const id = Number(adminId);
  if (!id) throw buildError("UNAUTHENTICATED", 401);

  const cur = String(currentPassword || "");
  const next = String(newPassword || "");
  if (!cur || !next) throw buildError("MISSING_FIELDS", 400);
  if (next.length < passwordMinLen()) throw buildError("WEAK_PASSWORD", 400);

  const admin = await prisma.adminUser.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, isActive: true, passwordHash: true },
  });
  if (!admin) throw buildError("ADMIN_NOT_FOUND", 404);
  if (admin.isActive === false) throw buildError("ADMIN_INACTIVE", 403);

  const stored = String(admin.passwordHash || "");
  const looksHashed = isBcryptHash(stored);
  let valid = false;

  if (looksHashed) {
    valid = await bcrypt.compare(cur, stored);
  } else {
    valid = cur === stored;
  }

  if (!valid) throw buildError("INVALID_CREDENTIALS", 401);

  const nextHash = await bcrypt.hash(next, bcryptRounds());
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { passwordHash: nextHash },
  });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: admin.id,
    merchantId: null,
    action: "ADMIN_CHANGE_PASSWORD",
    ip: String(ip || "").trim() || null,
    userAgent: String(userAgent || "").trim() || null,
    payload: null,
  });

  return { message: "Password updated" };
}

module.exports = {
  login,
  bootstrapFirstSuperAdmin,
  forgotPassword,
  resetPassword,
  devBootstrapSuperAdminFromEnv,
  changePassword,
  listEmailTemplates,
  createEmailTemplate,
  patchEmailTemplate,
  sendMerchantEmail,
  listMerchantEmails,
  listMerchants,
  getMerchant,
  patchMerchantStatus,
  patchMerchantAccess,
  getAudit,
  patchMerchant,
  suspendMerchant,
  unsuspendMerchant,
  getMerchantBilling,
  patchMerchantBilling,
  markMerchantPaid,
  extendMerchantBilling,
  getMerchantAudit,
  getSystemMaintenance,
  setSystemMaintenance,
};
