const service = require('./printJobs.service');

function getMerchantId(req) {
  return req.user?.merchantId || req.merchant?.id || null;
}

function isDev() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'development';
}

async function getNext(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const job = await service.getNextPrintJob({
      merchantId,
      terminalId: req.terminal?.id || null,
      deviceId: req.body?.deviceId || req.query?.deviceId || null,
    });

    return res.json({ ok: true, job });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const job = await service.getPrintJob({
      merchantId,
      id: req.params.id,
    });

    return res.json({ ok: true, job });
  } catch (err) {
    return next(err);
  }
}

async function markPrinted(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const job = await service.markPrintJobPrinted({
      merchantId,
      id: req.params.id,
      terminalId: req.terminal?.id || null,
      allowMismatchInDev: isDev(),
    });

    return res.json({ ok: true, job });
  } catch (err) {
    return next(err);
  }
}

async function markError(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const job = await service.markPrintJobError({
      merchantId,
      id: req.params.id,
      errorMessage: req.body?.errorMessage || null,
      terminalId: req.terminal?.id || null,
      allowMismatchInDev: isDev(),
    });

    return res.json({ ok: true, job });
  } catch (err) {
    return next(err);
  }
}

async function mockPrinted(req, res, next) {
  try {
    if (!isDev()) return res.status(404).json({ message: 'Not found' });
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const job = await service.markPrintJobPrinted({
      merchantId,
      id: req.params.id,
      isMock: true,
    });

    return res.json({ ok: true, job });
  } catch (err) {
    return next(err);
  }
}

async function mockError(req, res, next) {
  try {
    if (!isDev()) return res.status(404).json({ message: 'Not found' });
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const job = await service.markPrintJobError({
      merchantId,
      id: req.params.id,
      errorMessage: req.body?.errorMessage || 'Mock print error',
      isMock: true,
    });

    return res.json({ ok: true, job });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getNext,
  getById,
  markPrinted,
  markError,
  mockPrinted,
  mockError,
};
