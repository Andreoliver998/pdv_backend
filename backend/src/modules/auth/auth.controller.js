// backend/src/modules/auth/auth.controller.js
const authService = require("./auth.service");
const { writeAuditLog } = require("../../services/auditLog");

function isDevEnv() {
  return String(process.env.NODE_ENV || "development").trim() !== "production";
}

function passwordMinLen() {
  const v = Number(process.env.PASSWORD_MIN_LENGTH || 0) || 0;
  return v > 0 ? v : 6; // compatibilidade com comportamento anterior
}

function maskEmail(input) {
  const e = String(input || "").trim().toLowerCase();
  const [name, domain] = e.split("@");
  if (!name || !domain) return "";
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
}

/**
 * Mapeia erros do service para HTTP + payload consistente.
 * - Usa `error` quando o front precisa de "code" estável.
 * - Mantém `message` para UX.
 */
function mapAuthError(err) {
  const msg = String(err?.message || "").trim();

  // Prisma unique constraint
  if (err?.code === "P2002") {
    return { status: 400, message: "Já existe um usuário cadastrado com esse e-mail." };
  }

  if (msg === "MISSING_FIELDS") return { status: 400, message: "Preencha todos os campos obrigatórios.", error: "MISSING_FIELDS" };
  if (msg === "INVALID_EMAIL") return { status: 400, message: "E-mail inválido.", error: "INVALID_EMAIL" };
  if (msg === "WEAK_PASSWORD") {
    return { status: 400, message: `A senha deve ter pelo menos ${passwordMinLen()} caracteres.`, error: "WEAK_PASSWORD" };
  }
  if (msg === "EMAIL_ALREADY_IN_USE") return { status: 400, message: "Já existe um usuário cadastrado com esse e-mail.", error: "EMAIL_ALREADY_IN_USE" };
  if (msg === "INVALID_CREDENTIALS") return { status: 401, message: "E-mail ou senha inválidos.", error: "INVALID_CREDENTIALS" };

  if (msg === "EMAIL_NOT_VERIFIED") {
    return {
      status: 403,
      message: "E-mail não verificado. Verifique sua caixa de entrada/spam para ativar a conta.",
      error: "EMAIL_NOT_VERIFIED",
    };
  }

  if (msg === "USER_INACTIVE") return { status: 403, message: "Usuário desativado. Contate o administrador.", error: "USER_INACTIVE" };

  if (msg === "JWT_SECRET_MISSING") {
    return { status: 500, message: "Configuração inválida do servidor (JWT_SECRET ausente).", error: "JWT_SECRET_MISSING" };
  }

  if (msg === "RESET_TOKEN_INVALID") {
    return { status: 400, message: "Token inválido ou expirado. Solicite um novo link.", error: "RESET_TOKEN_INVALID" };
  }
  if (msg === "RESET_TOKEN_USED") {
    return { status: 400, message: "Este link já foi utilizado. Solicite um novo.", error: "RESET_TOKEN_USED" };
  }

  if (msg === "INVALID_CURRENT_PASSWORD") return { status: 400, message: "Senha atual incorreta.", error: "INVALID_CURRENT_PASSWORD" };
  if (msg === "SAME_PASSWORD") return { status: 400, message: "A nova senha deve ser diferente da senha atual.", error: "SAME_PASSWORD" };

  // GOOGLE
  if (msg === "GOOGLE_CLIENT_ID_MISSING") {
    return { status: 500, message: "Configuração inválida do servidor (GOOGLE_CLIENT_ID ausente).", error: "GOOGLE_CLIENT_ID_MISSING" };
  }

  if (msg === "INVALID_GOOGLE_TOKEN" || msg === "INVALID_TOKEN") {
    return { status: 401, message: "Token Google inválido. Tente novamente.", error: "INVALID_GOOGLE_TOKEN" };
  }

  if (msg === "GOOGLE_EMAIL_NOT_VERIFIED") {
    return {
      status: 401,
      message: "Seu e-mail do Google ainda não está verificado. Verifique o e-mail no Google e tente novamente.",
      error: "GOOGLE_EMAIL_NOT_VERIFIED",
    };
  }

  if (msg === "ACCOUNT_EXISTS_LOCAL") {
    return {
      status: 409,
      message: "Já existe uma conta por e-mail/senha com este e-mail. Entre com senha para continuar (ou solicite redefinição).",
      error: "ACCOUNT_EXISTS_LOCAL",
    };
  }

  if (msg === "ACCOUNT_CONFLICT") {
    return {
      status: 409,
      message:
        "Conflito de conta: este e-mail já está vinculado a outra conta Google. Contate o suporte se precisar recuperar o acesso.",
      error: "ACCOUNT_CONFLICT",
    };
  }

  if (msg === "USE_GOOGLE_LOGIN") {
    return {
      status: 409,
      message: 'Esse e-mail foi cadastrado com Google. Use "Entrar com Google".',
      error: "USE_GOOGLE_LOGIN",
    };
  }

  if (msg === "MERCHANT_SUSPENDED") return { status: 403, message: "Conta suspensa. Contate o suporte.", error: "MERCHANT_SUSPENDED" };
  if (msg === "MERCHANT_LOGIN_BLOCKED") {
    return { status: 403, message: "Acesso temporariamente bloqueado. Contate o suporte.", error: "MERCHANT_LOGIN_BLOCKED" };
  }

  return null;
}

function getReqMeta(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0]
    .trim();
  const userAgent = String(req.headers["user-agent"] || "").trim();
  return { ip: ip || null, userAgent: userAgent || null };
}

function sendMapped(res, mapped) {
  // helper: retorna JSON padronizado
  return res.status(mapped.status).json({
    ok: false,
    message: mapped.message,
    ...(mapped.error ? { error: mapped.error } : {}),
  });
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
    if (mapped) return sendMapped(res, mapped);
    return next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const result = await authService.login({ email, password });

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: "USER",
      actorId: Number(result?.user?.id || 0),
      merchantId: Number(result?.user?.merchantId || 0) || null,
      action: "AUTH_LOGIN",
      ip,
      userAgent,
      payload: { provider: "LOCAL" },
    }).catch(() => {});

    return res.json(result);
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return sendMapped(res, mapped);
    return next(err);
  }
}

async function enter(req, res, next) {
  try {
    const { email, password, name, merchantName } = req.body || {};
    const result = await authService.enter({ email, password, name, merchantName });

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: "USER",
      actorId: Number(result?.user?.id || 0),
      merchantId: Number(result?.user?.merchantId || 0) || null,
      action: result?.created ? "AUTH_ENTER_CREATED" : "AUTH_ENTER_LOGIN",
      ip,
      userAgent,
      payload: { provider: "LOCAL" },
    }).catch(() => {});

    if (isDevEnv()) {
      console.log(
        `[AUTH ENTER] ${result?.created ? "created" : "login"} email=${maskEmail(email)} userId=${Number(
          result?.user?.id || 0
        )}`
      );
    }

    return res.json(result);
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return sendMapped(res, mapped);
    return next(err);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const token = String(req.query?.token || "").trim();
    const result = await authService.verifyEmail({ token });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return sendMapped(res, mapped);
    return next(err);
  }
}

async function resendVerification(req, res) {
  const email = req.body?.email;
  try {
    await authService.resendVerification({ email });
  } catch (err) {
    // anti-enumeração: não vazar detalhes
    if (isDevEnv()) console.warn("[AUTH] resendVerification error:", err?.message || err);
  }
  return res.json({
    ok: true,
    message: "Se existir uma conta com este e-mail, enviaremos um novo link de verificação.",
  });
}

async function me(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Não autenticado.", error: "UNAUTHENTICATED" });
    }

    return res.json({
      ok: true,
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

async function forgotPassword(req, res) {
  const { email } = req.body || {};

  if (isDevEnv()) {
    console.log(`[DEV AUTH] forgot-password enter email=${maskEmail(email)}`);
  }

  try {
    await authService.forgotPassword({ email });
  } catch (err) {
    // anti-enumeração: não vazar detalhes ao cliente
    if (isDevEnv()) console.warn("[AUTH] forgot-password error:", err?.message || err);
  }

  if (isDevEnv()) {
    console.log(`[DEV AUTH] forgot-password exit email=${maskEmail(email)}`);
  }

  return res.json({
    ok: true,
    message: "Se existir uma conta com este e-mail, enviaremos instruções para redefinir sua senha.",
  });
}

async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body || {};

    if (isDevEnv()) {
      const tokenLen = String(token || "").trim().length;
      console.log(`[DEV AUTH] reset-password enter tokenLen=${tokenLen}`);
    }

    await authService.resetPassword({ token, password });

    if (isDevEnv()) {
      console.log("[DEV AUTH] reset-password exit ok=true");
    }

    return res.json({
      ok: true,
      message: "Senha redefinida com sucesso. Você já pode fazer login.",
    });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) return sendMapped(res, mapped);
    return next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ ok: false, error: "UNAUTHENTICATED", message: "Não autenticado." });
    }

    const { currentPassword, newPassword } = req.body || {};

    await authService.changePassword({
      userId: req.user.id,
      currentPassword,
      newPassword,
    });

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: "USER",
      actorId: Number(req.user.id),
      merchantId: Number(req.user.merchantId || 0) || null,
      action: "AUTH_CHANGE_PASSWORD",
      ip,
      userAgent,
      payload: null,
    }).catch(() => {});

    if (isDevEnv()) {
      console.log(`[AUTH] change-password success userId=${req.user.id}`);
    }

    return res.json({ ok: true, message: "Senha atualizada com sucesso." });
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) {
      // aqui o front pode usar `error` diretamente; garantimos estabilidade
      return res.status(mapped.status).json({
        ok: false,
        error: mapped.error || err?.message || "BadRequest",
        message: mapped.message,
      });
    }
    return next(err);
  }
}

/**
 * Google login
 * Aceita tanto `credential` (GIS) quanto `idToken` (compatibilidade).
 * - Mantém compatibilidade com o front: body { credential: idToken }
 */
async function google(req, res, next) {
  try {
    const { idToken, credential } = req.body || {};
    const token = String(credential || idToken || "").trim();

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_FIELDS",
        message: "Preencha todos os campos obrigatórios.",
      });
    }

    const result = await authService.googleAuth({ idToken: token });

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: "USER",
      actorId: Number(result?.user?.id || 0),
      merchantId: Number(result?.user?.merchantId || 0) || null,
      action: "AUTH_LOGIN",
      ip,
      userAgent,
      payload: { provider: "GOOGLE" },
    }).catch(() => {});

    return res.json(result);
  } catch (err) {
    const mapped = mapAuthError(err);
    if (mapped) {
      // IMPORTANTE: manter `error` com o CODE estável que o app.js usa
      return res.status(mapped.status).json({
        ok: false,
        error: mapped.error || err?.message || "BadRequest",
        message: mapped.message,
      });
    }
    return next(err);
  }
}

module.exports = {
  register,
  login,
  enter,
  verifyEmail,
  resendVerification,
  me,
  forgotPassword,
  resetPassword,
  changePassword,
  google,
};