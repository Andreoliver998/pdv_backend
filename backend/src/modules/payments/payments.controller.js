const paymentsService = require('./payments.service');
const { writeAuditLog } = require('../../services/auditLog');

function getMerchantId(req) {
  return (
    req.user?.merchantId ||
    req.terminal?.merchantId ||
    req.user?.merchant?.id ||
    null
  );
}

function isProd() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function decimalToCents(value) {
  const s = String(value ?? '0').trim().replace(',', '.');
  const [intPartRaw, decPartRaw = ''] = s.split('.');
  const intPart = parseInt(intPartRaw || '0', 10);
  const decPart = (decPartRaw + '00').slice(0, 2);
  const dec = parseInt(decPart, 10);
  return intPart * 100 + dec;
}

function getReqMeta(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const userAgent = String(req.headers['user-agent'] || '').trim();
  return { ip: ip || null, userAgent: userAgent || null };
}

function sanitizePaymentData(input) {
  const raw = input && typeof input === 'object' ? input : null;
  if (!raw) return null;

  // Whitelist estrita: evita persistir qualquer dado sens�vel de cart�o por acidente.
  const pick = (key) => {
    const v = raw[key];
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return null;
  };

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

function normalizeCallbackStatus(statusRaw) {
  const s = String(statusRaw || '').trim().toUpperCase();
  if (!s) return null;

  if (s === 'APPROVED' || s === 'PAID' || s === 'SUCCESS' || s === 'OK') return 'APPROVED';
  if (s === 'DECLINED' || s === 'DENIED') return 'DECLINED';
  if (s === 'CANCELED' || s === 'CANCELLED' || s === 'CANCELADO') return 'CANCELED';
  if (s === 'ERROR' || s === 'FAILED' || s === 'FAIL') return 'ERROR';
  return s;
}

function parseCallbackIntentId(body) {
  const raw =
    body?.intentId ?? body?.paymentIntentId ?? body?.payment_intent_id ?? body?.orderId ?? body?.order_id ?? null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function createIntent(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const { items, method, paymentType, amount, idempotencyKey, metadata } = req.body || {};
    const terminalId = req.terminal?.id || null;

    const result = await paymentsService.createPaymentIntent({
      merchantId,
      terminalId,
      items,
      paymentType: method || paymentType,
      idempotencyKey,
      metadata,
      clientAmountCents: amount == null ? null : decimalToCents(amount),
    });

    return res.status(201).json({
      ...result,
      intentId: result?.id,
      pollingUrl: `/api/payments/intents/${result?.id}`,
    });
  } catch (err) {
    return next(err);
  }
}

async function getIntent(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const intent = await paymentsService.getPaymentIntent({
      merchantId,
      id: req.params.id,
    });

    return res.json(intent);
  } catch (err) {
    return next(err);
  }
}

async function confirmIntent(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const sanitizedData = sanitizePaymentData(req.body?.data ?? req.body ?? null);
    const result = await paymentsService.confirmPaymentIntent({
      merchantId,
      id: req.params.id,
      provider: String(req.body?.provider || 'MOCK'),
      providerRef: req.body?.providerRef || null,
      data: sanitizedData,
      operatorName: req.user?.name || null,
      terminalId: req.terminal?.id || null,
    });

    if (result?.error) {
      return res.status(result.statusCode || 409).json(result);
    }

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: 'USER',
      actorId: Number(req.user?.id || 0),
      merchantId: Number(merchantId),
      action: 'PAYMENT_INTENT_CONFIRM',
      ip,
      userAgent,
      payload: {
        intentId: Number(req.params.id),
        status: result?.status || 'APPROVED',
        saleId: result?.saleId || result?.sale?.id || null,
        printJobId: result?.printJobId || null,
        terminalId: req.terminal?.id || null,
      },
    }).catch(() => {});

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function failIntent(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const sanitizedData = sanitizePaymentData(req.body?.data ?? req.body ?? null);
    const result = await paymentsService.failPaymentIntent({
      merchantId,
      id: req.params.id,
      status: req.body?.status || 'DECLINED',
      provider: String(req.body?.provider || 'MOCK'),
      providerRef: req.body?.providerRef || null,
      data: sanitizedData,
      terminalId: req.terminal?.id || null,
    });

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: 'USER',
      actorId: Number(req.user?.id || 0),
      merchantId: Number(merchantId),
      action: 'PAYMENT_INTENT_FAIL',
      ip,
      userAgent,
      payload: {
        intentId: Number(req.params.id),
        status: result?.status || req.body?.status || 'DECLINED',
        terminalId: req.terminal?.id || null,
      },
    }).catch(() => {});

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function mockApprove(req, res, next) {
  try {
    if (isProd()) {
      return res.status(404).json({ message: 'Not found' });
    }

    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const result = await paymentsService.confirmPaymentIntent({
      merchantId,
      id: req.params.id,
      provider: 'MOCK',
      providerRef: `mock_${Date.now()}`,
      data: { mock: true, action: 'APPROVE' },
      operatorName: req.user?.name || null,
    });

    if (result?.error) {
      return res.status(result.statusCode || 409).json(result);
    }

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function mockDecline(req, res, next) {
  try {
    if (isProd()) {
      return res.status(404).json({ message: 'Not found' });
    }

    const merchantId = getMerchantId(req);
    if (!merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const result = await paymentsService.failPaymentIntent({
      merchantId,
      id: req.params.id,
      status: 'DECLINED',
      provider: 'MOCK',
      providerRef: `mock_${Date.now()}`,
      data: { mock: true, action: 'DECLINE' },
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function callback(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED', message: 'Unauthenticated' });

    const intentId = parseCallbackIntentId(req.body || {});
    if (!intentId) {
      return res.status(400).json({ success: false, error: 'INVALID_ORDER', message: 'order_id/intentId is required' });
    }

    const sanitizedData = sanitizePaymentData(req.body || {});
    const normalizedStatus = normalizeCallbackStatus(sanitizedData?.status || req.body?.status);
    if (!normalizedStatus) {
      return res.status(400).json({ success: false, error: 'INVALID_STATUS', message: 'status is required' });
    }

    const provider = String(req.body?.provider || 'STONE').trim() || 'STONE';
    const providerRef = req.body?.providerRef || req.body?.transaction_id || req.body?.transactionId || null;

    if (normalizedStatus === 'APPROVED') {
      const result = await paymentsService.confirmPaymentIntent({
        merchantId,
        id: intentId,
        provider,
        providerRef,
        data: sanitizedData,
        operatorName: req.user?.name || null,
        terminalId: req.terminal?.id || null,
      });

      if (result?.error) {
        return res.status(result.statusCode || 409).json({
          success: false,
          error: 'PAYMENT_NOT_CONFIRMED',
          message: result?.message || 'Pagamento n�o confirmado',
        });
      }

      return res.json({
        success: true,
        message: 'Pagamento aprovado',
        transaction_id: sanitizedData?.transactionId || providerRef || null,
        authorization_code: sanitizedData?.authorizationCode || null,
      });
    }

    const failStatus = normalizedStatus === 'DECLINED' ? 'DECLINED' : normalizedStatus === 'CANCELED' ? 'CANCELED' : 'ERROR';
    await paymentsService.failPaymentIntent({
      merchantId,
      id: intentId,
      status: failStatus,
      provider,
      providerRef,
      data: sanitizedData,
      terminalId: req.terminal?.id || null,
    });

    return res.json({
      success: false,
      error: failStatus,
      message: 'Pagamento n�o aprovado',
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createIntent,
  getIntent,
  confirmIntent,
  failIntent,
  callback,
  mockApprove,
  mockDecline,
};
