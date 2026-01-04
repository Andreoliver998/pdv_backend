const merchantSettingsService = require("./merchantSettings.service");

function isDevEnv() {
  return String(process.env.NODE_ENV || "development").trim() !== "production";
}

function requireAuth(req, res) {
  if (!req.user || !req.user.merchantId) {
    res.status(401).json({ ok: false, error: "Unauthenticated", message: "Unauthenticated" });
    return false;
  }
  return true;
}

function toAbsoluteUrl(req, url) {
  if (url === undefined) return undefined;
  if (url === null) return null;

  const raw = String(url || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const pathPart = raw.startsWith("/") ? raw : `/${raw}`;
  const forwardedProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim();
  const proto = forwardedProto || req.protocol;
  const host = req.get("host");

  return `${proto}://${host}${pathPart}`;
}

/**
 * ✅ Normaliza payload do painel:
 * Aceita:
 * - { stockEnabled: false }
 * - { stock: { stockEnabled: false } }
 * - { ui: { showStock: false } } -> sincroniza stockEnabled com showStock
 */
function normalizePatch(rawBody) {
  const patch = rawBody && typeof rawBody === "object" ? { ...rawBody } : {};

  // stock.stockEnabled -> stockEnabled
  if (patch.stock && typeof patch.stock === "object" && typeof patch.stock.stockEnabled === "boolean") {
    patch.stockEnabled = patch.stock.stockEnabled;
  }

  // ui.showStock -> showStock e também stockEnabled (mesma intenção: "mostrar estoque")
  if (patch.ui && typeof patch.ui === "object" && typeof patch.ui.showStock === "boolean") {
    patch.showStock = patch.ui.showStock;
    patch.stockEnabled = patch.ui.showStock;
  }

  // showStock direto -> stockEnabled (se não veio stockEnabled)
  if (typeof patch.showStock === "boolean" && typeof patch.stockEnabled !== "boolean") {
    patch.stockEnabled = patch.showStock;
  }

  return patch;
}

async function get(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;
    const data = await merchantSettingsService.getSettings(req.user.merchantId);
    if (isDevEnv()) console.log(`[SETTINGS] loaded merchantId=${req.user.merchantId} userId=${req.user.id}`);
    return res.json({ ...data, logoUrl: toAbsoluteUrl(req, data.logoUrl) });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const patch = normalizePatch(req.body || {});

    // ✅ log DEV para você VER se está chegando stockEnabled=false
    if (isDevEnv()) {
      console.log(
        `[SETTINGS] update merchantId=${req.user.merchantId} userId=${req.user.id} keys=${Object.keys(patch).join(",")}`
      );
      if (typeof patch.stockEnabled === "boolean") console.log(`[SETTINGS] stockEnabled=${patch.stockEnabled}`);
      if (typeof patch.showStock === "boolean") console.log(`[SETTINGS] showStock=${patch.showStock}`);
    }

    const data = await merchantSettingsService.updateSettings(req.user.merchantId, patch, req.user.id);
    return res.json({ ...data, logoUrl: toAbsoluteUrl(req, data.logoUrl) });
  } catch (err) {
    return next(err);
  }
}

module.exports = { get, update };
