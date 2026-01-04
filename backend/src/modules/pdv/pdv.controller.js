// backend/src/modules/pdv/pdv.controller.js
const pdvService = require("./pdv.service");
const merchantSettingsService = require("../merchantSettings/merchantSettings.service");

const ALLOWED_PAYMENT_TYPES = ["CREDIT", "DEBIT", "PIX", "CASH"];
const ALLOWED_SALE_STATUS = ["PENDING", "PAID", "DECLINED", "CANCELLED", "CANCELED"];

function normalizePaymentType(paymentType) {
  return String(paymentType || "").toUpperCase().trim();
}

function normalizeSaleStatus(status) {
  const s = String(status || "").toUpperCase().trim();
  if (s === "CANCELLED") return "CANCELLED";
  if (s === "CANCELED") return "CANCELED";
  return s;
}

function toAbsoluteImageUrl(req, imageUrl) {
  if (imageUrl === undefined) return undefined;
  if (imageUrl === null) return null;

  const url = String(imageUrl).trim();
  if (!url) return null;

  if (/^https?:\/\//i.test(url)) return url;

  const path = url.startsWith("/") ? url : `/${url}`;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || req.protocol;
  const host = req.get("host");
  return `${proto}://${host}${path}`;
}

/**
 * ✅ PDV CONFIG: inclui merchant.tradeName + merchant.companyName
 * Endpoint: GET /api/pdv/config (X-Terminal-Key)
 */
async function getConfig(req, res, next) {
  try {
    const merchantId = req.merchant?.id || req.terminal?.merchantId || null;
    if (!merchantId) {
      return res.status(401).json({ message: "Unauthenticated terminal" });
    }

    const settings = await merchantSettingsService.getSettings(merchantId);

    // companyName vem do merchant (no seu middleware: merchant.name)
    const companyName = req.merchant?.name ? String(req.merchant.name).trim() : null;

    // tradeName vem do merchantSettings (se existir)
    const tradeName = settings?.tradeName ? String(settings.tradeName).trim() : null;

    const stockEnabled = !!settings.stockEnabled;

    return res.json({
      merchant: {
        tradeName: tradeName || null,
        companyName: companyName || null,
      },
      ui: {
        showStock: stockEnabled,
      },
      stock: {
        stockEnabled,
        allowNegativeStock: !!settings.allowNegativeStock,
        decrementStockOnSale: !!settings.decrementStockOnSale,
      },
      payments: {
        allowCredit: !!settings.allowCredit,
        allowDebit: !!settings.allowDebit,
        allowPix: !!settings.allowPix,
        allowCash: !!settings.allowCash,
        defaultPayment: String(settings.defaultPayment || "PIX").toUpperCase(),
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function listProducts(req, res, next) {
  try {
    const merchantId = req.merchant?.id || req.terminal?.merchantId || null;
    if (!merchantId) {
      return res.status(401).json({ message: "Unauthenticated terminal" });
    }

    const products = await pdvService.listProductsForPdv({ merchantId });
    return res.json(products.map((p) => ({ ...p, imageUrl: toAbsoluteImageUrl(req, p.imageUrl) })));
  } catch (err) {
    return next(err);
  }
}

async function createSale(req, res, next) {
  try {
    const terminal = req.terminal;
    const merchantId = req.merchant?.id || terminal?.merchantId || null;

    if (!merchantId || !terminal?.id) {
      return res.status(401).json({ message: "Unauthenticated terminal" });
    }

    const { items, paymentType, cashReceived, status, authorizationCode, transactionId, acquirer } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "items is required (array)" });
    }

    const pt = normalizePaymentType(paymentType);
    if (!pt) return res.status(400).json({ message: "paymentType is required" });
    if (!ALLOWED_PAYMENT_TYPES.includes(pt)) {
      return res.status(400).json({
        message: `Invalid paymentType. Use: ${ALLOWED_PAYMENT_TYPES.join(", ")}`,
      });
    }

    const st = status == null ? null : normalizeSaleStatus(status);
    if (st && !ALLOWED_SALE_STATUS.includes(st)) {
      return res.status(400).json({ message: `Invalid status. Use: ${ALLOWED_SALE_STATUS.join(", ")}` });
    }

    const normalizedItems = items.map((it) => ({
      productId: Number(it?.productId),
      quantity: Number(it?.quantity),
    }));

    for (const [idx, it] of normalizedItems.entries()) {
      if (!Number.isInteger(it.productId) || it.productId <= 0) {
        return res.status(400).json({ message: `items[${idx}].productId must be int > 0` });
      }
      if (!Number.isInteger(it.quantity) || it.quantity <= 0) {
        return res.status(400).json({ message: `items[${idx}].quantity must be int > 0` });
      }
    }

    const cr = cashReceived == null ? null : Number(cashReceived);
    if (cashReceived != null && Number.isNaN(cr)) {
      return res.status(400).json({ message: "cashReceived must be number" });
    }

    const sale = await pdvService.createSaleForPdv({
      merchantId,
      terminalId: terminal.id,
      paymentType: pt,
      status: st,
      items: normalizedItems,
      cashReceived: cr,
      authorizationCode: authorizationCode == null ? null : String(authorizationCode).trim() || null,
      transactionId: transactionId == null ? null : String(transactionId).trim() || null,
      acquirer: acquirer == null ? null : String(acquirer).trim() || null,
    });

    return res.status(201).json(sale);
  } catch (err) {
    return next(err);
  }
}

async function updateSaleStatus(req, res, next) {
  try {
    const terminal = req.terminal;
    const merchantId = req.merchant?.id || terminal?.merchantId || null;
    if (!merchantId || !terminal?.id) return res.status(401).json({ message: "Unauthenticated terminal" });

    const saleId = Number(req.params.id);
    if (!Number.isFinite(saleId) || saleId <= 0) {
      return res.status(400).json({ message: "Invalid sale id" });
    }

    const st = normalizeSaleStatus(req.body?.status);
    if (!st) return res.status(400).json({ message: "status is required" });
    if (!ALLOWED_SALE_STATUS.includes(st)) {
      return res.status(400).json({ message: `Invalid status. Use: ${ALLOWED_SALE_STATUS.join(", ")}` });
    }

    const sale = await pdvService.updateSaleStatusForPdv({
      merchantId,
      terminalId: terminal.id,
      saleId,
      status: st,
      authorizationCode: req.body?.authorizationCode == null ? null : String(req.body.authorizationCode).trim() || null,
      transactionId: req.body?.transactionId == null ? null : String(req.body.transactionId).trim() || null,
      acquirer: req.body?.acquirer == null ? null : String(req.body.acquirer).trim() || null,
    });

    return res.json(sale);
  } catch (err) {
    return next(err);
  }
}

module.exports = { getConfig, listProducts, createSale, updateSaleStatus };
