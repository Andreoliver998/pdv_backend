const prisma = require('../../config/prisma');

function decimalToCents(value) {
  const s = String(value ?? '0').trim().replace(',', '.');
  const [intPartRaw, decPartRaw = ''] = s.split('.');
  const intPart = parseInt(intPartRaw || '0', 10);
  const decPart = (decPartRaw + '00').slice(0, 2);
  const dec = parseInt(decPart, 10);
  return intPart * 100 + dec;
}

function normalizeStatus(v) {
  return String(v || '').trim().toUpperCase();
}

function pickReceiptFooter(settings) {
  const footer = String(settings?.receiptFooter || '').trim();
  return footer || 'Obrigado pela preferência!';
}

async function buildReceiptPayload({ merchantId, saleId, operatorName }) {
  const [merchant, settings, sale] = await Promise.all([
    prisma.merchant.findUnique({ where: { id: Number(merchantId) }, select: { id: true, name: true, cnpj: true } }),
    prisma.merchantSettings.findUnique({
      where: { merchantId: Number(merchantId) },
      select: { tradeName: true, phone: true, address: true, receiptFooter: true },
    }),
    prisma.sale.findFirst({
      where: { id: Number(saleId), merchantId: Number(merchantId) },
      include: { items: true },
    }),
  ]);

  if (!merchant) {
    const err = new Error('Merchant not found');
    err.statusCode = 404;
    throw err;
  }
  if (!sale) {
    const err = new Error('Sale not found');
    err.statusCode = 404;
    throw err;
  }

  const productIds = Array.from(new Set((sale.items || []).map((it) => Number(it.productId)).filter(Boolean)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, merchantId: Number(merchantId) },
    select: { id: true, name: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const items = (sale.items || []).map((it) => {
    const unitCents = decimalToCents(it.unitPrice?.toString?.() ?? String(it.unitPrice));
    const qty = Number(it.quantity || 0);
    const totalCents = unitCents * qty;
    return {
      name: byId.get(Number(it.productId))?.name || `#${Number(it.productId)}`,
      qty,
      unitPrice: unitCents,
      total: totalCents,
      productId: Number(it.productId),
    };
  });

  const subtotal = items.reduce((sum, it) => sum + Number(it.total || 0), 0);
  const total = subtotal;

  return {
    merchant: {
      name: settings?.tradeName || merchant.name,
      document: merchant.cnpj || null,
      address: settings?.address || null,
      phone: settings?.phone || null,
    },
    sale: {
      id: sale.id,
      createdAt: sale.createdAt?.toISOString?.() || new Date(sale.createdAt).toISOString(),
      operator: operatorName || null,
    },
    payment: {
      method: sale.paymentType,
      amount: decimalToCents(sale.totalAmount?.toString?.() ?? String(sale.totalAmount)),
      currency: 'BRL',
    },
    items: items.map(({ name, qty, unitPrice, total }) => ({ name, qty, unitPrice, total })),
    totals: { subtotal, discount: 0, total },
    footer: pickReceiptFooter(settings),
  };
}

async function createPrintJobForSale({ merchantId, saleId, intentId, operatorName, provider = 'MOCK', copies = 1 }) {
  const mId = Number(merchantId);
  const sId = Number(saleId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!sId) {
    const err = new Error('saleId is required');
    err.statusCode = 400;
    throw err;
  }

  const existing = await prisma.printJob.findFirst({
    where: { merchantId: mId, saleId: sId },
    select: { id: true, status: true, provider: true, copies: true, printedAt: true, createdAt: true, updatedAt: true },
  });
  if (existing) return existing;

  const payload = await buildReceiptPayload({ merchantId: mId, saleId: sId, operatorName });

  try {
    return await prisma.printJob.create({
      data: {
        merchantId: mId,
        saleId: sId,
        intentId: intentId ? Number(intentId) : null,
        status: 'PENDING',
        provider: String(provider || 'MOCK'),
        copies: Number.isFinite(Number(copies)) && Number(copies) > 0 ? Number(copies) : 1,
        payload,
      },
      select: { id: true, status: true, provider: true, copies: true, printedAt: true, createdAt: true, updatedAt: true },
    });
  } catch (err) {
    // Idempotência por unique(saleId)
    if (err?.code === 'P2002') {
      const again = await prisma.printJob.findFirst({
        where: { merchantId: mId, saleId: sId },
        select: { id: true, status: true, provider: true, copies: true, printedAt: true, createdAt: true, updatedAt: true },
      });
      if (again) return again;
    }
    throw err;
  }
}

async function getNextPrintJob({ merchantId, terminalId }) {
  const mId = Number(merchantId);
  const tId = terminalId == null ? null : Number(terminalId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT "id"
      FROM "PrintJob"
      WHERE "merchantId" = ${mId} AND "status" = 'PENDING'
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const id = rows?.[0]?.id ? Number(rows[0].id) : null;
    if (!id) return null;

    const updated = await tx.printJob.update({
      where: { id },
      data: { status: 'PRINTING', terminalId: tId || undefined },
      select: { id: true, status: true, provider: true, copies: true, payload: true, createdAt: true, terminalId: true },
    });

    return updated;
  });
}

async function getPrintJob({ merchantId, id }) {
  const mId = Number(merchantId);
  const jobId = Number(id);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!jobId) {
    const err = new Error('Invalid print job id');
    err.statusCode = 400;
    throw err;
  }

  const job = await prisma.printJob.findFirst({
    where: { id: jobId, merchantId: mId },
    select: {
      id: true,
      status: true,
      provider: true,
      copies: true,
      payload: true,
      errorMessage: true,
      printedAt: true,
      createdAt: true,
      updatedAt: true,
      saleId: true,
      intentId: true,
    },
  });

  if (!job) {
    const err = new Error('PrintJob not found');
    err.statusCode = 404;
    throw err;
  }

  return job;
}

async function markPrintJobPrinted({ merchantId, id, terminalId, allowMismatchInDev = false }) {
  const mId = Number(merchantId);
  const jobId = Number(id);
  const tId = terminalId == null ? null : Number(terminalId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!jobId) {
    const err = new Error('Invalid print job id');
    err.statusCode = 400;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrintJob" WHERE id = ${jobId} AND "merchantId" = ${mId} FOR UPDATE`;

    const job = await tx.printJob.findFirst({
      where: { id: jobId, merchantId: mId },
      select: { id: true, status: true, provider: true, copies: true, payload: true, errorMessage: true, printedAt: true, createdAt: true, updatedAt: true, saleId: true, intentId: true, terminalId: true },
    });
    if (!job) {
      const err = new Error('PrintJob not found');
      err.statusCode = 404;
      throw err;
    }

    if (job.status === 'PRINTED') return job;
    if (job.status === 'CANCELED') {
      const err = new Error('PrintJob canceled');
      err.statusCode = 409;
      throw err;
    }

    if (job.terminalId && tId && Number(job.terminalId) !== tId && !allowMismatchInDev) {
      const err = new Error('PrintJob locked to another terminal');
      err.statusCode = 409;
      throw err;
    }

    return tx.printJob.update({
      where: { id: job.id },
      data: {
        status: 'PRINTED',
        printedAt: new Date(),
        errorMessage: null,
        terminalId: job.terminalId || tId || undefined,
      },
      select: { id: true, status: true, provider: true, copies: true, payload: true, errorMessage: true, printedAt: true, createdAt: true, updatedAt: true, saleId: true, intentId: true, terminalId: true },
    });
  });
}

async function markPrintJobError({ merchantId, id, errorMessage, terminalId, allowMismatchInDev = false }) {
  const mId = Number(merchantId);
  const jobId = Number(id);
  const tId = terminalId == null ? null : Number(terminalId);
  if (!mId) {
    const err = new Error('merchantId is required');
    err.statusCode = 400;
    throw err;
  }
  if (!jobId) {
    const err = new Error('Invalid print job id');
    err.statusCode = 400;
    throw err;
  }

  const msg = String(errorMessage || '').trim();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PrintJob" WHERE id = ${jobId} AND "merchantId" = ${mId} FOR UPDATE`;

    const job = await tx.printJob.findFirst({
      where: { id: jobId, merchantId: mId },
      select: { id: true, status: true, provider: true, copies: true, payload: true, errorMessage: true, printedAt: true, createdAt: true, updatedAt: true, saleId: true, intentId: true, terminalId: true },
    });
    if (!job) {
      const err = new Error('PrintJob not found');
      err.statusCode = 404;
      throw err;
    }

    if (job.status === 'PRINTED') return job;
    if (job.status === 'CANCELED') return job;

    if (job.terminalId && tId && Number(job.terminalId) !== tId && !allowMismatchInDev) {
      const err = new Error('PrintJob locked to another terminal');
      err.statusCode = 409;
      throw err;
    }

    return tx.printJob.update({
      where: { id: job.id },
      data: {
        status: 'ERROR',
        errorMessage: msg || 'Print error',
        terminalId: job.terminalId || tId || undefined,
      },
      select: { id: true, status: true, provider: true, copies: true, payload: true, errorMessage: true, printedAt: true, createdAt: true, updatedAt: true, saleId: true, intentId: true, terminalId: true },
    });
  });
}

module.exports = {
  buildReceiptPayload,
  createPrintJobForSale,
  getNextPrintJob,
  getPrintJob,
  markPrintJobPrinted,
  markPrintJobError,
};
