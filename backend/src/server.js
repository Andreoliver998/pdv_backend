/**
 * =====================================================
 *  PDV - API Server
 * =====================================================
 *  - Ambiente DEV e PROD
 *  - CORS inteligente (localhost + LAN + IPv6)
 *  - Compatível com Web e Android
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
const NODE_ENV = (process.env.NODE_ENV || "development").trim();
const APP_URL = (process.env.APP_URL || "").trim();

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

function isDev() {
  return NODE_ENV === "development" || !APP_URL;
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
 *  CORS (ROBUSTO)
 * =====================================================
 */
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const o = normalizeOrigin(origin);

    if (isDev()) {
      if (isLocalhostOrigin(o)) return callback(null, true);
      if (isLanOrigin(o)) return callback(null, true);
      if (DEV_ORIGINS.has(o)) return callback(null, true);

      return callback(new Error(`CORS DEV bloqueado para origin: ${o}`), false);
    }

    const allowedProd = normalizeOrigin(APP_URL);
    if (allowedProd && o === allowedProd) return callback(null, true);

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
  ],
  exposedHeaders: ["Content-Length"],
  optionsSuccessStatus: 204,
};

// ✅ CORS global (1 vez)
app.use(cors(corsOptions));

// ✅ Preflight (Express 5): use REGEX, não string "*" nem "/*"
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
 * =====================================================
 */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "PDV API",
    env: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

/**
 * =====================================================
 *  API ROUTES
 * =====================================================
 */
app.use("/api/auth", pickRouter(require("./modules/auth/auth.routes"), "auth"));
app.use("/api/users", pickRouter(require("./modules/users/users.routes"), "users"));
app.use("/api/products", pickRouter(require("./modules/product/product.routes"), "products"));
app.use("/api/sales", pickRouter(require("./modules/sale/sale.routes"), "sales"));
app.use("/api/reports", pickRouter(require("./modules/reports/reports.routes"), "reports"));
app.use("/api/terminals", pickRouter(require("./modules/terminal/terminal.routes"), "terminals"));
app.use("/api/pdv", pickRouter(require("./modules/pdv/pdv.routes"), "pdv"));
app.use(
  "/api/merchant-settings",
  pickRouter(
    require("./modules/merchantSettings/merchantSettings.routes"),
    "merchant-settings"
  )
);
app.use("/api/upload", pickRouter(require("./modules/upload/upload.routes"), "upload"));

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
  if (APP_URL) console.log(`APP_URL  : ${APP_URL}`);
  console.log("======================================");
});