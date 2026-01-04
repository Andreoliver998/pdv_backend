// backend/src/modules/users/users.service.js
const bcrypt = require("bcryptjs");
const prisma = require("../../config/prisma");

const ROLES = new Set(["OWNER", "OPERATOR"]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeRole(role) {
  const r = String(role || "").trim().toUpperCase();
  return ROLES.has(r) ? r : "OPERATOR";
}

function safeUserSelect() {
  return {
    id: true,
    name: true,
    email: true,
    role: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
    merchantId: true,
  };
}

async function listUsers(merchantId) {
  const mid = Number(merchantId);
  if (!Number.isFinite(mid) || mid <= 0) {
    const err = new Error("INVALID_MERCHANT");
    err.statusCode = 400;
    throw err;
  }

  return prisma.user.findMany({
    where: { merchantId: mid },
    select: safeUserSelect(),
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

async function createUser(merchantId, { name, email, password, role }) {
  const mid = Number(merchantId);
  if (!Number.isFinite(mid) || mid <= 0) {
    const err = new Error("INVALID_MERCHANT");
    err.statusCode = 400;
    throw err;
  }

  const n = String(name || "").trim();
  const emailNorm = normalizeEmail(email);
  const pwd = String(password || "");

  if (!n || !emailNorm || !pwd) {
    const err = new Error("MISSING_FIELDS");
    err.statusCode = 400;
    throw err;
  }

  // evita criar com e-mail inválido
  if (!emailNorm.includes("@") || emailNorm.endsWith("@")) {
    const err = new Error("INVALID_EMAIL");
    err.statusCode = 400;
    throw err;
  }

  const exists = await prisma.user.findUnique({ where: { email: emailNorm } });
  if (exists) {
    const err = new Error("EMAIL_ALREADY_IN_USE");
    err.statusCode = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(pwd, 10);

  return prisma.user.create({
    data: {
      name: n,
      email: emailNorm,
      passwordHash,
      role: normalizeRole(role),
      merchantId: mid,
      isActive: true,
    },
    select: safeUserSelect(),
  });
}

async function updateUser(merchantId, userId, { name, role }) {
  const mid = Number(merchantId);
  const uid = Number(userId);

  if (!Number.isFinite(mid) || mid <= 0) {
    const err = new Error("INVALID_MERCHANT");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    const err = new Error("INVALID_USER_ID");
    err.statusCode = 400;
    throw err;
  }

  const user = await prisma.user.findFirst({
    where: { id: uid, merchantId: mid },
    select: { id: true, role: true, merchantId: true },
  });

  if (!user) {
    const err = new Error("USER_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  const data = {};

  if (name !== undefined) {
    const n = String(name || "").trim();
    if (!n) {
      const err = new Error("INVALID_NAME");
      err.statusCode = 400;
      throw err;
    }
    data.name = n;
  }

  if (role !== undefined) {
    data.role = normalizeRole(role);
  }

  return prisma.user.update({
    where: { id: user.id },
    data,
    select: safeUserSelect(),
  });
}

async function updateUserStatus(merchantId, userId, isActive) {
  const mid = Number(merchantId);
  const uid = Number(userId);

  if (!Number.isFinite(mid) || mid <= 0) {
    const err = new Error("INVALID_MERCHANT");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(uid) || uid <= 0) {
    const err = new Error("INVALID_USER_ID");
    err.statusCode = 400;
    throw err;
  }

  const user = await prisma.user.findFirst({
    where: { id: uid, merchantId: mid },
    select: { id: true, role: true },
  });

  if (!user) {
    const err = new Error("USER_NOT_FOUND");
    err.statusCode = 404;
    throw err;
  }

  // regra de segurança: não permitir desativar OWNER por essa rota
  if (user.role === "OWNER" && !Boolean(isActive)) {
    const err = new Error("CANNOT_DISABLE_OWNER");
    err.statusCode = 400;
    throw err;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: { isActive: Boolean(isActive) },
    select: safeUserSelect(),
  });
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  updateUserStatus,
};
