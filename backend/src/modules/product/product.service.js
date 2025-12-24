// backend/src/modules/product/product.service.js
const prisma = require('../../config/prisma');

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function toNumberOrUndefined(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

function toTrimmedStringOrUndefined(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

function normalizeNullableString(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normalizeBooleanOrUndefined(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

async function listProducts(merchantId) {
  return prisma.product.findMany({
    where: { merchantId: Number(merchantId) },
    orderBy: { name: 'asc' },
  });
}

async function createProduct(
  merchantId,
  { name, price, category, imageUrl, active, stock }
) {
  const parsedPrice = toNumberOrUndefined(price);
  if (parsedPrice === undefined) throw badRequest('price is required (number)');

  const parsedStock = toNumberOrUndefined(stock);
  const parsedActive = normalizeBooleanOrUndefined(active);

  const safeName = toTrimmedStringOrUndefined(name);
  if (!safeName) throw badRequest('name is required (string)');

  return prisma.product.create({
    data: {
      name: safeName,
      price: Number(parsedPrice),
      category: normalizeNullableString(category),
      imageUrl: normalizeNullableString(imageUrl),
      active: parsedActive !== undefined ? parsedActive : true,
      stock: parsedStock !== undefined ? parsedStock : 0,
      merchantId: Number(merchantId),
    },
  });
}

async function bulkCreateProducts(merchantId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('Body must be a non-empty array of products');
  }

  const data = items.map((p, i) => {
    const safeName = toTrimmedStringOrUndefined(p?.name);
    const parsedPrice = toNumberOrUndefined(p?.price);

    if (!safeName) throw badRequest(`items[${i}].name is required (string)`);
    if (parsedPrice === undefined) throw badRequest(`items[${i}].price is required (number)`);

    const parsedStock = toNumberOrUndefined(p?.stock);
    if (p?.stock !== undefined && parsedStock === undefined) {
      throw badRequest(`items[${i}].stock must be a number`);
    }

    const act = normalizeBooleanOrUndefined(p?.active);
    if (p?.active !== undefined && act === undefined) {
      throw badRequest(`items[${i}].active must be boolean (true/false)`);
    }

    return {
      name: safeName,
      price: Number(parsedPrice),
      category: normalizeNullableString(p?.category),
      imageUrl: normalizeNullableString(p?.imageUrl),
      active: act ?? true,
      stock: parsedStock ?? 0,
      merchantId: Number(merchantId),
    };
  });

  const created = await prisma.$transaction(
    data.map((d) => prisma.product.create({ data: d }))
  );

  return created;
}

async function updateProduct(
  merchantId,
  productId,
  { name, price, category, imageUrl, active, stock }
) {
  const existing = await prisma.product.findFirst({
    where: { id: Number(productId), merchantId: Number(merchantId) },
    select: { id: true },
  });

  if (!existing) {
    const err = new Error('Produto não encontrado para este merchant.');
    err.statusCode = 404;
    throw err;
  }

  const data = {};

  const safeName = toTrimmedStringOrUndefined(name);
  if (name !== undefined) {
    if (!safeName) throw badRequest('name must be a non-empty string');
    data.name = safeName;
  }

  const parsedPrice = toNumberOrUndefined(price);
  if (price !== undefined) {
    if (parsedPrice === undefined) throw badRequest('price must be number');
    data.price = Number(parsedPrice);
  }

  const parsedStock = toNumberOrUndefined(stock);
  if (stock !== undefined) {
    if (parsedStock === undefined) throw badRequest('stock must be number');
    data.stock = Number(parsedStock);
  }

  if (category !== undefined) {
    data.category = normalizeNullableString(category);
  }

  if (imageUrl !== undefined) {
    data.imageUrl = normalizeNullableString(imageUrl);
  }

  if (active !== undefined) {
    const parsedActive = normalizeBooleanOrUndefined(active);
    if (parsedActive === undefined) throw badRequest('active must be boolean (true/false)');
    data.active = parsedActive;
  }

  return prisma.product.update({
    where: { id: Number(productId) },
    data,
  });
}

async function archiveProduct(merchantId, productId) {
  const existing = await prisma.product.findFirst({
    where: { id: Number(productId), merchantId: Number(merchantId) },
    select: { id: true },
  });

  if (!existing) {
    const err = new Error('Produto não encontrado para este merchant.');
    err.statusCode = 404;
    throw err;
  }

  return prisma.product.update({
    where: { id: Number(productId) },
    data: { active: false },
  });
}

module.exports = {
  listProducts,
  createProduct,
  bulkCreateProducts,
  updateProduct,
  archiveProduct,
};