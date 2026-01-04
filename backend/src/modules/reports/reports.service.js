// backend/src/modules/reports/reports.service.js
const prisma = require('../../config/prisma');

/**
 * Prisma pode retornar Decimal; padronizamos em Number(2 casas)
 */
function toNumber2(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

/**
 * 🔑 REGRA CENTRAL DO RELATÓRIO
 * - Considera apenas vendas FINALIZADAS (PAID)
 * - Ignora PENDING e CANCELADAS
 */
function baseWhere({ merchantId, start, end }) {
  return {
    merchantId: Number(merchantId),
    status: 'PAID',
    createdAt: { gte: start, lte: end },
  };
}

async function getSummary({ merchantId, start, end }) {
  const where = baseWhere({ merchantId, start, end });

  const [count, agg] = await prisma.$transaction([
    prisma.sale.count({ where }),
    prisma.sale.aggregate({
      where,
      _sum: { totalAmount: true },
      _avg: { totalAmount: true },
    }),
  ]);

  const total = toNumber2(agg?._sum?.totalAmount);
  const avg = toNumber2(agg?._avg?.totalAmount);

  let payments = [];

  try {
    const byPayment = await prisma.sale.groupBy({
      by: ['paymentType'],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true },
    });

    payments = (byPayment || []).map((p) => ({
      paymentType: p.paymentType,
      count: p._count?._all || 0,
      totalAmount: toNumber2(p._sum?.totalAmount),
    }));
  } catch {
    // Fallback seguro
    const rows = await prisma.sale.findMany({
      where,
      select: { paymentType: true, totalAmount: true },
    });

    const map = new Map();
    for (const r of rows) {
      const key = r.paymentType || 'UNKNOWN';
      const prev = map.get(key) || { paymentType: key, count: 0, totalAmount: 0 };
      prev.count += 1;
      prev.totalAmount = toNumber2(prev.totalAmount + toNumber2(r.totalAmount));
      map.set(key, prev);
    }
    payments = Array.from(map.values());
  }

  payments.sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    range: { start, end },
    totalAmount: total,
    salesCount: count,
    avgTicket: avg,
    payments,
  };
}

async function listSales({ merchantId, start, end }) {
  const where = baseWhere({ merchantId, start, end });

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      paymentType: true,
      status: true,
      totalAmount: true,
      items: {
        select: { quantity: true, unitPrice: true, productId: true },
      },
    },
  });

  return (sales || []).map((s) => ({
    ...s,
    totalAmount: toNumber2(s.totalAmount),
    items: (s.items || []).map((it) => ({
      ...it,
      unitPrice: toNumber2(it.unitPrice),
      quantity: Number(it.quantity || 0),
    })),
  }));
}

async function topProducts({ merchantId, start, end }) {
  const whereSale = baseWhere({ merchantId, start, end });

  const items = await prisma.saleItem.findMany({
    where: { sale: whereSale },
    select: {
      productId: true,
      quantity: true,
      unitPrice: true,
      product: { select: { name: true } },
    },
  });

  const map = new Map();

  for (const it of items) {
    const qty = Number(it.quantity || 0);
    const unit = toNumber2(it.unitPrice);

    const prev = map.get(it.productId) || {
      productId: it.productId,
      name: it.product?.name || `#${it.productId}`,
      quantity: 0,
      revenue: 0,
    };

    prev.quantity += qty;
    prev.revenue = toNumber2(prev.revenue + qty * unit);

    map.set(it.productId, prev);
  }

  return Array.from(map.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
}

module.exports = {
  getSummary,
  listSales,
  topProducts,
};
