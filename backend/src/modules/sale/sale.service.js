// backend/src/modules/sale/sale.service.js
const prisma = require('../../config/prisma');
const printJobsService = require('../printJobs/printJobs.service');

const PAYMENTS = new Set(['CREDIT', 'DEBIT', 'PIX', 'CASH']);
const ALLOWED_STATUS = new Set(['PENDING', 'PAID', 'DECLINED', 'CANCELLED', 'CANCELED']);

function normalizePaymentType(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'CRÉDITO' || t === 'CREDITO') return 'CREDIT';
  if (t === 'DÉBITO' || t === 'DEBITO') return 'DEBIT';
  if (t === 'DINHEIRO') return 'CASH';
  return t;
}

function normalizeStatus(v) {
  return String(v || '').trim().toUpperCase();
}

/**
 * Regra de negócio (ajuste para o seu cenário atual):
 * - Venda criada no PDV Web deve entrar no relatório imediatamente.
 * - Portanto: cria como PAID.
 * - Se futuramente você quiser fluxo PENDING -> PAID, controlamos isso por config.
 */
async function createSale({ merchantId, terminalId, items, paymentType, operatorName }) {
  if (!merchantId) throw new Error('merchantId is required');

  const pay = normalizePaymentType(paymentType);
  if (!PAYMENTS.has(pay)) {
    throw new Error(`Invalid paymentType. Allowed: ${Array.from(PAYMENTS).join(', ')}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items array is required');
  }

  // Normaliza payload
  const normalized = items.map((i) => ({
    productId: Number(i.productId),
    quantity: Number(i.quantity),
  }));

  if (normalized.some((i) => !i.productId || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
    throw new Error('Invalid items payload');
  }

  // Agrupa duplicados
  const grouped = new Map();
  for (const it of normalized) {
    grouped.set(it.productId, (grouped.get(it.productId) || 0) + it.quantity);
  }

  const finalItems = Array.from(grouped.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));

  const productIds = finalItems.map((i) => i.productId);

  // Busca produtos do merchant (somente ativos)
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      merchantId: Number(merchantId),
      active: true,
    },
    select: { id: true, name: true, price: true, stock: true },
  });

  if (products.length !== productIds.length) {
    throw new Error('One or more products are invalid for this merchant');
  }

  const byId = new Map(products.map((p) => [p.id, p]));

  // Total calculado no servidor
  const totalAmount = finalItems.reduce((sum, it) => {
    const p = byId.get(it.productId);
    return sum + Number(p.price) * Number(it.quantity);
  }, 0);

  const sale = await prisma.$transaction(async (tx) => {
    const shouldDecrementStockNow = pay === 'CASH';

    if (shouldDecrementStockNow) {
      // Baixa estoque segura (impede ir abaixo de zero)
      for (const it of finalItems) {
        const updated = await tx.product.updateMany({
          where: {
            id: it.productId,
            merchantId: Number(merchantId),
            active: true,
            stock: { gte: it.quantity },
          },
          data: { stock: { decrement: it.quantity } },
        });

        if (updated.count === 0) {
          throw new Error(`Insufficient stock for productId=${it.productId}`);
        }
      }
    } else {
      // Mesmo sem reservar estoque, validamos no momento da criação.
      for (const it of finalItems) {
        const p = byId.get(it.productId);
        if (!p) continue;
        if (Number(p.stock) < Number(it.quantity)) {
          throw new Error(`Insufficient stock for productId=${it.productId}`);
        }
      }
    }

    // ✅ Cria venda já como PAID para aparecer no relatório do painel web
    const created = await tx.sale.create({
      data: {
        totalAmount,
        paymentType: pay,
        status: pay === 'CASH' ? 'PAID' : 'PENDING',
        merchantId: Number(merchantId),
        terminalId: terminalId ? Number(terminalId) : null,
        items: {
          create: finalItems.map((it) => {
            const p = byId.get(it.productId);
            return {
              productId: it.productId,
              quantity: it.quantity,
              unitPrice: Number(p.price),
            };
          }),
        },
      },
      include: { items: true },
    });

    return created;
  });

  // PrintJob é criado após a venda PAID (não bloqueia venda se der erro).
  if (sale?.status === 'PAID') {
    try {
      const job = await printJobsService.createPrintJobForSale({
        merchantId: Number(merchantId),
        saleId: sale.id,
        intentId: null,
        operatorName: operatorName || null,
        provider: 'MOCK',
        copies: 1,
      });
      return { ...sale, printJobId: job?.id || null };
    } catch {
      return { ...sale, printJobId: null };
    }
  }

  return { ...sale, printJobId: null };
}

async function updateSaleStatus({ merchantId, id, status }) {
  if (!merchantId) throw new Error('merchantId is required');
  const saleId = Number(id);
  if (!saleId) throw new Error('Invalid sale id');

  const nextStatus = normalizeStatus(status);
  if (!ALLOWED_STATUS.has(nextStatus)) {
    throw new Error(`Invalid status. Allowed: ${Array.from(ALLOWED_STATUS).join(', ')}`);
  }

  const updatedSale = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: saleId, merchantId: Number(merchantId) },
      include: { items: true },
    });

    if (!sale) throw new Error('Sale not found for this merchant');

    // idempotente
    if (sale.status === nextStatus) return sale;

    // regra simples: só muda se está PENDING
    if (sale.status !== 'PENDING') {
      throw new Error(`Cannot change status from ${sale.status} to ${nextStatus}`);
    }

    if (nextStatus !== 'PAID' && nextStatus !== 'DECLINED' && nextStatus !== 'CANCELLED' && nextStatus !== 'CANCELED') {
      throw new Error('From PENDING you can only go to PAID, DECLINED or CANCELLED/CANCELED');
    }

    // Confirmar manualmente (PENDING -> PAID) deve baixar estoque aqui.
    if (nextStatus === 'PAID') {
      for (const it of sale.items) {
        const updated = await tx.product.updateMany({
          where: {
            id: it.productId,
            merchantId: Number(merchantId),
            active: true,
            stock: { gte: it.quantity },
          },
          data: { stock: { decrement: it.quantity } },
        });

        if (updated.count === 0) {
          throw new Error(`Insufficient stock for productId=${it.productId}`);
        }
      }
    }

    // Cancelar uma venda PENDING não devolve estoque, pois ele ainda não foi baixado.
    if (nextStatus === 'DECLINED' || nextStatus === 'CANCELLED' || nextStatus === 'CANCELED') {
      // noop
    }

    return tx.sale.update({
      where: { id: saleId },
      data: { status: nextStatus },
      include: { items: true },
    });
  });

  if (updatedSale?.status === 'PAID') {
    try {
      const job = await printJobsService.createPrintJobForSale({
        merchantId: Number(merchantId),
        saleId: updatedSale.id,
        intentId: null,
        operatorName: null,
        provider: 'MOCK',
        copies: 1,
      });
      return { ...updatedSale, printJobId: job?.id || null };
    } catch {
      return { ...updatedSale, printJobId: null };
    }
  }

  return { ...updatedSale, printJobId: null };
}

module.exports = { createSale, updateSaleStatus };
