// backend/src/modules/pdv/pdv.service.js
const prisma = require('../../config/prisma');
const { Prisma } = require('@prisma/client');

/**
 * Converte string decimal ("12.50") para centavos (1250) sem float.
 */
function decimalToCents(value) {
  const s = String(value ?? '0').trim().replace(',', '.');
  const [intPartRaw, decPartRaw = ''] = s.split('.');
  const intPart = parseInt(intPartRaw || '0', 10);
  const decPart = (decPartRaw + '00').slice(0, 2);
  const dec = parseInt(decPart, 10);
  return intPart * 100 + dec;
}

function centsToDecimal(cents) {
  const v = (Number(cents || 0) / 100).toFixed(2);
  return new Prisma.Decimal(v);
}

/**
 * Converte Prisma.Decimal / string / number em number com 2 casas.
 */
function toNumber2(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number(n.toFixed(2));
}

/**
 * Lista produtos ativos do merchant (PDV)
 */
async function listProductsForPdv({ merchantId }) {
  const rows = await prisma.product.findMany({
    where: { merchantId: Number(merchantId), active: true },
    orderBy: { name: 'asc' },
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

/**
 * Cria uma venda pelo PDV, com baixa de estoque e itens.
 * CASH agora NÃO exige cashReceived e NÃO calcula troco.
 */
async function createSaleForPdv({ merchantId, terminalId, paymentType, items, cashReceived }) {
  const mId = Number(merchantId);
  const tId = Number(terminalId);

  if (!mId || !tId) {
    const err = new Error('Invalid merchantId/terminalId');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('items is required');
    err.statusCode = 400;
    throw err;
  }

  const pt = String(paymentType || '').toUpperCase().trim();
  const allowedPaymentTypes = ['CREDIT', 'DEBIT', 'PIX', 'CASH'];
  if (!allowedPaymentTypes.includes(pt)) {
    const err = new Error(`Invalid paymentType. Use: ${allowedPaymentTypes.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  // Normaliza itens
  const normalized = items.map((it) => ({
    productId: Number(it.productId),
    quantity: Number(it.quantity),
  }));

  for (const it of normalized) {
    if (!it.productId || it.productId <= 0 || !it.quantity || it.quantity <= 0) {
      const err = new Error('Invalid item: productId and quantity must be > 0');
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

  return prisma.$transaction(async (tx) => {
    const productIds = mergedItems.map((i) => i.productId);

    const products = await tx.product.findMany({
      where: { id: { in: productIds }, merchantId: mId, active: true },
      select: { id: true, name: true, price: true, stock: true },
    });

    if (products.length !== productIds.length) {
      const err = new Error('One or more products are not available for this merchant/PDV');
      err.statusCode = 400;
      throw err;
    }

    const byId = new Map(products.map((p) => [p.id, p]));

    // Estoque
    for (const it of mergedItems) {
      const p = byId.get(it.productId);
      if (!p) {
        const err = new Error(`Product ${it.productId} not found`);
        err.statusCode = 400;
        throw err;
      }
      if (p.stock < it.quantity) {
        const err = new Error(`Insufficient stock for "${p.name}"`);
        err.statusCode = 400;
        throw err;
      }
    }

    // Total em centavos
    let totalCents = 0;
    for (const it of mergedItems) {
      const p = byId.get(it.productId);
      const priceCents = decimalToCents(p.price.toString());
      totalCents += priceCents * it.quantity;
    }

    const totalAmount = centsToDecimal(totalCents);

    // ✅ CASH sem valor recebido: sempre salva NULL nos campos de caixa.
    const sale = await tx.sale.create({
      data: {
        merchantId: mId,
        terminalId: tId,
        paymentType: pt,
        status: 'PAID',
        totalAmount,
        cashReceived: null,
        changeGiven: null,
      },
      select: {
        id: true,
        merchantId: true,
        terminalId: true,
        paymentType: true,
        status: true,
        totalAmount: true,
        cashReceived: true,
        changeGiven: true,
        createdAt: true,
      },
    });

    // Itens
    await tx.saleItem.createMany({
      data: mergedItems.map((it) => {
        const p = byId.get(it.productId);
        return {
          saleId: sale.id,
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: p.price,
        };
      }),
    });

    // Baixa estoque
    for (const it of mergedItems) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { decrement: it.quantity } },
      });
    }

    const fullSale = await tx.sale.findUnique({
      where: { id: sale.id },
      include: { items: true },
    });

    return {
      ...fullSale,
      totalAmount: toNumber2(fullSale.totalAmount),
      cashReceived: fullSale.cashReceived == null ? null : toNumber2(fullSale.cashReceived),
      changeGiven: fullSale.changeGiven == null ? null : toNumber2(fullSale.changeGiven),
      items: (fullSale.items || []).map((it) => ({
        ...it,
        unitPrice: toNumber2(it.unitPrice),
      })),
    };
  });
}

module.exports = {
  listProductsForPdv,
  createSaleForPdv,
};