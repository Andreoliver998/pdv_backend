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

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const errorHandler = require("./middlewares/errorHandler");

const app = express();

/**
 * =====================================================
 *  CONFIGURAÇÕES GERAIS
 * =====================================================
 */
const PORT = Number(process.env.PORT) || 3333;
const NODE_ENV = String(process.env.NODE_ENV || "development").trim();
const APP_URL_RAW = String(process.env.APP_URL || "").trim();
const DEFAULT_PROD_ORIGINS = [
  "https://paytech.app.br",
  "https://www.paytech.app.br",
];

/**
 * Se você quiser desligar o painel estático em produção,
 * basta definir SERVE_WEB=false no .env
 */
const SERVE_WEB =
  String(process.env.SERVE_WEB ?? "true").trim().toLowerCase() !== "false";

// ✅ Se você usar proxy/túnel (Nginx, Cloudflare, etc.)
app.set("trust proxy", 1);

/**
 * =====================================================
 *  ORIGENS PERMITIDAS (DEV)
 * =====================================================
 */
const DEV_ORIGINS = new Set([
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/$/, "");
}

/**
 * ✅ Regra mais segura:
 * - Se NODE_ENV !== "production" => DEV
 * - Se NODE_ENV === "production" => PROD (exige APP_URL para liberar origens)
 *
 * Obs: Apps Android nativos (Retrofit) normalmente não mandam Origin,
 * então não sofrem com CORS.
 */
function isDev() {
  return NODE_ENV !== "production";
}

function isLocalhostOrigin(o) {
  return (
    /^http:\/\/localhost:\d+$/i.test(o) ||
    /^http:\/\/127\.0\.0\.1:\d+$/i.test(o) ||
    /^http:\/\/0\.0\.0\.0:\d+$/i.test(o) ||
    /^http:\/\/\[\:\:1\]:\d+$/i.test(o)
  );
}

function isLanOrigin(o) {
  return (
    /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/i.test(o) ||
    /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/i.test(o) ||
    /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:\d+$/i.test(o)
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
const PROD_ALLOWED_ORIGINS = (() => {
  const fromEnv = APP_URL_RAW
    ? APP_URL_RAW.split(",")
        .map((u) => normalizeOrigin(u))
        .filter(Boolean)
    : [];
  const merged = new Set([...DEFAULT_PROD_ORIGINS, ...fromEnv]);
  return Array.from(merged);
})();

function isAllowedProdOrigin(o) {
  if (!o) return false;
  return PROD_ALLOWED_ORIGINS.includes(normalizeOrigin(o));
}

/**
 * =====================================================
 *  CORS (ROBUSTO)
 * =====================================================
 */
const corsOptions = {
  origin: (origin, callback) => {
    // ✅ Origin vazio acontece em:
    // - curl
    // - apps mobile nativos
    // - alguns webviews
    // Geralmente é OK permitir.
    if (!origin) return callback(null, true);

    const o = normalizeOrigin(origin);

    if (isDev()) {
      if (isLocalhostOrigin(o)) return callback(null, true);
      if (isLanOrigin(o)) return callback(null, true);
      if (DEV_ORIGINS.has(o)) return callback(null, true);

      return callback(new Error(`CORS DEV bloqueado para origin: ${o}`), false);
    }

    // PROD: só libera quem estiver em APP_URL (ou lista)
    if (isAllowedProdOrigin(o)) return callback(null, true);

    return callback(new Error(`CORS PROD bloqueado para origin: ${o}`), false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
    // headers do modo Terminal
    "X-Terminal-Key",
    "X-Terminal-Api-Key",
    "X-Api-Key",
  ],
  exposedHeaders: ["Content-Length"],
  optionsSuccessStatus: 204,
};

// ✅ CORS global (1 vez)
app.use(cors(corsOptions));

// ✅ Preflight (Express 5): use REGEX
app.options(/.*/, cors(corsOptions));

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
    throw new Error(
      `Invalid router export: ${name}. Esperado um express.Router().`
    );
  }
  return router;
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
    ok: true,
    service: "PDV API",
    env: NODE_ENV,
    timestamp: new Date().toISOString(),
  };
}

app.get("/health", (req, res) => res.json(healthPayload()));
app.get("/api/health", (req, res) => res.json(healthPayload()));

/**
 * =====================================================
 *  API ROUTES
 * =====================================================
 */
app.use("/api/auth", pickRouter(require("./modules/auth/auth.routes"), "auth"));
app.use(
  "/api/users",
  pickRouter(require("./modules/users/users.routes"), "users")
);
app.use(
  "/api/products",
  pickRouter(require("./modules/product/product.routes"), "products")
);
app.use(
  "/api/sales",
  pickRouter(require("./modules/sale/sale.routes"), "sales")
);
app.use(
  "/api/reports",
  pickRouter(require("./modules/reports/reports.routes"), "reports")
);
app.use(
  "/api/terminals",
  pickRouter(require("./modules/terminal/terminal.routes"), "terminals")
);
app.use("/api/pdv", pickRouter(require("./modules/pdv/pdv.routes"), "pdv"));
app.use(
  "/api/merchant-settings",
  pickRouter(
    require("./modules/merchantSettings/merchantSettings.routes"),
    "merchant-settings"
  )
);
app.use(
  "/api/upload",
  pickRouter(require("./modules/upload/upload.routes"), "upload")
);

/**
 * =====================================================
 *  SERVIR PAINEL WEB (HTML/CSS/JS)
 *  IMPORTANTE: fica DEPOIS das rotas da API,
 *  para não “engolir” /health e /api/*
 * =====================================================
 */
if (SERVE_WEB) {
  const webDir = path.join(__dirname, "..", "public");

  // Arquivos estáticos (CSS/JS)
  app.use(express.static(webDir));

  // Home do painel
  app.get("/", (req, res) => {
    return res.sendFile(path.join(webDir, "index.html"));
  });

  // Fallback SPA: qualquer rota que NÃO seja /api e NÃO seja /uploads
  app.get(/^\/(?!api\/|uploads\/).*/, (req, res) => {
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
  const payload = { ok: false, error: "Not Found", path: req.originalUrl };

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
app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("API do PDV ONLINE");
  console.log(`Ambiente : ${NODE_ENV}`);
  console.log(`Porta    : ${PORT}`);
  if (APP_URL_RAW) console.log(`APP_URL  : ${APP_URL_RAW}`);
  console.log(`WEB      : ${SERVE_WEB ? "ON" : "OFF"}`);
  console.log("======================================");
});
