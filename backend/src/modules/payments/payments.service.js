const prisma = require('../../config/prisma');

const PAYMENTS = new Set(['CREDIT', 'DEBIT', 'PIX', 'CASH']);
const INTENT_STATUS = new Set(['PENDING', 'APPROVED', 'DECLINED', 'CANCELED', 'ERROR', 'EXPIRED']);

function normalizePaymentType(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'CRÉDITO' || t === 'CREDITO') return 'CREDIT';
  if (t === 'DÉBITO' || t === 'DEBITO') return 'DEBIT';
  if (t === 'DINHEIRO') return 'CASH';
  return t;
}

function decimalToCents(value) {
  const s = String(value ?? '0').trim().replace(',', '.');
  const [intPartRaw, decPartRaw = ''] = s.split('.');
  const intPart = parseInt(intPartRaw || '0', 10);
  const decPart = (decPartRaw + '00').slice(0, 2);
  const dec = parseInt(decPart, 10);
  return intPart * 100 + dec;
}

function centsToDecimalNumber(cents) {
  return Number((Number(cents || 0) / 100).toFixed(2));
}

function decimalToNumber2(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? 0));
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function normalizeIntentStatus(v) {
  return String(v || '').trim().toUpperCase();
}

function sanitizeProviderData(input) {
  const raw = input && typeof input === 'object' ? input : null;
  if (!raw) return null;

  const pick = (key) => {
    const v = raw[key];
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return null;
  };

  // Whitelist estrita: nunca persistir payloads completos retornados por SDK/app.
  return {
    status: pick('status') || pick('paymentStatus') || pick('result') || null,
    amount: pick('amount') || null,
    paymentType: pick('paymentType') || pick('payment_type') || null,
    authorizationCode:
      pick('authorizationCode') || pick('authorization_code') || pick('authCode') || pick('auth_code') || null,
    transactionId: pick('transactionId') || pick('transaction_id') || pick('tid') || pick('nsu') || null,
    orderId: pick('orderId') || pick('order_id') || null,
  };
}

function extractAuthorizationCode(data) {
  const d = data && typeof data === 'object' ? data : null;
  if (!d) return null;
  const v = d.authorizationCode || d.authorization_code || d.authCode || d.auth_code || null;
  const s = String(v || '').trim();
  return s || null;
}

function extractTransactionId(data, providerRef) {
  const d = data && typeof data === 'object' ? data : null;
  const candidates = [
    d?.transactionId,
    d?.transaction_id,
    d?.tid,
    d?.nsu,
    providerRef,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s) return s;
  }
  return null;
}

function toNumber2(v) {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function mapSaleForJson(sale) {
  if (!sale) return sale;
  return {
    ...sale,
    totalAmount: toNumber2(sale.totalAmount),
    cashReceived: sale.cashReceived == null ? null : toNumber2(sale.cashReceived),
    changeGiven: sale.changeGiven == null ? null : toNumber2(sale.changeGiven),
    items: (sale.items || []).map((it) => ({
      ...it,
      unitPrice: toNumber2(it.unitPrice),
      quantity: Number(it.quantity || 0),
    })),
  };
}

function mapIntentForJson(intent) {
  if (!intent) return intent;
  // Năo expor snapshot interno do carrinho nem chaves de idempotęncia/metadata por padrăo
  // (mantemos apenas dados mínimos de status/valor para polling).
  const { saleDraft, idempotencyKey, metadata, ...safe } = intent;
  return {
    ...safe,
    amountCents: Number(intent.amountCents || 0),
    amount: centsToDecimalNumber(intent.amountCents || 0),
    sale: mapSaleForJson(intent.sale),
    transactions: (intent.transactions || []).map((t) => ({
      ...t,
    })),
  };
}

async function createPaymentIntent({ merchantId, terminalId, items, paymentType, idempotencyKey, metadata, clientAmountCents }) {
  const mId = Number(merchantId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }

  const pay = normalizePaymentType(paymentType);
  if (!PAYMENTS.has(pay)) {
    const err = new Error(`Invalid paymentType. Allowed: ${Array.from(PAYMENTS).join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  if (pay === 'CASH') {
    const err = new Error('Use /api/sales for CASH payments (immediate)');
    err.statusCode = 400;
    throw err;
  }

  const idemKey = idempotencyKey == null ? null : String(idempotencyKey).trim();
  if (idemKey) {
    const existing = await prisma.paymentIntent.findFirst({
      where: { merchantId: mId, idempotencyKey: idemKey },
      include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (existing) return mapIntentForJson(existing);
  }

  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Items array is required');
    err.statusCode = 400;
    throw err;
  }

  const normalized = items.map((i) => ({
    productId: Number(i.productId),
    quantity: Number(i.quantity),
  }));

  if (normalized.some((i) => !i.productId || !Number.isInteger(i.quantity) || i.quantity <= 0)) {
    const err = new Error('Invalid items payload');
    err.statusCode = 400;
    throw err;
  }

  const grouped = new Map();
  for (const it of normalized) {
    grouped.set(it.productId, (grouped.get(it.productId) || 0) + it.quantity);
  }
  const finalItems = Array.from(grouped.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));

  const productIds = finalItems.map((i) => i.productId);

  try {
    return await prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({
      where: {
        id: { in: productIds },
        merchantId: mId,
        active: true,
      },
      select: { id: true, name: true, price: true, stock: true },
    });

    if (products.length !== productIds.length) {
      const err = new Error('One or more products are invalid for this merchant');
      err.statusCode = 400;
      throw err;
    }

    const byId = new Map(products.map((p) => [p.id, p]));

    for (const it of finalItems) {
      const p = byId.get(it.productId);
      if (!p) continue;
      if (Number(p.stock) < Number(it.quantity)) {
        const err = new Error(`Insufficient stock for "${p.name}"`);
        err.statusCode = 409;
        throw err;
      }
    }

    const draftItems = finalItems.map((it) => {
      const p = byId.get(it.productId);
      const unitPriceCents = decimalToCents(p.price?.toString?.() ?? String(p.price));
      return {
        productId: it.productId,
        quantity: it.quantity,
        unitPriceCents,
      };
    });

    let amountCents = 0;
    for (const it of draftItems) {
      amountCents += Number(it.unitPriceCents) * Number(it.quantity);
    }

    if (clientAmountCents != null) {
      const provided = Number(clientAmountCents);
      if (Number.isFinite(provided) && provided > 0 && provided !== amountCents) {
        const err = new Error('amount does not match server-calculated total');
        err.statusCode = 400;
        throw err;
      }
    }

    const intent = await tx.paymentIntent.create({
      data: {
        merchantId: mId,
        terminalId: terminalId ? Number(terminalId) : null,
        status: 'PENDING',
        paymentType: pay,
        amountCents,
        currency: 'BRL',
        provider: 'MOCK',
        idempotencyKey: idemKey,
        metadata: metadata ?? undefined,
        saleDraft: {
          items: draftItems,
          amountCents,
          currency: 'BRL',
        },
      },
      include: { sale: true, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });

      return mapIntentForJson(intent);
    });
  } catch (err) {
    // Idempotency: se bateu no unique (merchantId,idempotencyKey), devolve o existente.
    if (idemKey && err?.code === 'P2002') {
      const existing = await prisma.paymentIntent.findFirst({
        where: { merchantId: mId, idempotencyKey: idemKey },
        include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
      if (existing) return mapIntentForJson(existing);
    }
    throw err;
  }
}

async function getPaymentIntent({ merchantId, id }) {
  const mId = Number(merchantId);
  const intentId = Number(id);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!intentId) {
    const err = new Error('Invalid intent id');
    err.statusCode = 400;
    throw err;
  }

  const intent = await prisma.paymentIntent.findFirst({
    where: { id: intentId, merchantId: mId },
    select: {
      id: true,
      status: true,
      paymentType: true,
      amountCents: true,
      currency: true,
      provider: true,
      providerRef: true,
      createdAt: true,
      updatedAt: true,
      approvedAt: true,
      failedAt: true,
      merchantId: true,
      terminalId: true,
      saleId: true,
      sale: { include: { items: true } },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!intent) {
    const err = new Error('PaymentIntent not found');
    err.statusCode = 404;
    throw err;
  }

  return mapIntentForJson(intent);
}

async function confirmPaymentIntent({ merchantId, id, provider, providerRef, data, operatorName, terminalId }) {
  const mId = Number(merchantId);
  const intentId = Number(id);
  const tId = terminalId == null ? null : Number(terminalId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!intentId) {
    const err = new Error('Invalid intent id');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PaymentIntent" WHERE id = ${intentId} AND "merchantId" = ${mId} FOR UPDATE`;

    const intent = await tx.paymentIntent.findFirst({
      where: { id: intentId, merchantId: mId },
      include: {
        sale: { include: { items: true } },
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!intent) {
      const err = new Error('PaymentIntent not found');
      err.statusCode = 404;
      throw err;
    }

    // Se a requisi‡Æo veio de um terminal, nÆo permitir operar intents de outro terminal.
    if (tId && intent.terminalId && Number(intent.terminalId) !== tId) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }

    const safeProviderData = sanitizeProviderData(data);

    // Se a requisi‡Æo veio de um terminal, nÆo permitir operar intents de outro terminal.
    if (tId && intent.terminalId && Number(intent.terminalId) !== tId) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }

    const authorizationCode = extractAuthorizationCode(safeProviderData);
    const transactionId = extractTransactionId(safeProviderData, providerRef);

    // Se jÃ¡ aprovado, Ã© idempotente. Se nÃ£o tiver printJobId ainda, criamos.
    if (intent.status === 'APPROVED') {
      // Opcional: preencher metadados de autoriza‡Æo na venda, se ainda estiverem vazios.
      if (intent.saleId && (authorizationCode || transactionId)) {
        try {
          await tx.sale.update({
            where: { id: Number(intent.saleId) },
            data: {
              ...(authorizationCode ? { authorizationCode } : {}),
              ...(transactionId ? { transactionId } : {}),
              acquirer: String(provider || intent.provider || 'UNKNOWN'),
            },
            select: { id: true },
          });
        } catch {
          // NÆo bloqueia resposta idempotente
        }
      }

      if (intent.printJobId) return mapIntentForJson(intent);

      const saleId = intent.saleId || intent.sale?.id || null;
      if (!saleId) return mapIntentForJson(intent);

      const existingJob = await tx.printJob.findFirst({
        where: { merchantId: mId, saleId: Number(saleId) },
        select: { id: true },
      });

      const jobId = existingJob?.id || null;
      if (jobId) {
        const updatedIntent = await tx.paymentIntent.update({
          where: { id: intent.id },
          data: { printJobId: jobId, terminalId: tId || undefined },
          include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
        });
        return mapIntentForJson(updatedIntent);
      }

      // Se nÃ£o existe PrintJob por saleId (ou foi apagado), recria.
      const sale = intent.sale || (await tx.sale.findUnique({ where: { id: Number(saleId) }, include: { items: true } }));
      if (!sale) return mapIntentForJson(intent);

      const productIds = Array.from(new Set((sale.items || []).map((it) => Number(it.productId)).filter(Boolean)));
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, merchantId: mId },
        select: { id: true, name: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      const payload = {
        saleId: sale.id,
        intentId: intent.id,
        paymentType: intent.paymentType,
        totalAmount: decimalToNumber2(sale.totalAmount),
        items: (sale.items || []).map((it) => {
          const name = byId.get(Number(it.productId))?.name || `#${Number(it.productId)}`;
          const qty = Number(it.quantity || 0);
          const unitPrice = decimalToNumber2(it.unitPrice);
          return { name, qty, unitPrice, total: Number((unitPrice * qty).toFixed(2)) };
        }),
        createdAt: (sale.createdAt || new Date()).toISOString?.() || new Date(sale.createdAt).toISOString(),
      };

      const createdJob = await tx.printJob.create({
        data: {
          merchantId: mId,
          saleId: sale.id,
          intentId: intent.id,
          terminalId: tId || undefined,
          status: 'PENDING',
          provider: 'LOCAL',
          copies: 1,
          payload,
        },
        select: { id: true },
      });

      const updatedIntent = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { printJobId: createdJob.id, terminalId: tId || undefined },
        include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
      return mapIntentForJson(updatedIntent);
    }

    if (intent.status !== 'PENDING') {
      return {
        error: true,
        statusCode: 409,
        message: `Cannot confirm intent with status=${intent.status}`,
        intent: mapIntentForJson(intent),
      };
    }

    const draft = intent.saleDraft || null;
    const draftItems = Array.isArray(draft?.items) ? draft.items : null;
    if (!draftItems || draftItems.length === 0) {
      return {
        error: true,
        statusCode: 409,
        message: 'Intent has no saleDraft items',
        intent: mapIntentForJson(intent),
      };
    }

    // Baixa estoque segura (impede ir abaixo de zero)
    let insufficient = null;
    for (const it of draftItems) {
      const updated = await tx.product.updateMany({
        where: {
          id: Number(it.productId),
          merchantId: mId,
          active: true,
          stock: { gte: Number(it.quantity) },
        },
        data: { stock: { decrement: Number(it.quantity) } },
      });

      if (updated.count === 0) {
        const product = await tx.product.findFirst({
          where: { id: Number(it.productId), merchantId: mId },
          select: { name: true, stock: true },
        });
        insufficient = {
          productId: Number(it.productId),
          name: product?.name || `#${Number(it.productId)}`,
          stock: Number(product?.stock ?? 0),
          needed: Number(it.quantity || 0),
        };
        break;
      }
    }

    if (insufficient) {
      await tx.paymentTransaction.create({
        data: {
          intentId: intent.id,
          status: 'ERROR',
          provider: String(provider || intent.provider || 'UNKNOWN'),
          providerRef: providerRef ? String(providerRef) : null,
          data: { error: 'INSUFFICIENT_STOCK', insufficient, providerData: safeProviderData },
        },
      });

      const updated = await tx.paymentIntent.update({
        where: { id: intent.id },
        data: {
          status: 'ERROR',
          provider: String(provider || intent.provider || 'UNKNOWN'),
          providerRef: providerRef ? String(providerRef) : intent.providerRef,
          failedAt: new Date(),
        },
        include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });

      // fecha a venda (nÆo aparece em relat¢rio)
      return {
        error: true,
        statusCode: 409,
        message: `Insufficient stock for "${insufficient.name}"`,
        intent: mapIntentForJson(updated),
      };
    }

    const sale = await tx.sale.create({
      data: {
        merchantId: mId,
        terminalId: intent.terminalId ?? tId ?? null,
        paymentType: intent.paymentType,
        status: 'PAID',
        totalAmount: centsToDecimalNumber(intent.amountCents || 0),
        cashReceived: null,
        changeGiven: null,
        authorizationCode: authorizationCode || null,
        transactionId: transactionId || null,
        acquirer: String(provider || intent.provider || 'UNKNOWN'),
        items: {
          create: draftItems.map((it) => ({
            productId: Number(it.productId),
            quantity: Number(it.quantity),
            unitPrice: centsToDecimalNumber(Number(it.unitPriceCents ?? 0)),
          })),
        },
      },
      include: { items: true },
    });

    // Cria PrintJob dentro da mesma transaÃ§Ã£o, sem bloquear o pagamento.
    // Idempotente por unique(saleId): se jÃ¡ existir, reutiliza.
    let printJobId = null;
    try {
      const existing = await tx.printJob.findFirst({
        where: { merchantId: mId, saleId: sale.id },
        select: { id: true },
      });
      if (existing?.id) {
        printJobId = existing.id;
      } else {
        const productIds = Array.from(new Set((sale.items || []).map((it) => Number(it.productId)).filter(Boolean)));
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, merchantId: mId },
          select: { id: true, name: true },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        const payload = {
          saleId: sale.id,
          intentId: intent.id,
          paymentType: intent.paymentType,
          totalAmount: decimalToNumber2(sale.totalAmount),
          items: (sale.items || []).map((it) => {
            const name = byId.get(Number(it.productId))?.name || `#${Number(it.productId)}`;
            const qty = Number(it.quantity || 0);
            const unitPrice = decimalToNumber2(it.unitPrice);
            return { name, qty, unitPrice, total: Number((unitPrice * qty).toFixed(2)) };
          }),
          createdAt: (sale.createdAt || new Date()).toISOString?.() || new Date(sale.createdAt).toISOString(),
        };

        const job = await tx.printJob.create({
          data: {
            merchantId: mId,
            saleId: sale.id,
            intentId: intent.id,
            terminalId: tId || undefined,
            status: 'PENDING',
            provider: 'LOCAL',
            copies: 1,
            payload,
          },
          select: { id: true },
        });
        printJobId = job.id;
      }
    } catch {
      // NÃ£o quebra aprovaÃ§Ã£o
      printJobId = null;
    }

    await tx.paymentTransaction.create({
      data: {
        intentId: intent.id,
        status: 'APPROVED',
        provider: String(provider || intent.provider || 'UNKNOWN'),
        providerRef: providerRef ? String(providerRef) : null,
        data: safeProviderData,
      },
    });

    const updated = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'APPROVED',
        provider: String(provider || intent.provider || 'UNKNOWN'),
        providerRef: providerRef ? String(providerRef) : intent.providerRef,
        approvedAt: new Date(),
        saleId: sale.id,
        terminalId: tId || undefined,
        printJobId: printJobId || undefined,
      },
      include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });

    return mapIntentForJson(updated);
  });
}

async function failPaymentIntent({ merchantId, id, status, provider, providerRef, data, terminalId }) {
  const mId = Number(merchantId);
  const intentId = Number(id);
  const tId = terminalId == null ? null : Number(terminalId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!intentId) {
    const err = new Error('Invalid intent id');
    err.statusCode = 400;
    throw err;
  }

  const nextStatus = normalizeIntentStatus(status);
  if (!INTENT_STATUS.has(nextStatus) || nextStatus === 'APPROVED' || nextStatus === 'PENDING') {
    const err = new Error('Invalid status for fail. Use: DECLINED, CANCELED, ERROR, EXPIRED');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PaymentIntent" WHERE id = ${intentId} AND "merchantId" = ${mId} FOR UPDATE`;

    const intent = await tx.paymentIntent.findFirst({
      where: { id: intentId, merchantId: mId },
      include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });

    if (!intent) {
      const err = new Error('PaymentIntent not found');
      err.statusCode = 404;
      throw err;
    }

    if (intent.status === 'APPROVED') {
      const err = new Error('Cannot fail an APPROVED intent');
      err.statusCode = 409;
      throw err;
    }

    // idempotente
    if (intent.status !== 'PENDING') return mapIntentForJson(intent);

    await tx.paymentTransaction.create({
      data: {
        intentId: intent.id,
        status: nextStatus,
        provider: String(provider || intent.provider || 'UNKNOWN'),
        providerRef: providerRef ? String(providerRef) : null,
        data: safeProviderData,
      },
    });

    const updated = await tx.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: nextStatus,
        provider: String(provider || intent.provider || 'UNKNOWN'),
        providerRef: providerRef ? String(providerRef) : intent.providerRef,
        terminalId: tId || undefined,
        failedAt: new Date(),
      },
      include: { sale: { include: { items: true } }, transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });

    if (intent.sale?.id && intent.sale.status === 'PENDING') {
      await tx.sale.update({
        where: { id: intent.sale.id },
        data: { status: 'CANCELED' },
      });
    }

    return mapIntentForJson(updated);
  });
}

module.exports = {
  createPaymentIntent,
  getPaymentIntent,
  confirmPaymentIntent,
  failPaymentIntent,
};
