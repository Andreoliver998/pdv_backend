// backend/src/modules/terminal/terminal.controller.js
const terminalService = require('./terminal.service');
const { writeAuditLog } = require('../../services/auditLog');

function getMerchantId(req) {
  return req.user?.merchantId || req.merchant?.id || null;
}

function isDev() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'development';
}

function sendClaimError(res, err) {
  const status = Number(err?.statusCode || err?.status || 500) || 500;
  const message = String(err?.message || 'Erro ao vincular terminal');
  const code = String(err?.code || err?.name || 'InternalError');
  const payload = { ok: false, message, code };
  if (isDev() && err?.details) payload.details = err.details;
  return res.status(status).json(payload);
}

function getPublicApiBase() {
  const raw = String(process.env.API_PUBLIC_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
  const base = raw || (isDev() ? 'http://127.0.0.1:3333' : '');
  if (!base) return '';
  // Os endpoints do backend estÃ£o sob /api
  if (base.endsWith('/api')) return base;
  return `${base}/api`;
}

function getReqMeta(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const userAgent = String(req.headers['user-agent'] || '').trim();
  return { ip: ip || null, userAgent: userAgent || null };
}

async function activate(req, res) {
  try {
    if (!req.user || !req.user.merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const { name, identifier } = req.body;

    const terminal = await terminalService.activateTerminal({
      merchantId: req.user.merchantId,
      name,
      identifier,
    });

    // Legado: retorna apiKey para o Android guardar e usar
    return res.status(201).json({
      terminalId: terminal.id,
      apiKey: terminal.apiKey,
      name: terminal.name,
      identifier: terminal.identifier,
      merchantId: terminal.merchantId,
      status: terminal.status,
      lastSeenAt: terminal.lastSeenAt || null,
    });
  } catch (err) {
    const status = Number(err?.statusCode || err?.status || 0) || (err?.code === 'P2002' ? 409 : 400);
    const msg = String(err?.message || 'Error activating terminal');
    const code = String(err?.code || err?.name || 'BadRequest');
    return res.status(status).json({ ok: false, message: msg, code });
  }
}

async function list(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const terminals = await terminalService.listTerminals({ merchantId });
    return res.json({ ok: true, terminals });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const terminal = await terminalService.createTerminal({
      merchantId,
      name: req.body?.name || null,
    });

    return res.status(201).json({ ok: true, terminal });
  } catch (err) {
    return next(err);
  }
}

async function createPairingCode(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const created = await terminalService.createPairingCode({
      merchantId,
      terminalId: req.params.id,
      expiresMinutes: 10,
    });

    const apiBase = getPublicApiBase();
    const qrPayloadObj = { apiBase, pairingCode: created.code };
    const qrPayload = JSON.stringify(qrPayloadObj);

    return res.json({
      ok: true,
      terminalId: Number(req.params.id),
      pairingCode: created.code,
      expiresAt: created.expiresAt,
      qrPayload,
      apiBase,
    });
  } catch (err) {
    return next(err);
  }
}

async function revoke(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const terminal = await terminalService.revokeTerminal({
      merchantId,
      terminalId: req.params.id,
    });

    return res.json({ ok: true, terminal });
  } catch (err) {
    return next(err);
  }
}

async function createProvisioningCode(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const requestedName = req.body?.name ?? req.body?.terminalName ?? req.body?.terminal_name ?? null;
    if (requestedName != null) {
      const n = String(requestedName || '').trim();
      if (n && n.length < 2) {
        return res.status(400).json({ ok: false, message: 'name must be at least 2 characters', code: 'NAME_TOO_SHORT' });
      }
    }
    const created = await terminalService.createProvisioningCode({
      merchantId,
      expiresMinutes: 5,
      name: requestedName,
    });

    const apiBase = getPublicApiBase();
    const qrPayload = JSON.stringify({ apiBase, code: created.code });

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: 'USER',
      actorId: Number(req.user?.id || 0),
      merchantId: Number(merchantId),
      action: 'TERMINAL_PROVISION_CODE_CREATE',
      ip,
      userAgent,
      payload: { provisioningId: created.id, expiresAt: created.expiresAt },
    }).catch(() => {});

    return res.status(201).json({
      ok: true,
      id: created.id,
      code: created.code,
      name: created.name || null,
      expiresAt: created.expiresAt,
      qrPayload,
      apiBase,
    });
  } catch (err) {
    return next(err);
  }
}

async function getProvisioningCode(req, res, next) {
  try {
    const merchantId = getMerchantId(req);
    if (!merchantId) return res.status(401).json({ message: 'Unauthenticated' });

    const code = await terminalService.getProvisioningCode({
      merchantId,
      id: req.params.id,
    });
    return res.json({ ok: true, code, name: code?.name || null });
  } catch (err) {
    return next(err);
  }
}

async function claimProvisioningCode(req, res, next) {
  try {
    const incomingCode = req.body?.code || req.body?.pairingCode || req.body?.pairing_code;
    const incomingIdentifier = req.body?.identifier || req.body?.deviceId || req.body?.deviceSerial || null;
    const incomingName = req.body?.name || req.body?.deviceName || null;

    if (!String(incomingCode || '').trim()) {
      return res.status(400).json({ ok: false, message: 'code is required', code: 'CODE_REQUIRED' });
    }
    if (!String(incomingIdentifier || '').trim()) {
      return res.status(400).json({ ok: false, message: 'identifier is required', code: 'IDENTIFIER_REQUIRED' });
    }

    if (incomingName != null) {
      const n = String(incomingName || '').trim();
      if (n && n.length < 2) {
        return res.status(400).json({ ok: false, message: 'name must be at least 2 characters', code: 'NAME_TOO_SHORT' });
      }
    }

    const result = await terminalService.claimProvisioningCode({
      code: incomingCode,
      deviceName: incomingName,
      deviceId: incomingIdentifier,
      deviceModel: req.body?.deviceModel || null,
    });

    if (isDev()) {
      console.log('[terminal/claim]', {
        code: String(incomingCode || '').trim(),
        identifier: String(incomingIdentifier || '').trim(),
        incomingName: incomingName == null ? null : String(incomingName || '').trim() || null,
        provisioningId: result.provisioningId,
        terminalId: result.terminal?.id || null,
        terminalName: result.terminal?.name || null,
        idempotent: Boolean(result.idempotent),
      });
    }

    const { ip, userAgent } = getReqMeta(req);
    writeAuditLog({
      actorType: 'USER',
      actorId: 0,
      merchantId: Number(result.terminal?.merchantId || 0) || null,
      action: 'TERMINAL_PROVISION_CLAIM',
      ip,
      userAgent,
      payload: { provisioningId: result.provisioningId, terminalId: result.terminal?.id || null },
    }).catch(() => {});

    // Compat: alguns clientes ainda esperam "terminalKey". O app pode usar "apiKey" ou "terminalKey".
    return res.status(200).json({
      ok: true,
      terminalId: result.terminal?.id,
      apiKey: result.terminalKey,
      terminalKey: result.terminalKey,
    });
  } catch (err) {
    if (isDev()) {
      console.log('[terminal/claim][error]', {
        code: String(req.body?.code || '').trim(),
        identifier: String(req.body?.identifier || req.body?.deviceId || req.body?.deviceSerial || '').trim(),
        statusCode: err?.statusCode || err?.status || 500,
        errorCode: err?.code || err?.name || 'InternalError',
        message: err?.message || 'Erro',
      });
    }

    // Resposta dedicada para o app (status + JSON previsível).
    return sendClaimError(res, err);
  }
}

async function pair(req, res, next) {
  try {
    const result = await terminalService.pairTerminal({
      pairingCode: req.body?.pairingCode,
      deviceModel: req.body?.deviceModel || null,
      deviceSerial: req.body?.deviceSerial || null,
      name: req.body?.name || null,
    });

    // terminalKey Ã© exibida UMA vez (nunca logar)
    return res.status(201).json({ ok: true, terminalKey: result.terminalKey, terminal: result.terminal });
  } catch (err) {
    return next(err);
  }
}

async function me(req, res, next) {
  try {
    if (!req.terminal?.id || !req.terminal?.merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const terminal = await terminalService.touchTerminal({
      terminalId: req.terminal.id,
      merchantId: req.terminal.merchantId,
    });

    return res.json({ ok: true, terminal });
  } catch (err) {
    return next(err);
  }
}

async function heartbeat(req, res, next) {
  try {
    if (!req.terminal?.id || !req.terminal?.merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const terminal = await terminalService.touchTerminal({
      terminalId: req.terminal.id,
      merchantId: req.terminal.merchantId,
    });

    return res.json({ ok: true, terminal });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  activate,
  list,
  create,
  createPairingCode,
  revoke,
  createProvisioningCode,
  getProvisioningCode,
  claimProvisioningCode,
  pair,
  me,
  heartbeat,
};
