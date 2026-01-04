// backend/src/modules/product/product.controller.js
const productService = require('./product.service');

function requireAuth(req, res) {
  if (!req.user || !req.user.merchantId) {
    res.status(401).json({ message: 'Unauthenticated' });
    return false;
  }
  return true;
}

function parseBoolean(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;

  const s = String(v).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;

  return undefined;
}

function normalizeNullableString(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * =====================================================
 *  IMAGE URL (ABSOLUTA PARA ANDROID/GLIDE)
 * =====================================================
 * - Se vier null/undefined, mantém.
 * - Se já vier http/https, mantém.
 * - Se vier "/uploads/...", converte para "http(s)://host/uploads/..."
 */
function toAbsoluteImageUrl(req, imageUrl) {
  if (imageUrl === undefined) return undefined;
  if (imageUrl === null) return null;

  const url = String(imageUrl).trim();
  if (!url) return null;

  if (/^https?:\/\//i.test(url)) return url;

  const path = url.startsWith('/') ? url : `/${url}`;

  // respeita proxy no futuro (sem quebrar DEV)
  const forwardedProto = (req.headers['x-forwarded-proto'] || '')
    .toString()
    .split(',')[0]
    .trim();

  const proto = forwardedProto || req.protocol;
  const host = req.get('host'); // ex: 192.168.1.103:3333

  return `${proto}://${host}${path}`;
}

function toPublicProduct(req, product) {
  if (!product) return product;
  return {
    ...product,
    imageUrl: toAbsoluteImageUrl(req, product.imageUrl),
  };
}

async function list(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const products = await productService.listProducts(req.user.merchantId);
    return res.json(products.map((p) => toPublicProduct(req, p)));
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const body = req.body || {};
    const { name, price } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'name is required (string)' });
    }
    if (price === undefined || price === null || Number.isNaN(Number(price))) {
      return res.status(400).json({ message: 'price is required (number)' });
    }

    const payload = {
      ...body,
      category: normalizeNullableString(body.category),
      imageUrl: normalizeNullableString(body.imageUrl),
      active: body.active !== undefined ? parseBoolean(body.active) : undefined,
    };

    if (body.active !== undefined && payload.active === undefined) {
      return res.status(400).json({ message: 'active must be boolean (true/false)' });
    }

    const product = await productService.createProduct(req.user.merchantId, payload);
    return res.status(201).json(toPublicProduct(req, product));
  } catch (err) {
    return next(err);
  }
}

async function bulkCreate(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    if (!Array.isArray(req.body) || req.body.length === 0) {
      return res.status(400).json({ message: 'Body must be a non-empty array of products' });
    }

    const normalized = req.body.map((p, i) => {
      if (!p?.name || typeof p.name !== 'string' || !p.name.trim()) {
        const err = new Error(`items[${i}].name is required (string)`);
        err.statusCode = 400;
        throw err;
      }
      if (p.price === undefined || p.price === null || Number.isNaN(Number(p.price))) {
        const err = new Error(`items[${i}].price is required (number)`);
        err.statusCode = 400;
        throw err;
      }
      if (p.stock !== undefined && p.stock !== null && Number.isNaN(Number(p.stock))) {
        const err = new Error(`items[${i}].stock must be a number`);
        err.statusCode = 400;
        throw err;
      }

      const act = parseBoolean(p.active);
      if (p.active !== undefined && act === undefined) {
        const err = new Error(`items[${i}].active must be boolean (true/false)`);
        err.statusCode = 400;
        throw err;
      }

      return {
        ...p,
        name: String(p.name).trim(),
        category: normalizeNullableString(p.category),
        imageUrl: normalizeNullableString(p.imageUrl),
        active: act ?? (p.active === undefined ? undefined : act),
      };
    });

    const created = await productService.bulkCreateProducts(req.user.merchantId, normalized);
    return res.status(201).json(created.map((p) => toPublicProduct(req, p)));
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const body = req.body || {};
    const { name, price, stock, active } = body;

    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ message: 'name must be a non-empty string' });
    }
    if (price !== undefined && (price === null || Number.isNaN(Number(price)))) {
      return res.status(400).json({ message: 'price must be number' });
    }
    if (stock !== undefined && (stock === null || Number.isNaN(Number(stock)))) {
      return res.status(400).json({ message: 'stock must be number' });
    }

    let parsedActive = undefined;
    if (active !== undefined) {
      parsedActive = parseBoolean(active);
      if (parsedActive === undefined) {
        return res.status(400).json({ message: 'active must be boolean (true/false)' });
      }
    }

    const payload = {
      ...body,
      category: normalizeNullableString(body.category),
      imageUrl: normalizeNullableString(body.imageUrl),
      active: parsedActive,
    };

    const updated = await productService.updateProduct(req.user.merchantId, productId, payload);
    return res.json(toPublicProduct(req, updated));
  } catch (err) {
    return next(err);
  }
}

async function archive(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const productId = Number(req.params.id);
    if (!Number.isFinite(productId) || productId <= 0) {
      return res.status(400).json({ message: 'Invalid product id' });
    }

    const updated = await productService.archiveProduct(req.user.merchantId, productId);
    return res.json(toPublicProduct(req, updated));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  list,
  create,
  bulkCreate,
  update,
  archive,
};