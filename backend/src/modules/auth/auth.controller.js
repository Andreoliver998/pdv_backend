// backend/src/modules/auth/auth.controller.js
const authService = require("./auth.service");

function mapAuthError(err) {
  const msg = String(err?.message || "");

  // Prisma unique constraint
  if (err?.code === "P2002") {
    return { status: 400, message: "Já existe um usuário cadastrado com esse e-mail." };
  }

  if (msg === "MISSING_FIELDS") {
    return { status: 400, message: "Preencha todos os campos obrigatórios." };
  }
  if (msg === "INVALID_EMAIL") {
    return { status: 400, message: "E-mail inválido." };
  }
  if (msg === "WEAK_PASSWORD") {
    return { status: 400, message: "A senha deve ter pelo menos 6 caracteres." };
  }
  if (msg === "EMAIL_ALREADY_IN_USE") {
    return { status: 400, message: "Já existe um usuário cadastrado com esse e-mail." };
  }
  if (msg === "INVALID_CREDENTIALS") {
    return { status: 401, message: "E-mail ou senha inválidos." };
  }
  if (msg === "USER_INACTIVE") {
    return { status: 403, message: "Usuário desativado. Contate o administrador." };
  }
  if (msg === "JWT_SECRET_MISSING") {
    return { status: 500, message: "Configuração inválida do servidor (JWT_SECRET ausente)." };
  }

  return null;
}

async function register(req, res, next) {
  try {
    const { name, email, password, merchantName } = req.body || {};

    const result = await authService.register({
      name,
      email,
      password,
      merchantName,
    });

    return res.status(201).json(result);
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return res.status(mapped.status).json({ message: mapped.message });
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const result = await authService.login({ email, password });
    return res.json(result);
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return res.status(mapped.status).json({ message: mapped.message });
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ message: "Não autenticado." });

    // Se o middleware não injeta req.merchant, retornamos apenas merchantId.
    // O front já tem merchantName salvo no localStorage pelo login/register.
    return res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      merchantId: req.user.merchantId,
      isActive: req.user.isActive ?? true,
      merchant: req.merchant || null,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { register, login, me };
