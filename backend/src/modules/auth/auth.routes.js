// backend/src/modules/auth/auth.routes.js
const express = require("express");
const router = express.Router();

const authController = require("./auth.controller");
const { ensureAuth } = require("../../middlewares/auth");
const { createSlidingWindowLimiter } = require("../../middlewares/rateLimit");

const FORGOT_PASSWORD_MESSAGE =
  "Se existir uma conta com este e-mail, enviaremos instruções para redefinir sua senha.";

const RESEND_VERIFY_MESSAGE =
  "Se existir uma conta com este e-mail, enviaremos um novo link de verificação.";

const RESET_PASSWORD_MESSAGE =
  "Se o link for válido, sua senha será redefinida. Caso tenha expirado, solicite um novo.";

// Observação: manter a normalização aqui ajuda a reduzir variações no rate limit
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getIp(req) {
  // req.ip já respeita trust proxy (se você configurou app.set('trust proxy', 1))
  return String(req.ip || req.socket?.remoteAddress || "").trim();
}

// Rate limit (anti-abuso) sem quebrar anti-enumeração:
// - Em caso de limite, responde 200 com a mesma mensagem e não envia e-mail/token.
const forgotPasswordLimiter = createSlidingWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: (req) => {
    const ip = getIp(req);
    const email = normalizeEmail(req.body?.email);
    return `forgot:${ip}:${email || "-"}`;
  },
  onLimit: (req, res) => {
    const isDev = String(process.env.NODE_ENV || "").trim() !== "production";
    if (isDev) {
      console.warn(`[DEV AUTH] forgot-password rate-limited ip=${getIp(req)} email=${normalizeEmail(req.body?.email)}`);
    }
    return res.json({ ok: true, message: FORGOT_PASSWORD_MESSAGE });
  },
});

// Rate limit básico para reset (reduz brute force de token)
// - Em caso de limite, devolve 200 com mensagem neutra (evita dar pista de abuso)
const resetPasswordLimiter = createSlidingWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const ip = getIp(req);
    return `reset:${ip}`;
  },
  onLimit: (req, res) => {
    const isDev = String(process.env.NODE_ENV || "").trim() !== "production";
    if (isDev) {
      console.warn(`[DEV AUTH] reset-password rate-limited ip=${getIp(req)}`);
    }
    return res.json({ ok: true, message: RESET_PASSWORD_MESSAGE });
  },
});

// Rate limit para reenvio de verificação (anti-abuso, sem vazar enumeração)
const resendVerificationLimiter = createSlidingWindowLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: (req) => {
    const ip = getIp(req);
    const email = normalizeEmail(req.body?.email);
    return `verify:${ip}:${email || "-"}`;
  },
  onLimit: (req, res) => {
    const isDev = String(process.env.NODE_ENV || "").trim() !== "production";
    if (isDev) {
      console.warn(
        `[DEV AUTH] resend-verification rate-limited ip=${getIp(req)} email=${normalizeEmail(req.body?.email)}`
      );
    }
    return res.json({ ok: true, message: RESEND_VERIFY_MESSAGE });
  },
});

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/enter", authController.enter);

router.get("/verify-email", authController.verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, authController.resendVerification);

router.post("/forgot-password", forgotPasswordLimiter, authController.forgotPassword);
router.post("/reset-password", resetPasswordLimiter, authController.resetPassword);

router.post("/google", authController.google);

router.post("/change-password", ensureAuth, authController.changePassword);
router.get("/me", ensureAuth, authController.me);

module.exports = router;