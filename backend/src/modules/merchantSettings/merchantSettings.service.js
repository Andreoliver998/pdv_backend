// backend/src/modules/merchantSettings/merchantSettings.service.js
const prisma = require('../../config/prisma');

// Defaults de PRODUÇÃO (alta performance)
const DEFAULTS = {
  // Pagamentos
  allowCredit: true,
  allowDebit: true,
  allowPix: true,
  allowCash: true,
  defaultPayment: 'PIX',

  // Estoque
  allowNegativeStock: false,
  decrementStockOnSale: true, // 🔒 travado em true

  // Recibo/cupom
  receiptHeader: null,
  receiptFooter: null,

  // Relatórios
  reportsDefaultRange: 'today',
  reportsMaxRows: 100, // default produção
};

function normalizeBoolean(v, fallback) {
  if (typeof v === 'boolean') return v;
  // Aceita string "true"/"false" para robustez
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return true;
    if (s === 'false') return false;
  }
  return fallback;
}

function normalizeInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeStringOrNull(v, { maxLen = 400 } = {}) {
  if (v === undefined) return undefined; // não altera
  if (v === null) return null;

  let s = String(v).trim();
  if (!s.length) return null;

  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function normalizePaymentType(v, fallback) {
  const allowed = new Set(['CREDIT', 'DEBIT', 'PIX', 'CASH']);
  if (typeof v === 'string') {
    const up = v.trim().toUpperCase();
    if (allowed.has(up)) return up;
  }
  return fallback;
}

function normalizeRange(v, fallback) {
  const allowed = new Set(['today', 'week', 'month']);
  if (typeof v === 'string' && allowed.has(v)) return v;
  return fallback;
}

async function getOrCreate(merchantId) {
  const mid = Number(merchantId);

  const existing = await prisma.merchantSettings.findUnique({
    where: { merchantId: mid },
  });

  if (existing) return existing;

  return prisma.merchantSettings.create({
    data: {
      merchantId: mid,
      ...DEFAULTS,
    },
  });
}

async function getSettings(merchantId) {
  return getOrCreate(merchantId);
}

async function updateSettings(merchantId, patch) {
  const current = await getOrCreate(merchantId);

  // Normalização do payload (update parcial)
  const next = {
    // Pagamentos
    allowCredit: patch.allowCredit === undefined
      ? undefined
      : normalizeBoolean(patch.allowCredit, current.allowCredit),

    allowDebit: patch.allowDebit === undefined
      ? undefined
      : normalizeBoolean(patch.allowDebit, current.allowDebit),

    allowPix: patch.allowPix === undefined
      ? undefined
      : normalizeBoolean(patch.allowPix, current.allowPix),

    allowCash: patch.allowCash === undefined
      ? undefined
      : normalizeBoolean(patch.allowCash, current.allowCash),

    defaultPayment: patch.defaultPayment === undefined
      ? undefined
      : normalizePaymentType(patch.defaultPayment, current.defaultPayment),

    // Estoque
    allowNegativeStock: patch.allowNegativeStock === undefined
      ? undefined
      : normalizeBoolean(patch.allowNegativeStock, current.allowNegativeStock),

    // 🔒 trava em true para produção (ignora patch)
    decrementStockOnSale: true,

    // Recibo (limites para evitar payload gigante)
    receiptHeader: normalizeStringOrNull(patch.receiptHeader, { maxLen: 400 }),
    receiptFooter: normalizeStringOrNull(patch.receiptFooter, { maxLen: 400 }),

    // Relatórios (limites performance)
    reportsDefaultRange: patch.reportsDefaultRange === undefined
      ? undefined
      : normalizeRange(patch.reportsDefaultRange, current.reportsDefaultRange),

    reportsMaxRows: patch.reportsMaxRows === undefined
      ? undefined
      : Math.max(50, Math.min(200, normalizeInt(patch.reportsMaxRows, current.reportsMaxRows))),
  };

  // Regra: não pode desabilitar todos os pagamentos
  const enabledMap = {
    CREDIT: next.allowCredit ?? current.allowCredit,
    DEBIT:  next.allowDebit  ?? current.allowDebit,
    PIX:    next.allowPix    ?? current.allowPix,
    CASH:   next.allowCash   ?? current.allowCash,
  };

  const enabledCount = Object.values(enabledMap).filter(Boolean).length;
  if (enabledCount === 0) {
    const err = new Error('Você não pode desabilitar todos os meios de pagamento.');
    err.statusCode = 400;
    throw err;
  }

  // defaultPayment precisa estar habilitado: ajusta automaticamente
  function pickFirstEnabled() {
    const order = ['PIX', 'DEBIT', 'CASH', 'CREDIT'];
    return order.find((p) => enabledMap[p]) || 'PIX';
  }

  const desiredDefault = next.defaultPayment ?? current.defaultPayment;
  if (!enabledMap[desiredDefault]) {
    next.defaultPayment = pickFirstEnabled();
  }

  return prisma.merchantSettings.update({
    where: { id: current.id },
    data: next,
  });
}

module.exports = {
  getSettings,
  updateSettings,
};
