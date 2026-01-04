// backend/src/modules/pdv/pdv.service.js
const prisma = require("../../config/prisma");
const { Prisma } = require("@prisma/client");

function normalizePaymentType(v) {
  return String(v || "").trim().toUpperCase();
}

function normalizeStatus(v) {
  const s = String(v || "").trim().toUpperCase();
  if (s === "CANCELED") return "CANCELED";
  if (s === "CANCELLED") return "CANCELLED";
  return s;
}

function decimalToCents(value) {
  const s = String(value ?? "0").trim().replace(",", ".");
  const [intPartRaw, decPartRaw = ""] = s.split(".");
  const intPart = parseInt(intPartRaw || "0", 10);
  const decPart = (decPartRaw + "00").slice(0, 2);
  const dec = parseInt(decPart, 10);
  return intPart * 100 + dec;
}

function centsToDecimal(cents) {
  const v = (Number(cents || 0) / 100).toFixed(2);
  return new Prisma.Decimal(v);
}

function toNumber2(v) {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number(n.toFixed(2));
}

async function getMerchantSettings(tx, merchantId) {
  const settings = await tx.merchantSettings.findUnique({
    where: { merchantId: Number(merchantId) },
    select: {
      stockEnabled: true,
      allowCredit: true,
      allowDebit: true,
      allowPix: true,
      allowCash: true,
      allowNegativeStock: true,
      decrementStockOnSale: true,
    },
  });

  return (
    settings || {
      stockEnabled: true,
      allowCredit: true,
      allowDebit: true,
      allowPix: true,
      allowCash: true,
      allowNegativeStock: false,
      decrementStockOnSale: true,
    }
  );
}

function isPaymentAllowed(settings, paymentType) {
  if (paymentType === "CREDIT") return settings.allowCredit !== false;
  if (paymentType === "DEBIT") return settings.allowDebit !== false;
  if (paymentType === "PIX") return settings.allowPix !== false;
  if (paymentType === "CASH") return settings.allowCash !== false;
  return false;
}

async function listProductsForPdv({ merchantId }) {
  const rows = await prisma.product.findMany({
    where: { merchantId: Number(merchantId), active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      price: true,
      stock: true,
      category: true,
      imageUrl: true,
      active: true,
    },
  });

  return rows.map((p) => ({ ...p, price: toNumber2(p.price) }));
}

async function createSaleForPdv({
  merchantId,
  terminalId,
  paymentType,
  status,
  items,
  cashReceived,
  changeGiven,
  authorizationCode,
  transactionId,
  acquirer,
}) {
  const mId = Number(merchantId);
  const tId = Number(terminalId);

  if (!mId || !tId) {
    const err = new Error("Invalid merchantId/terminalId");
    err.statusCode = 400;
    throw err;
  }

  const pt = normalizePaymentType(paymentType);
  const allowedPaymentTypes = ["CREDIT", "DEBIT", "PIX", "CASH"];
  if (!allowedPaymentTypes.includes(pt)) {
    const err = new Error(`Invalid paymentType. Use: ${allowedPaymentTypes.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("items is required");
    err.statusCode = 400;
    throw err;
  }

  const normalized = items.map((it) => ({
    productId: Number(it.productId),
    quantity: Number(it.quantity),
  }));

  for (const it of normalized) {
    if (!Number.isInteger(it.productId) || it.productId <= 0 || !Number.isInteger(it.quantity) || it.quantity <= 0) {
      const err = new Error("Invalid item: productId and quantity must be int > 0");
      err.statusCode = 400;
      throw err;
    }
  }

  // Junta duplicados
  const merged = new Map();
  for (const it of normalized) {
    merged.set(it.productId, (merged.get(it.productId) || 0) + it.quantity);
  }
  const mergedItems = [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));

  // Regras de status:
  // - CASH: default PAID
  // - PIX/DEBIT/CREDIT: default PENDING (app confirma depois) - ou PAID se já aprovado + metadados.
  const desiredStatus = status ? normalizeStatus(status) : pt === "CASH" ? "PAID" : "PENDING";

  const allowedStatus = new Set(["PENDING", "PAID", "DECLINED", "CANCELLED", "CANCELED"]);
  if (!allowedStatus.has(desiredStatus)) {
    const err = new Error(`Invalid status. Use: ${Array.from(allowedStatus).join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  if (pt !== "CASH" && desiredStatus === "PAID") {
    if (!String(authorizationCode || "").trim() && !String(transactionId || "").trim()) {
      const err = new Error("authorizationCode or transactionId is required when marking non-cash sale as PAID");
      err.statusCode = 400;
      throw err;
    }
  }

  return prisma.$transaction(async (tx) => {
    const settings = await getMerchantSettings(tx, mId);
    if (!isPaymentAllowed(settings, pt)) {
      const err = new Error("Payment type not allowed by merchant settings");
      err.statusCode = 403;
      throw err;
    }

    const productIds = mergedItems.map((i) => i.productId);
    const products = await tx.product.findMany({
      where: { id: { in: productIds }, merchantId: mId, active: true },
      select: { id: true, name: true, price: true, stock: true },
    });

    if (products.length !== productIds.length) {
      const err = new Error("One or more products are not available for this merchant/PDV");
      err.statusCode = 400;
      throw err;
    }

    const byId = new Map(products.map((p) => [p.id, p]));

    // Total em centavos (preço atual do produto)
    let totalCents = 0;
    for (const it of mergedItems) {
      const p = byId.get(it.productId);
      const priceCents = decimalToCents(p.price.toString());
      totalCents += priceCents * it.quantity;
    }

    const totalAmount = centsToDecimal(totalCents);

    const stockEnabled = settings.stockEnabled !== false;
    const shouldDecrementStockNow =
      stockEnabled && settings.decrementStockOnSale !== false && desiredStatus === "PAID";

    // Validação de estoque (antes de gravar)
    if (stockEnabled && settings.allowNegativeStock !== true) {
      for (const it of mergedItems) {
        const p = byId.get(it.productId);
        if (Number(p.stock) < it.quantity) {
          const err = new Error(`Insufficient stock for "${p.name}"`);
          err.statusCode = 400;
          throw err;
        }
      }
    }

    let cashReceivedDecimal = null;
    let changeGivenDecimal = null;

    if (pt === "CASH") {
      if (cashReceived != null) {
        const crCents = decimalToCents(cashReceived);
        const changeCents = crCents - totalCents;
        if (changeCents < 0) {
          const err = new Error("cashReceived is less than totalAmount");
          err.statusCode = 400;
          throw err;
        }
        cashReceivedDecimal = centsToDecimal(crCents);
        changeGivenDecimal = centsToDecimal(changeCents);
      }
    }

    if (changeGiven != null) {
      // Permite override somente em DEV/compat (ex.: app já calculou); caso contrário, usa cálculo acima.
      changeGivenDecimal = centsToDecimal(decimalToCents(changeGiven));
    }

    const sale = await tx.sale.create({
      data: {
        merchantId: mId,
        terminalId: tId,
        paymentType: pt,
        status: desiredStatus,
        totalAmount,
        cashReceived: cashReceivedDecimal,
        changeGiven: changeGivenDecimal,
        authorizationCode: authorizationCode || null,
        transactionId: transactionId || null,
        acquirer: acquirer || null,
        items: {
          create: mergedItems.map((it) => {
            const p = byId.get(it.productId);
            return { productId: it.productId, quantity: it.quantity, unitPrice: p.price };
          }),
        },
      },
      include: { items: true },
    });

    if (shouldDecrementStockNow) {
      for (const it of mergedItems) {
        if (settings.allowNegativeStock === true) {
          await tx.product.update({
            where: { id: it.productId },
            data: { stock: { decrement: it.quantity } },
          });
          continue;
        }

        const updated = await tx.product.updateMany({
          where: { id: it.productId, merchantId: mId, active: true, stock: { gte: it.quantity } },
          data: { stock: { decrement: it.quantity } },
        });
        if (updated.count === 0) {
          const err = new Error(`Insufficient stock for productId=${it.productId}`);
          err.statusCode = 400;
          throw err;
        }
      }
    }

    return {
      ...sale,
      totalAmount: toNumber2(sale.totalAmount),
      cashReceived: sale.cashReceived == null ? null : toNumber2(sale.cashReceived),
      changeGiven: sale.changeGiven == null ? null : toNumber2(sale.changeGiven),
      items: (sale.items || []).map((it) => ({ ...it, unitPrice: toNumber2(it.unitPrice) })),
    };
  });
}

async function updateSaleStatusForPdv({ merchantId, terminalId, saleId, status, authorizationCode, transactionId, acquirer }) {
  const mId = Number(merchantId);
  const tId = Number(terminalId);
  const sId = Number(saleId);
  if (!mId || !tId || !sId) {
    const err = new Error("Invalid merchantId/terminalId/saleId");
    err.statusCode = 400;
    throw err;
  }

  const nextStatus = normalizeStatus(status);
  const allowed = new Set(["PAID", "DECLINED", "CANCELLED", "CANCELED"]);
  if (!allowed.has(nextStatus)) {
    const err = new Error(`Invalid status. Use: ${Array.from(allowed).join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: sId, merchantId: mId, terminalId: tId },
      include: { items: true },
    });

    if (!sale) {
      const err = new Error("Sale not found for this terminal");
      err.statusCode = 404;
      throw err;
    }

    if (sale.status === nextStatus) {
      return {
        ...sale,
        totalAmount: toNumber2(sale.totalAmount),
        cashReceived: sale.cashReceived == null ? null : toNumber2(sale.cashReceived),
        changeGiven: sale.changeGiven == null ? null : toNumber2(sale.changeGiven),
        items: (sale.items || []).map((it) => ({ ...it, unitPrice: toNumber2(it.unitPrice) })),
      };
    }

    if (sale.status !== "PENDING") {
      const err = new Error(`Cannot change status from ${sale.status} to ${nextStatus}`);
      err.statusCode = 409;
      throw err;
    }

    const settings = await getMerchantSettings(tx, mId);
    const stockEnabled = settings.stockEnabled !== false;
    const shouldDecrementStockNow =
      stockEnabled && settings.decrementStockOnSale !== false && nextStatus === "PAID";

    if (sale.paymentType !== "CASH" && nextStatus === "PAID") {
      if (!String(authorizationCode || "").trim() && !String(transactionId || "").trim()) {
        const err = new Error("authorizationCode or transactionId is required when marking non-cash sale as PAID");
        err.statusCode = 400;
        throw err;
      }
    }

    if (shouldDecrementStockNow) {
      // Precisa baixar estoque aqui (confirmação do app)
      for (const it of sale.items || []) {
        if (settings.allowNegativeStock === true) {
          await tx.product.update({
            where: { id: it.productId },
            data: { stock: { decrement: it.quantity } },
          });
          continue;
        }

        const updated = await tx.product.updateMany({
          where: { id: it.productId, merchantId: mId, active: true, stock: { gte: it.quantity } },
          data: { stock: { decrement: it.quantity } },
        });
        if (updated.count === 0) {
          const err = new Error(`Insufficient stock for productId=${it.productId}`);
          err.statusCode = 400;
          throw err;
        }
      }
    }

    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: nextStatus,
        authorizationCode: authorizationCode || undefined,
        transactionId: transactionId || undefined,
        acquirer: acquirer || undefined,
      },
      include: { items: true },
    });

    return {
      ...updatedSale,
      totalAmount: toNumber2(updatedSale.totalAmount),
      cashReceived: updatedSale.cashReceived == null ? null : toNumber2(updatedSale.cashReceived),
      changeGiven: updatedSale.changeGiven == null ? null : toNumber2(updatedSale.changeGiven),
      items: (updatedSale.items || []).map((it) => ({ ...it, unitPrice: toNumber2(it.unitPrice) })),
    };
  });
}

module.exports = {
  listProductsForPdv,
  createSaleForPdv,
  updateSaleStatusForPdv,
};

