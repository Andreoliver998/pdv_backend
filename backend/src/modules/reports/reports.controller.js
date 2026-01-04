// backend/src/modules/reports/reports.controller.js
const reportsService = require('./reports.service');

function getMerchantId(req) {
  const mid = req?.user?.merchantId;
  if (!mid) {
    const err = new Error('Unauthenticated');
    err.statusCode = 401;
    throw err;
  }
  return Number(mid);
}

function parseRange(req) {
  // recebe YYYY-MM-DD
  const { from, to } = req.query;

  // Se não vier nada: hoje
  const now = new Date();

  const start = from ? new Date(`${from}T00:00:00.000`) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end   = to   ? new Date(`${to}T23:59:59.999`)   : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    const err = new Error('Invalid date range. Use from/to in YYYY-MM-DD');
    err.statusCode = 400;
    throw err;
  }

  return { start, end };
}

async function summary(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    const { start, end } = parseRange(req);

    const data = await reportsService.getSummary({ merchantId, start, end });
    return res.json(data);
  } catch (e) {
    return next(e);
  }
}

async function listSales(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    const { start, end } = parseRange(req);

    const data = await reportsService.listSales({ merchantId, start, end });
    return res.json(data);
  } catch (e) {
    return next(e);
  }
}

async function topProducts(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    const { start, end } = parseRange(req);

    const data = await reportsService.topProducts({ merchantId, start, end });
    return res.json(data);
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  summary,
  listSales,
  topProducts,
};