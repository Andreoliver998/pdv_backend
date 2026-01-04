/**
 * =====================================================
 *  PDV - API Server
 * =====================================================
 *  - Ambiente DEV e PROD
 *  - CORS inteligente (localhost + LAN + IPv6)
 *  - Compatível com Web e Android
 *  - Serve Painel Web (HTML/CSS/JS) via / (opcional)
 * =====================================================
 */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Carrega `.env` e `.env.local` com precedência:
// 1) variáveis já definidas no processo (ex.: `cross-env`, systemd, pm2, VPS)
// 2) `.env.local` (apenas local, sobrescreve `.env`)
// 3) `.env`
//
// Importante: `.env.local` NÃO sobrescreve variáveis já definidas externamente,
// para não quebrar `npm start` (produção) quando o dev tiver um `.env.local` no PC.
(() => {
  const initialEnvKeys = new Set(Object.keys(process.env));

  function readEnvFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, "utf8");
      return dotenv.parse(content);
    } catch (err) {
      console.warn(`[ENV] Falha ao ler ${filePath}: ${err?.message || err}`);
      return null;
    }
  }

  function applyParsedEnv(parsed) {
    if (!parsed) return;
    Object.entries(parsed).forEach(([key, value]) => {
      if (initialEnvKeys.has(key)) return; // não sobrescreve env externo
      process.env[key] = value;
    });
  }

  const envPath = path.join(__dirname, "..", ".env");
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  const envLocalExists = fs.existsSync(envLocalPath);

  const envParsed = readEnvFile(envPath);
  const envLocalParsed = readEnvFile(envLocalPath);

  applyParsedEnv(envParsed);

  // `.env.local` sobrescreve `.env` (desde que não seja env externo)
  if (envLocalParsed) {
    Object.entries(envLocalParsed).forEach(([key, value]) => {
      if (initialEnvKeys.has(key)) return; // não sobrescreve env externo
      process.env[key] = value;
    });
  }

  // Diagnóstico: quando o dev roda `npm start` (produção) com `.env.local` presente.
  if (envLocalExists && String(process.env.NODE_ENV || "").trim().toLowerCase() === "production") {
    console.warn(
      "[ENV] `.env.local` detectado, mas o processo está em NODE_ENV=production. Para rodar local, use `npm run dev`."
    );
  }
})();

const express = require("express");
const cors = require("cors");

const errorHandler = require("./middlewares/errorHandler");
const { requestIdMiddleware } = require("./middlewares/requestId");
const { requestLoggerMiddleware } = require("./middlewares/requestLogger");
const { billingSweepOnce } = require("./services/billing");
const { ensureDefaultEmailTemplates } = require("./modules/mailer/mailer.service");
const { verifySmtpOnce } = require("./services/mail");
const prisma = require("./config/prisma");
const bcrypt = require("bcryptjs");
const { version: APP_VERSION } = require("../package.json");

const app = express();

/**
 * =====================================================
 *  CONFIGURAÇÕES GERAIS
 * =====================================================
 */
const PORT = Number(process.env.PORT) || 3333;
const NODE_ENV = String(process.env.NODE_ENV || "development").trim().toLowerCase();
const APP_URL_RAW = String(
  process.env.CORS_ORIGINS ||
    process.env.APP_URL ||
    process.env.BASE_URL ||
    process.env.API_PUBLIC_URL ||
    process.env.API_URL ||
    ""
).trim();
const IS_PROD = NODE_ENV === "production";
const HAS_DATABASE_URL = Boolean(String(process.env.DATABASE_URL || "").trim());
const BIND_HOST = String(process.env.BIND_HOST || (IS_PROD ? "127.0.0.1" : "0.0.0.0")).trim() || (IS_PROD ? "127.0.0.1" : "0.0.0.0");

/**
 * Se você quiser desligar o painel estático em produção,
 * basta definir SERVE_WEB=false no .env
 */
const SERVE_WEB = String(process.env.SERVE_WEB ?? "true").trim().toLowerCase() !== "false";

// Se você usa proxy/túnel (Nginx, Cloudflare, etc.)
app.set("trust proxy", 1);

// Observabilidade: requestId + log estruturado (sem vazar segredos)
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Produção deve falhar cedo se estiver sem DB (evita "server up, mas tudo quebra")
if (IS_PROD && !HAS_DATABASE_URL) {
  console.error("[BOOT] DATABASE_URL ausente. Configure a variável de ambiente e reinicie o servidor.");
  process.exit(1);
}

// PROD (opcional): exigir HTTPS quando estiver atrás de proxy (TLS >= 1.2 é responsabilidade do proxy/terminação)
if (IS_PROD && String(process.env.REQUIRE_HTTPS || "").trim().toLowerCase() === "true") {
  app.use((req, res, next) => {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const isSecure = Boolean(req.secure) || forwardedProto === "https";
    const ip = String(req.ip || "").trim().toLowerCase();
    const isLoopback =
      ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip.startsWith("127.") || ip === "localhost";
    if (isSecure || isLoopback) return next();
    return res.status(426).json({ ok: false, error: "UpgradeRequired", message: "HTTPS required" });
  });
}

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/$/, "");
}

function normalizeToOriginString(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    if (!/^https?:$/i.test(u.protocol)) return "";
    return u.origin;
  } catch {
    return "";
  }
}

/**
 * Regra mais segura:
 * - Se NODE_ENV !== "production" => DEV
 * - Se NODE_ENV === "production" => PROD (exige APP_URL para liberar origens)
 *
 * Obs: Apps Android nativos (Retrofit) normalmente não mandam Origin,
 * então não sofrem com CORS.
 */
function isDev() {
  return !IS_PROD;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function ensureSuperAdminBootstrap() {
  const email = normalizeEmail(process.env.SUPERADMIN_EMAIL);
  const password = String(process.env.SUPERADMIN_PASSWORD || "").trim();
  const name = String(process.env.SUPERADMIN_NAME || "SuperDono").trim() || "SuperDono";

  // Para "nunca perder acesso", configure SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD no ambiente.
  // Se estiver ausente, nao falhamos o servidor para nao quebrar prod/CI antigos.
  if (!email || !password) return { ok: false, reason: "MISSING_ENV" };

  const existing = await prisma.adminUser.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 0) || 10;

  // Para garantir acesso (sem "perder" senha), mantemos a senha do SUPERADMIN sincronizada com o env.
  // NUNCA logar o valor da senha.
  const passwordHash = await bcrypt.hash(password, rounds);

  if (existing) {
    const admin = await prisma.adminUser.update({
      where: { id: existing.id },
      data: { name, passwordHash, role: "SUPER_ADMIN", isActive: true },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    return { ok: true, admin, created: false };
  }

  const admin = await prisma.adminUser.create({
    data: { email, name, passwordHash, role: "SUPER_ADMIN", isActive: true },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });

  return { ok: true, admin, created: true };
}

function isLocalhostOrigin(o) {
  return (
    /^https?:\/\/localhost:\d+$/i.test(o) ||
    /^https?:\/\/127\.0\.0\.1:\d+$/i.test(o) ||
    /^https?:\/\/0\.0\.0\.0:\d+$/i.test(o) ||
    /^https?:\/\/\[\:\:1\]:\d+$/i.test(o)
  );
}

function isLanOrigin(o) {
  return (
    /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/i.test(o) ||
    /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/i.test(o) ||
    /^https?:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:\d+$/i.test(o)
  );
}

/**
 * =====================================================
 *  APP_URL em produção pode ser:
 *   - uma única URL (ex: https://meudominio.com)
 *   - várias URLs separadas por vírgula
 *     (ex: https://a.com,https://b.com)
 * =====================================================
 */
function withWwwVariants(rawOrigin) {
  const o = normalizeToOriginString(rawOrigin) || normalizeOrigin(rawOrigin);
  if (!o) return [];

  try {
    const u = new URL(o);
    if (!/^https?:$/i.test(u.protocol)) {
      console.warn(`[CORS] APP_URL inválida (protocolo): ${o} (use http:// ou https://)`);
      return [];
    }
    const host = String(u.hostname || "");
    if (!host) return [o];

    const variants = new Set([o]);

    // Apenas domínios "normais" (não faz sentido com IP/localhost)
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && host !== "localhost") {
      const withWww = host.startsWith("www.") ? host : `www.${host}`;
      const withoutWww = host.startsWith("www.") ? host.slice(4) : host;

      const uWith = new URL(o);
      uWith.hostname = withWww;
      variants.add(uWith.toString().replace(/\/$/, ""));

      const uWithout = new URL(o);
      uWithout.hostname = withoutWww;
      variants.add(uWithout.toString().replace(/\/$/, ""));
    }

    return Array.from(variants);
  } catch {
    console.warn(`[CORS] APP_URL inválida: ${o} (use http:// ou https://)`);
    return [];
  }
}

function isWildcardLocalhostPortPattern(s) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[\:\:1\]):\*$/i.test(String(s || "").trim());
}

function wildcardPatternToRegex(pattern) {
  const raw = String(pattern || "").trim();
  const noSuffix = raw.replace(/:\*$/i, "");
  const origin = normalizeToOriginString(noSuffix) || normalizeOrigin(noSuffix);
  if (!origin) return null;

  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}:\\d+$`, "i");
}

const PROD_ALLOWED = (() => {
  // Produção: somente origens explicitamente permitidas.
  // Fonte: CORS_ORIGINS (preferencial) ou APP_URL/BASE_URL/... via APP_URL_RAW
  const exact = new Set();
  const regexes = [];

  const rawList = String(APP_URL_RAW || "")
    .split(",")
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  // Fallback seguro (evita “site no ar, login morto” se esquecer env).
  // Se quiser produção 100% estrita, remova o fallback e exija env.
  const entries = rawList.length > 0 ? rawList : ["https://paytech.app.br", "https://www.paytech.app.br"];

  entries.forEach((entry) => {
    if (isWildcardLocalhostPortPattern(entry)) {
      const rx = wildcardPatternToRegex(entry);
      if (rx) regexes.push(rx);
      return;
    }

    withWwwVariants(entry).forEach((v) => exact.add(v));
  });

  return { exact, regexes };
})();

function isAllowedProdOrigin(origin) {
  const o = normalizeOrigin(origin);
  if (!o) return false;
  if (PROD_ALLOWED.exact.has(o)) return true;
  return PROD_ALLOWED.regexes.some((rx) => rx.test(o));
}

function allowDevOrigin(o) {
  // DEV: libera localhost/127.0.0.1 em qualquer porta e LAN (útil para testes em rede)
  if (o === "null") return true; // file://, sandbox etc
  if (isLocalhostOrigin(o)) return true;
  if (isLanOrigin(o)) return true;
  return false;
}

const corsBlockedLogOnce = new Set();
function logCorsBlocked(origin) {
  const o = normalizeOrigin(origin);
  if (corsBlockedLogOnce.has(o)) return;
  corsBlockedLogOnce.add(o);

  console.warn(
    `[CORS] PROD bloqueou origin (${o}). Para uso local, defina NODE_ENV=development. ` +
      `Para liberar em produção, inclua a origem em CORS_ORIGINS (ou APP_URL) no .env.`
  );
  console.warn(`[CORS] NODE_ENV=${NODE_ENV} APP_URL_RAW=${APP_URL_RAW || "(vazio)"}`);

  const allowedList = Array.from(PROD_ALLOWED.exact.values());
  if (allowedList.length || PROD_ALLOWED.regexes.length) {
    if (allowedList.length) console.warn(`[CORS] Origens permitidas (PROD): ${allowedList.join(", ")}`);
    if (PROD_ALLOWED.regexes.length) {
      console.warn(`[CORS] Padrões permitidos (PROD): ${PROD_ALLOWED.regexes.map((r) => r.source).join(" | ")}`);
    }
  } else {
    console.warn("[CORS] Nenhuma origem permitida (PROD). Configure CORS_ORIGINS/APP_URL com a URL do painel.");
  }
}

/**
 * =====================================================
 *  CORS (ROBUSTO)
 * =====================================================
 * Regras:
 * - origin vazio => permitir (curl, apps nativos, alguns webviews)
 * - DEV => permitir localhost/LAN
 * - PROD => permitir apenas allowlist
 *
 * Observação: em PROD, ao negar origin, NÃO lançamos erro (callback(null, false))
 * para evitar 500 em alguns fluxos de preflight.
 */
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const o = normalizeOrigin(origin);

    if (isDev()) {
      if (allowDevOrigin(o)) return callback(null, true);
      return callback(new Error(`CORS DEV bloqueado para origin: ${o}`), false);
    }

    if (isAllowedProdOrigin(o)) return callback(null, true);

    logCorsBlocked(o);
    return callback(null, false);
  },

  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
    "X-Terminal-Key",
    "X-Terminal-Api-Key",
    "X-Api-Key",
  ],
  exposedHeaders: ["Content-Length"],
  optionsSuccessStatus: 204,
};

// IMPORTANTE: apenas UM preflight handler global (Express 5 nÆo aceita "*")
app.options(/.*/, cors(corsOptions));

// CORS global
app.use(cors(corsOptions));


// DEV-only: log para diagnosticar "forgot/reset password" (sem vazar token)
if (isDev()) {
  app.use((req, res, next) => {
    const p = String(req.path || "");
    if (p === "/api/auth/forgot-password" || p === "/api/auth/reset-password") {
      const origin = req.get("origin") || "";
      console.log(`[DEV AUTH] ${req.method} ${req.originalUrl} origin=${origin}`);
    }
    return next();
  });
}

/**
 * =====================================================
 *  BODY PARSER
 * =====================================================
 */
app.use(express.json({ limit: "5mb" }));

/**
 * =====================================================
 *  UPLOADS (PÚBLICO / SEM CACHE)
 * =====================================================
 */
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "uploads"), {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    },
  })
);

/**
 * =====================================================
 *  ROUTES
 * =====================================================
 */
function pickRouter(mod, name) {
  const router = mod?.router || mod?.routes || mod?.default || mod;
  if (typeof router !== "function") {
    throw new Error(`Invalid router export: ${name}. Esperado um express.Router().`);
  }
  return router;
}

function safeLoadRouter(modulePath, name) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(modulePath);
    return pickRouter(mod, name);
  } catch (err) {
    console.error(`[BOOT] Falha ao carregar rota "${name}" (${modulePath}).`);
    console.error(err);

    const router = express.Router();
    router.use((req, res) => {
      return res.status(500).json({
        ok: false,
        error: "RouteModuleLoadFailed",
        route: name,
      });
    });
    return router;
  }
}

/**
 * =====================================================
 *  HEALTH CHECK
 *  - Mantemos /health (padrão)
 *  - E criamos /api/health para testes via proxy /api
 * =====================================================
 */
function healthPayload() {
  return {
    status: "ok",
    ok: true,
    service: "PDV API",
    env: NODE_ENV,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
  };
}

// Router raiz de /api: garante que GET /api e GET /api/ retornem 200 (útil para proxy e smoke tests).
const apiRootRouter = express.Router();
apiRootRouter.get("/", (req, res) => res.json(healthPayload()));
app.use("/api", apiRootRouter);
// Em alguns setups (ou com strict routing), `/api` pode não bater no `router.get("/")`.
// Mantemos ambos para garantir 200 em `/api` e `/api/`.
app.get("/api", (req, res) => res.json(healthPayload()));

app.get("/health", (req, res) => res.json(healthPayload()));
app.get("/api/health", (req, res) => res.json(healthPayload()));

// Conveniência: algumas integrações/testes chamam `/api` ou `/api/` esperando "API online".
// Mantemos o padrão oficial em `/api/health`, mas respondemos aqui também para evitar 404.
// (mantido por compatibilidade histórica: respondemos na raiz de /api via router acima)

// DEV-only: eco para depurar headers/auth sem expor segredos
if (isDev()) {
  app.get("/api/debug/echo", (req, res) => {
    const rawKey =
      req.headers["x-terminal-key"] || req.headers["x-terminal-api-key"] || req.headers["x-api-key"] || "";
    const key = String(rawKey || "").trim();
    const keyPreview = key ? `${key.slice(0, 6)}…(${key.length})` : null;

    return res.json({
      ok: true,
      requestId: req.requestId || null,
      ip: String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || null,
      method: req.method,
      path: req.originalUrl,
      headers: {
        host: req.get("host") || null,
        origin: req.get("origin") || null,
        "user-agent": req.get("user-agent") || null,
        authorization: req.get("authorization") ? "present" : null,
        "x-terminal-key": keyPreview,
      },
      auth: {
        user: req.user ? { id: req.user.id, merchantId: req.user.merchantId, role: req.user.role } : null,
        terminal: req.terminal ? { id: req.terminal.id, merchantId: req.terminal.merchantId, status: req.terminal.status } : null,
        merchant: req.merchant ? { id: req.merchant.id, name: req.merchant.name, status: req.merchant.status } : null,
      },
    });
  });

  app.use("/api/dev", safeLoadRouter("./modules/dev/dev.routes", "dev"));
}

app.use("/api/config", safeLoadRouter("./modules/config/config.routes", "config"));
app.use("/api/system", safeLoadRouter("./modules/system/system.routes", "system"));
app.use("/api/app", safeLoadRouter("./modules/app/app.routes", "app"));


/**
 * =====================================================
 *  API ROUTES
 * =====================================================
 */
/**
 * =====================================================
 *  ENDPOINTS (AUDITORIA RÁPIDA)
 * =====================================================
 *  Existem hoje:
 *  - GET  /health, /api/health
 *  - /api/auth/* (login/register/forgot/reset/etc)
 *  - /api/terminals/* (activate, claim, pair, me, heartbeat, provisioning/pairing codes)
 *  - /api/pdv/products (X-Terminal-Key)
 *  - /api/pdv/sales (X-Terminal-Key)
 *  - /api/products/* (painel, JWT)
 *  - /api/sales/* (JWT ou X-Terminal-Key) + PATCH /:id/status (painel)
 *  - /api/reports/* (painel, JWT)
 *
 *  Deveriam existir (homologação/robustez):
 *  - GET  /api/debug/echo (DEV-only)
 *  - POST /api/dev/reset e POST /api/dev/seed (DEV-only + token)
 *  - PATCH /api/pdv/sales/:id/status (opcional, para fluxo PENDING->PAID)
 * =====================================================
 */
app.use("/api/auth", safeLoadRouter("./modules/auth/auth.routes", "auth"));
app.use("/api/admin", safeLoadRouter("./modules/admin/admin.routes", "admin"));
app.use("/api/users", safeLoadRouter("./modules/users/users.routes", "users"));
app.use("/api/products", safeLoadRouter("./modules/product/product.routes", "products"));
app.use("/api/sales", safeLoadRouter("./modules/sale/sale.routes", "sales"));
app.use("/api/payments", safeLoadRouter("./modules/payments/payments.routes", "payments"));
app.use("/api/print-jobs", safeLoadRouter("./modules/printJobs/printJobs.routes", "print-jobs"));
app.use("/api/reports", safeLoadRouter("./modules/reports/reports.routes", "reports"));
app.use("/api/terminals", safeLoadRouter("./modules/terminal/terminal.routes", "terminals"));
app.use("/api/merchant", safeLoadRouter("./modules/merchant/merchant.routes", "merchant"));
app.use("/api/pdv", safeLoadRouter("./modules/pdv/pdv.routes", "pdv"));
app.use(
  "/api/merchant-settings",
  safeLoadRouter("./modules/merchantSettings/merchantSettings.routes", "merchant-settings")
);
app.use("/api/upload", safeLoadRouter("./modules/upload/upload.routes", "upload"));

/**
 * =====================================================
 *  SERVIR PAINEL WEB (HTML/CSS/JS)
 *  IMPORTANTE: fica DEPOIS das rotas da API,
 *  para não “engolir” /health e /api/*
 * =====================================================
 */
if (SERVE_WEB) {
  const webDir = path.join(__dirname, "..", "public");
  const adminDir = path.join(webDir, "admin");

  // Admin portal: /admin (no mesmo dominio)
  app.use("/admin", express.static(adminDir));
  app.get("/admin", (req, res) => {
    return res.sendFile(path.join(adminDir, "index.html"));
  });
  // Se no futuro houver rotas client-side no admin, mantemos fallback.
  app.get(/^\/admin(\/.*)?$/, (req, res) => {
    return res.sendFile(path.join(adminDir, "index.html"));
  });

  // Arquivos estáticos (CSS/JS)
  app.use(express.static(webDir));

  // Home do painel
  app.get("/", (req, res) => {
    return res.sendFile(path.join(webDir, "index.html"));
  });

  // Fallback SPA: qualquer rota que NÃO seja /api e NÃO seja /uploads
  app.get(/^\/(?!api\/|uploads\/|admin\/).*/, (req, res) => {
    return res.sendFile(path.join(webDir, "index.html"));
  });
}

/**
 * =====================================================
 *  404
 *  - Se for /api/* => JSON
 *  - Caso contrário, se SERVE_WEB=false => JSON simples
 * =====================================================
 */
app.use((req, res) => {
  const isApi = String(req.originalUrl || "").startsWith("/api/");
  const payload = { ok: false, error: "NotFound", message: "Not Found", path: req.originalUrl };

  if (isApi) return res.status(404).json(payload);

  // Se você desligou o SERVE_WEB, devolve JSON também
  if (!SERVE_WEB) return res.status(404).json(payload);

  // Se SERVE_WEB=true, normalmente o fallback já pegou.
  return res.status(404).json(payload);
});

/**
 * =====================================================
 *  ERROR HANDLER
 * =====================================================
 */
app.use(errorHandler);

/**
 * =====================================================
 *  START SERVER
 * =====================================================
 */
app.listen(PORT, BIND_HOST, () => {
  console.log("======================================");
  console.log("API do PDV ONLINE");
  console.log(`Ambiente : ${NODE_ENV}`);
  console.log(`Porta    : ${PORT}`);
  if (APP_URL_RAW) console.log(`APP_URL  : ${APP_URL_RAW}`);
  console.log(`WEB      : ${SERVE_WEB ? "ON" : "OFF"}`);
  console.log("======================================");
  if (!HAS_DATABASE_URL) {
    console.warn("[BOOT] DATABASE_URL ausente. Em DEV, a API sobe, mas rotas que usam banco vão falhar.");
    console.warn("[BOOT] Crie `backend/.env.local` (gitignored) ou exporte DATABASE_URL no ambiente.");
  }

  if (HAS_DATABASE_URL) {
    Promise.resolve()
      .then(ensureSuperAdminBootstrap)
      .then((r) => {
        if (r?.ok && isDev()) console.log("[ADMIN] SuperAdmin ensured.");
      })
      .catch((err) => {
        if (isDev()) console.warn("[ADMIN] Could not ensure SuperAdmin:", err?.message || err);
      });
  }

  // Seed de templates de e-mail (não bloqueia o servidor)
  if (HAS_DATABASE_URL) {
    Promise.resolve()
      .then(ensureDefaultEmailTemplates)
      .then((r) => {
        if (r?.ok && isDev()) console.log(`[MAILER] Templates ensured (${r.seeded || 0}).`);
      })
      .catch(() => {});
  }

  // SMTP health check (opcional; apenas logs). Habilite com SMTP_VERIFY_ON_START=true
  if (String(process.env.SMTP_VERIFY_ON_START || "").trim().toLowerCase() === "true") {
    Promise.resolve()
      .then(verifySmtpOnce)
      .catch(() => {});
  }

  // Billing sweep (nao bloqueia o servidor)
  if (HAS_DATABASE_URL) {
    const intervalMs = Number(process.env.BILLING_SWEEP_INTERVAL_MS || 0) || 5 * 60 * 1000;
    Promise.resolve()
      .then(billingSweepOnce)
      .catch(() => {});
    setInterval(() => {
      Promise.resolve()
        .then(billingSweepOnce)
        .catch(() => {});
    }, intervalMs);
  }
});
