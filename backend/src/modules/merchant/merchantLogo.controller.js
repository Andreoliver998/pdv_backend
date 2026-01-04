const fs = require("fs");
const merchantLogoService = require("./merchantLogo.service");

function requireAuth(req, res) {
  const merchantId = Number(req.user?.merchantId || 0);
  if (!merchantId) {
    res.status(401).json({ ok: false, error: "Unauthenticated", message: "Unauthenticated" });
    return null;
  }
  return merchantId;
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

async function getLogo(req, res, next) {
  try {
    const merchantId = requireAuth(req, res);
    if (!merchantId) return;

    const data = await merchantLogoService.getLogo({ merchantId });
    return res.json({
      ok: true,
      logoUrl: toAbsoluteUrl(req, data.logoUrl),
      logoUpdatedAt: data.logoUpdatedAt ?? null,
    });
  } catch (err) {
    return next(err);
  }
}

async function uploadLogo(req, res, next) {
  try {
    const merchantId = requireAuth(req, res);
    if (!merchantId) return;

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "MISSING_FILE", message: "Arquivo 'logo' \u00e9 obrigat\u00f3rio." });
    }

    const result = await merchantLogoService.setLogo({
      merchantId,
      filename: req.file.filename,
    });

    return res.status(201).json({
      ok: true,
      logoUrl: toAbsoluteUrl(req, result.logoUrl),
      logoUpdatedAt: result.logoUpdatedAt ?? null,
    });
  } catch (err) {
    try {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch {}
    return next(err);
  }
}

async function deleteLogo(req, res, next) {
  try {
    const merchantId = requireAuth(req, res);
    if (!merchantId) return;

    const result = await merchantLogoService.deleteLogo({ merchantId });
    return res.json({
      ok: true,
      logoUrl: null,
      deleted: result.deleted,
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getLogo, uploadLogo, deleteLogo };

