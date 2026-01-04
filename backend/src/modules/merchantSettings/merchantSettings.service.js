// backend/src/modules/merchantSettings/merchantSettings.service.js
const prisma = require("../../config/prisma");

// Defaults de PRODUÇÃO (alta performance)
const DEFAULTS = {
  // Dados da Empresa (no settings; companyName fica em Merchant.name)
  tradeName: null,
  phone: null,
  address: null,

  // Pagamentos
  allowCredit: true,
  allowDebit: true,
  allowPix: true,
  allowCash: true,
  defaultPayment: "PIX",

  // Estoque
  stockEnabled: true,
  allowNegativeStock: false,
  decrementStockOnSale: true, // travado em true

  // Recibo/cupom
  receiptHeader: null,
  receiptFooter: null,

  // Relatórios
  reportsDefaultRange: "today",
  reportsMaxRows: 100, // default produção
};

function isDevEnv() {
  return String(process.env.NODE_ENV || "development").trim() !== "production";
}

function normalizeBoolean(v, fallback) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
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

function normalizeCompanyName(v) {
  if (v === undefined) return undefined; // não altera
  const s = String(v || "").trim();
  if (!s) {
    const err = new Error("companyName é obrigatório.");
    err.statusCode = 400;
    throw err;
  }
  if (s.length > 120) {
    const err = new Error("companyName muito longo (máx 120).");
    err.statusCode = 400;
    throw err;
  }
  return s;
}

function normalizeDocument(v) {
  if (v === undefined) return undefined; // não altera
  const s = String(v || "").trim();
  if (!s) return null;

  const digits = s.replace(/\D+/g, "");
  if (!digits) return null;
  if (digits.length !== 11 && digits.length !== 14) {
    const err = new Error("document deve ter 11 (CPF) ou 14 (CNPJ) digitos.");
    err.statusCode = 400;
    throw err;
  }
  if (digits.length > 32) {
    const err = new Error("document muito longo (máx 32).");
    err.statusCode = 400;
    throw err;
  }
  return digits;
}

function normalizePaymentType(v, fallback) {
  const allowed = new Set(["CREDIT", "DEBIT", "PIX", "CASH"]);
  if (typeof v === "string") {
    const up = v.trim().toUpperCase();
    if (allowed.has(up)) return up;
  }
  return fallback;
}

function normalizeRange(v, fallback) {
  const allowed = new Set(["today", "week", "month"]);
  if (typeof v === "string" && allowed.has(v)) return v;
  return fallback;
}

async function getOrCreate(merchantId) {
  const mid = Number(merchantId);

  let existing;
  try {
    existing = await prisma.merchantSettings.findUnique({
      where: { merchantId: mid },
    });
  } catch (err) {
    // Ex.: coluna adicionada no schema, mas migration ainda não aplicada no banco.
    if (err?.code === "P2022" || String(err?.message || "").includes("does not exist")) {
      const e = new Error(
        'Banco de dados desatualizado. Rode as migrations do Prisma (ex.: `npx prisma migrate dev`) e reinicie o backend.'
      );
      e.statusCode = 500;
      throw e;
    }
    throw err;
  }

  if (existing) return existing;

  return prisma.merchantSettings.create({
    data: {
      merchantId: mid,
      ...DEFAULTS,
    },
  });
}

function toApiShape({ merchant, settings }) {
  return {
    ok: true,
    ...settings,
    companyName: merchant?.name || "",
    tradeName: settings?.tradeName ?? null,
    document: merchant?.cnpj ?? null,
    phone: settings?.phone ?? null,
    address: settings?.address ?? null,
    stockEnabled: settings?.stockEnabled ?? true,
  };
}

async function getSettings(merchantId) {
  const mid = Number(merchantId);
  const settings = await getOrCreate(mid);
  const merchant = await prisma.merchant.findUnique({
    where: { id: mid },
    select: { id: true, name: true, cnpj: true },
  });

  return toApiShape({ merchant, settings });
}

async function updateSettings(merchantId, patch, actorUserId) {
  const mid = Number(merchantId);
  const current = await getOrCreate(mid);

  const merchantPatch = {
    name: normalizeCompanyName(patch.companyName),
    cnpj: normalizeDocument(patch.document),
  };

  // Normalização do payload (update parcial)
  const next = {
    // Dados da Empresa (settings)
    tradeName: normalizeStringOrNull(patch.tradeName, { maxLen: 120 }),
    phone: normalizeStringOrNull(patch.phone, { maxLen: 30 }),
    address: normalizeStringOrNull(patch.address, { maxLen: 240 }),

    // Pagamentos
    allowCredit:
      patch.allowCredit === undefined ? undefined : normalizeBoolean(patch.allowCredit, current.allowCredit),
    allowDebit:
      patch.allowDebit === undefined ? undefined : normalizeBoolean(patch.allowDebit, current.allowDebit),
    allowPix: patch.allowPix === undefined ? undefined : normalizeBoolean(patch.allowPix, current.allowPix),
    allowCash: patch.allowCash === undefined ? undefined : normalizeBoolean(patch.allowCash, current.allowCash),

    defaultPayment:
      patch.defaultPayment === undefined
        ? undefined
        : normalizePaymentType(patch.defaultPayment, current.defaultPayment),

    // Estoque
    stockEnabled:
      patch.stockEnabled === undefined ? undefined : normalizeBoolean(patch.stockEnabled, current.stockEnabled ?? true),
    allowNegativeStock:
      patch.allowNegativeStock === undefined
        ? undefined
        : normalizeBoolean(patch.allowNegativeStock, current.allowNegativeStock),

    // trava em true para produção (ignora patch)
    decrementStockOnSale: true,

    // Recibo (limites para evitar payload gigante)
    receiptHeader: normalizeStringOrNull(patch.receiptHeader, { maxLen: 400 }),
    receiptFooter: normalizeStringOrNull(patch.receiptFooter, { maxLen: 400 }),

    // Relatórios (limites performance)
    reportsDefaultRange:
      patch.reportsDefaultRange === undefined
        ? undefined
        : normalizeRange(patch.reportsDefaultRange, current.reportsDefaultRange),

    reportsMaxRows:
      patch.reportsMaxRows === undefined
        ? undefined
        : Math.max(50, Math.min(200, normalizeInt(patch.reportsMaxRows, current.reportsMaxRows))),
  };

  // Regra: não pode desabilitar todos os pagamentos
  const enabledMap = {
    CREDIT: next.allowCredit ?? current.allowCredit,
    DEBIT: next.allowDebit ?? current.allowDebit,
    PIX: next.allowPix ?? current.allowPix,
    CASH: next.allowCash ?? current.allowCash,
  };

  const enabledCount = Object.values(enabledMap).filter(Boolean).length;
  if (enabledCount === 0) {
    const err = new Error("Você não pode desabilitar todos os meios de pagamento.");
    err.statusCode = 400;
    throw err;
  }

  // defaultPayment precisa estar habilitado: ajusta automaticamente
  function pickFirstEnabled() {
    const order = ["PIX", "DEBIT", "CASH", "CREDIT"];
    return order.find((p) => enabledMap[p]) || "PIX";
  }

  const desiredDefault = next.defaultPayment ?? current.defaultPayment;
  if (!enabledMap[desiredDefault]) {
    next.defaultPayment = pickFirstEnabled();
  }

  const shouldUpdateMerchant =
    merchantPatch.name !== undefined || merchantPatch.cnpj !== undefined;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const merchant =
        shouldUpdateMerchant
          ? await tx.merchant.update({
              where: { id: mid },
              data: {
                ...(merchantPatch.name !== undefined ? { name: merchantPatch.name } : {}),
                ...(merchantPatch.cnpj !== undefined ? { cnpj: merchantPatch.cnpj } : {}),
              },
              select: { id: true, name: true, cnpj: true },
            })
          : await tx.merchant.findUnique({
              where: { id: mid },
              select: { id: true, name: true, cnpj: true },
            });

      const settings = await tx.merchantSettings.update({
        where: { id: current.id },
        data: next,
      });

      return { merchant, settings };
    });

    if (isDevEnv()) {
      console.log(`[SETTINGS] updated merchantId=${mid} userId=${actorUserId ?? "?"}`);
    }

    return toApiShape(result);
  } catch (err) {
    // Quando o schema Prisma foi alterado mas a migration/client ainda não foram aplicados.
    const msg = String(err?.message || "");
    if (err?.code === "P2022" || msg.includes("does not exist")) {
      const e = new Error(
        'Banco de dados desatualizado. Rode as migrations do Prisma (ex.: `npx prisma migrate dev`) e reinicie o backend.'
      );
      e.statusCode = 500;
      throw e;
    }
    if (
      err?.name === "PrismaClientValidationError" &&
      (msg.includes("Unknown argument `tradeName`") ||
        msg.includes("Unknown argument `phone`") ||
        msg.includes("Unknown argument `address`") ||
        msg.includes("Unknown argument `stockEnabled`"))
    ) {
      const e = new Error(
        "Schema Prisma desatualizado. Rode: `npx prisma migrate dev` e depois `npx prisma generate`, e reinicie o backend."
      );
      e.statusCode = 500;
      throw e;
    }

    // Unique constraint (cnpj)
    if (err?.code === "P2002") {
      const e = new Error("Documento já está em uso por outro estabelecimento.");
      e.statusCode = 400;
      throw e;
    }
    throw err;
  }
}

module.exports = {
  getSettings,
  updateSettings,
};
