// backend/src/modules/sale/sale.controller.js
const saleService = require('./sale.service');

function getMerchantId(req) {
  return (
    req.user?.merchantId ||
    req.terminal?.merchantId ||
    req.user?.merchant?.id || // fallback seguro
    null
  );
}


async function create(req, res) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const { items, paymentType } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items array is required' });
    }
    if (!paymentType) {
      return res.status(400).json({ message: 'paymentType is required' });
    }

    const sale = await saleService.createSale({
      merchantId,
      terminalId: req.terminal?.id || null,
      items,
      paymentType,
      operatorName: req.user?.name || null,
    });

    return res.status(201).json(sale);
  } catch (error) {
    const msg = error?.message || 'Error creating sale';
    const isBadRequest =
      msg.includes('required') ||
      msg.includes('Invalid') ||
      msg.includes('Insufficient') ||
      msg.includes('invalid');

    return res.status(isBadRequest ? 400 : 500).json({ message: msg });
  }
}

async function updateStatus(req, res) {
  try {
    // ✅ recomendado: somente painel web
    if (!req.user?.merchantId) {
      return res.status(401).json({ message: 'Unauthenticated (user required)' });
    }

    const { id } = req.params;
    const { status } = req.body;

    const sale = await saleService.updateSaleStatus({
      merchantId: req.user.merchantId,
      id,
      status,
    });

    return res.json(sale);
  } catch (error) {
    const msg = error?.message || 'Error updating sale status';
    return res.status(400).json({ message: msg });
  }
}

module.exports = { create, updateStatus };
