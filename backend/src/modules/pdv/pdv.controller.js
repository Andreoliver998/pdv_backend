// backend/src/modules/pdv/pdv.controller.js
const pdvService = require('./pdv.service');

const ALLOWED_PAYMENT_TYPES = ['CREDIT', 'DEBIT', 'PIX', 'CASH'];

function normalizePaymentType(paymentType) {
  return String(paymentType || '').toUpperCase().trim();
}

async function listProducts(req, res, next) {
  try {
    const merchantId = req.terminal?.merchantId;
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated terminal' });
    }

    const products = await pdvService.listProductsForPdv({ merchantId });
    return res.json(products);
  } catch (err) {
    return next(err);
  }
}

async function createSale(req, res, next) {
  try {
    const terminal = req.terminal;

    if (!terminal?.merchantId || !terminal?.id) {
      return res.status(401).json({ message: 'Unauthenticated terminal' });
    }

    const { items, paymentType } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items is required (array)' });
    }

    const pt = normalizePaymentType(paymentType);
    if (!pt) {
      return res.status(400).json({ message: 'paymentType is required' });
    }

    if (!ALLOWED_PAYMENT_TYPES.includes(pt)) {
      return res.status(400).json({
        message: `Invalid paymentType. Use: ${ALLOWED_PAYMENT_TYPES.join(', ')}`,
      });
    }

    // ✅ CASH não exige cashReceived (e nem processamos isso aqui)
    const sale = await pdvService.createSaleForPdv({
      merchantId: terminal.merchantId,
      terminalId: terminal.id,
      paymentType: pt,
      items,
      cashReceived: null, // força nulo para manter o comportamento desejado
    });

    return res.status(201).json(sale);
  } catch (err) {
    return next(err);
  }
}

module.exports = { listProducts, createSale };