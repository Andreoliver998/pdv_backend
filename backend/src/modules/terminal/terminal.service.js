// backend/src/modules/terminal/terminal.service.js
const crypto = require('crypto');
const prisma = require('../../config/prisma');

function buildHttpError(message, statusCode, code, details) {
  const err = new Error(String(message || 'Error'));
  err.statusCode = Number(statusCode || 500) || 500;
  if (code) err.code = String(code);
  if (details) err.details = details;
  return err;
}

function nowPlusMinutes(min) {
  return new Date(Date.now() + Number(min) * 60 * 1000);
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomBase64Url(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function normalizeDeviceIdentifier(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  // Evita strings gigantes, espaços e caracteres ruins para uso em identificador único.
  const compact = v.replace(/\s+/g, '_').replace(/[^\w.\-:@]/g, '').slice(0, 64);
  return compact;
}

function normalizeTerminalStatus(s) {
  const v = String(s || '').trim().toUpperCase();
  if (v === 'ONLINE' || v === 'OFFLINE' || v === 'DISABLED') return v;
  return 'OFFLINE';
}

const TERMINAL_NAME_MAX_LEN = 80;

function normalizeOptionalTerminalName(raw, { strict = false } = {}) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.length <= TERMINAL_NAME_MAX_LEN) return value;
  if (strict) {
    throw buildHttpError('Nome do terminal muito longo', 400, 'TERMINAL_NAME_TOO_LONG', {
      maxLength: TERMINAL_NAME_MAX_LEN,
    });
  }
  return value.slice(0, TERMINAL_NAME_MAX_LEN);
}

async function activateTerminal({ merchantId, name, identifier }) {
  const mId = Number(merchantId);
  const n = String(name || '').trim();
  const idfRaw = String(identifier || '').trim();
  const idf = normalizeDeviceIdentifier(idfRaw);

  if (!mId || mId <= 0) throw buildHttpError('MERCHANT_ID_INVALID', 400, 'MERCHANT_ID_INVALID');
  if (!idf) throw buildHttpError('IDENTIFIER_REQUIRED', 400, 'IDENTIFIER_REQUIRED');

  const existing = await prisma.terminal.findUnique({
    where: { identifier: idf },
    select: { id: true, merchantId: true, status: true },
  });

  if (existing && Number(existing.merchantId) !== mId) {
    throw buildHttpError('Terminal já vinculado a outro estabelecimento', 409, 'TERMINAL_ALREADY_LINKED');
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    if (existing) {
      const activeKey = await tx.terminalApiKey.findFirst({
        where: { terminalId: existing.id, revokedAt: null },
        select: { id: true },
      });

      // Regra: se já tem chave ativa e não está DISABLED, consideramos "já ativado".
      if (activeKey && String(existing.status || '').toUpperCase() !== 'DISABLED') {
        throw buildHttpError('Terminal já ativado', 409, 'TERMINAL_ALREADY_ACTIVATED');
      }

      // Reativação: revoga chaves antigas antes de emitir uma nova.
      await tx.terminalApiKey.updateMany({
        where: { terminalId: existing.id, revokedAt: null },
        data: { revokedAt: now },
      });
    }

    let terminalRecord = null;
    let terminalKey = '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      terminalKey = randomBase64Url(32);
      try {
        terminalRecord = existing
          ? await tx.terminal.update({
              where: { id: existing.id },
              data: {
                name: n || 'Terminal',
                apiKey: terminalKey, // compat legado
                status: 'OFFLINE',
                lastSeenAt: null,
              },
              select: {
                id: true,
                merchantId: true,
                name: true,
                identifier: true,
                apiKey: true,
                status: true,
                lastSeenAt: true,
              },
            })
          : await tx.terminal.create({
              data: {
                merchantId: mId,
                name: n || 'Terminal',
                identifier: idf,
                apiKey: terminalKey, // compat legado
                status: 'OFFLINE',
              },
              select: {
                id: true,
                merchantId: true,
                name: true,
                identifier: true,
                apiKey: true,
                status: true,
                lastSeenAt: true,
              },
            });
        break;
      } catch (err) {
        if (err?.code === 'P2002') continue; // colisão improvável de apiKey
        throw err;
      }
    }

    if (!terminalRecord) {
      throw buildHttpError('Falha ao gerar chave do terminal', 500, 'TERMINAL_KEY_GENERATION_FAILED');
    }

    await tx.terminalApiKey.create({
      data: {
        terminalId: terminalRecord.id,
        keyPrefix: terminalKey.slice(0, 8),
        keyHash: sha256Hex(terminalKey),
      },
    });

    return terminalRecord;
  });
}

async function listTerminals({ merchantId }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error('merchantId is required');

  const list = await prisma.terminal.findMany({
    where: { merchantId: mId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      merchantId: true,
      name: true,
      identifier: true,
      status: true,
      lastSeenAt: true,
      deviceModel: true,
      deviceSerial: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return list.map((t) => ({
    ...t,
    status: normalizeTerminalStatus(t.status),
  }));
}

async function createTerminal({ merchantId, name }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error('merchantId is required');

  const terminalName = String(name || '').trim() || 'Maquininha';
  const identifier = `term_${randomHex(6)}`;

  // Mantemos apiKey legado preenchido (nÃ£o Ã© exibido nesse endpoint).
  const apiKey = randomHex(24);

  return prisma.terminal.create({
    data: {
      merchantId: mId,
      name: terminalName,
      identifier,
      apiKey,
      status: 'OFFLINE',
    },
    select: {
      id: true,
      merchantId: true,
      name: true,
      identifier: true,
      status: true,
      lastSeenAt: true,
      deviceModel: true,
      deviceSerial: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function createPairingCode({ merchantId, terminalId, expiresMinutes = 10 }) {
  const mId = Number(merchantId);
  const tId = Number(terminalId);
  if (!mId) throw new Error('merchantId is required');
  if (!tId) throw new Error('terminalId is required');

  const terminal = await prisma.terminal.findFirst({
    where: { id: tId, merchantId: mId },
    select: { id: true, status: true },
  });
  if (!terminal) {
    throw buildHttpError('Terminal não encontrado', 404, 'TERMINAL_NOT_FOUND');
  }
  if (String(terminal.status || '').toUpperCase() === 'DISABLED') {
    // Fluxo comum: o usuário revogou e quer vincular novamente.
    // Como esse endpoint exige JWT, reativamos o terminal ao gerar um novo pairing code.
    await prisma.terminal.update({
      where: { id: terminal.id },
      data: { status: 'OFFLINE' },
      select: { id: true },
    });
  }

  const expiresAt = nowPlusMinutes(expiresMinutes);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    try {
      const created = await prisma.terminalPairingCode.create({
        data: {
          terminalId: tId,
          code,
          expiresAt,
        },
        select: { code: true, expiresAt: true },
      });
      return created;
    } catch (err) {
      if (err?.code === 'P2002') continue; // code colidiu
      throw err;
    }
  }

  const err = new Error('Could not generate pairing code');
  err.statusCode = 500;
  throw err;
}

async function createProvisioningCode({ merchantId, expiresMinutes = 5, name }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error('merchantId is required');

  const provisioningName = normalizeOptionalTerminalName(name, { strict: true });
  const expiresAt = nowPlusMinutes(expiresMinutes);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    try {
      return await prisma.terminalProvisioningCode.create({
        data: { merchantId: mId, code, expiresAt, name: provisioningName },
        select: { id: true, code: true, name: true, expiresAt: true, usedAt: true, terminalId: true, createdAt: true },
      });
    } catch (err) {
      if (err?.code === 'P2002') continue; // code colidiu
      throw err;
    }
  }

  const err = new Error('Could not generate provisioning code');
  err.statusCode = 500;
  throw err;
}

async function getProvisioningCode({ merchantId, id }) {
  const mId = Number(merchantId);
  const codeId = Number(id);
  if (!mId) throw new Error('merchantId is required');
  if (!codeId) {
    const err = new Error('Invalid code id');
    err.statusCode = 400;
    throw err;
  }

  const code = await prisma.terminalProvisioningCode.findFirst({
    where: { id: codeId, merchantId: mId },
    select: { id: true, code: true, name: true, expiresAt: true, usedAt: true, terminalId: true, createdAt: true },
  });
  if (!code) {
    const err = new Error('Provisioning code not found');
    err.statusCode = 404;
    throw err;
  }

  return code;
}

async function claimProvisioningCode({ code, deviceName, deviceId, deviceModel }) {
  const pairingCode = String(code || '').trim();
  if (!/^\d{6}$/.test(pairingCode)) {
    throw buildHttpError('Código inválido', 400, 'INVALID_CODE');
  }

  const now = new Date();
  const normalizedDeviceId = normalizeDeviceIdentifier(deviceId);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TerminalProvisioningCode" WHERE "code" = ${pairingCode} FOR UPDATE`;

    const provision = await tx.terminalProvisioningCode.findFirst({
      where: { code: pairingCode },
      select: { id: true, merchantId: true, name: true, expiresAt: true, usedAt: true, terminalId: true },
    });

    // Se não achar em provisioning, tentamos o "pairing code" legado (associado a um terminal existente).
    if (!provision) {
      await tx.$queryRaw`SELECT id FROM "TerminalPairingCode" WHERE "code" = ${pairingCode} FOR UPDATE`;

      const pairing = await tx.terminalPairingCode.findFirst({
        where: { code: pairingCode },
        include: { terminal: { select: { id: true, merchantId: true, name: true, identifier: true, apiKey: true, status: true, lastSeenAt: true, deviceSerial: true } } },
      });

      if (!pairing || !pairing.terminal) {
        throw buildHttpError('Código inválido', 404, 'CODE_NOT_FOUND');
      }
      if (pairing.expiresAt && new Date(pairing.expiresAt) < now) {
        throw buildHttpError('Código expirou', 410, 'CODE_EXPIRED');
      }

      const terminal = pairing.terminal;
      if (String(terminal.status || '').toUpperCase() === 'DISABLED') {
        throw buildHttpError('Terminal desabilitado', 409, 'TERMINAL_DISABLED');
      }

      if (pairing.usedAt) {
        if (normalizedDeviceId && String(terminal.deviceSerial || '').trim() === normalizedDeviceId && terminal.apiKey) {
          return {
            provisioningId: pairing.id,
            terminalKey: terminal.apiKey,
            terminal: { id: terminal.id, merchantId: terminal.merchantId, name: terminal.name, identifier: terminal.identifier, status: terminal.status, lastSeenAt: terminal.lastSeenAt },
            idempotent: true,
          };
        }
        throw buildHttpError('Código já utilizado', 409, 'CODE_ALREADY_USED');
      }

      const terminalName = String(deviceName || '').trim() || terminal.name || 'Maquininha';

      // Geramos a chave que o app vai guardar e usar no header X-Terminal-Key.
      let terminalKey = '';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        terminalKey = randomBase64Url(32);
        try {
          await tx.terminal.update({
            where: { id: terminal.id },
            data: {
              status: 'ONLINE',
              lastSeenAt: now,
              name: terminalName,
              apiKey: terminalKey, // compat legado + idempotência no pairing legado
              deviceModel: deviceModel ? String(deviceModel).trim() : undefined,
              deviceSerial: normalizedDeviceId || undefined,
            },
            select: { id: true },
          });
          break;
        } catch (err) {
          if (err?.code === 'P2002') continue;
          throw err;
        }
      }

      if (!terminalKey) throw buildHttpError('Falha ao gerar chave do terminal', 500, 'TERMINAL_KEY_GENERATION_FAILED');

      const keyPrefix = terminalKey.slice(0, 8);
      const keyHash = sha256Hex(terminalKey);

      await tx.terminalApiKey.create({ data: { terminalId: terminal.id, keyPrefix, keyHash } });

      await tx.terminalPairingCode.update({
        where: { id: pairing.id },
        data: { usedAt: now },
      });

      const updatedTerminal = await tx.terminal.findUnique({
        where: { id: terminal.id },
        select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true },
      });

      return { provisioningId: pairing.id, terminalKey, terminal: updatedTerminal, idempotent: false };
    }

    if (provision.expiresAt && new Date(provision.expiresAt) < now) {
      throw buildHttpError('Código expirou', 410, 'CODE_EXPIRED');
    }

    const mId = Number(provision.merchantId);
    const nameFromPanel = normalizeOptionalTerminalName(provision.name);
    const nameFromDevice = normalizeOptionalTerminalName(deviceName);

    // Regra (homologação/UX): se o app enviar name, ele tem prioridade; caso contrário, usa o nome digitado no painel.
    const desiredName = nameFromDevice || nameFromPanel || null;
    const terminalName = desiredName || 'Maquininha';

    // Para idempotência, preferimos um identificador determinístico quando o app fornece.
    const identifier = normalizedDeviceId ? `dev_${normalizedDeviceId.slice(0, 32)}` : `term_${randomHex(6)}`;

    // Se o código já foi usado, só deve retornar sucesso se for o MESMO dispositivo/terminal (idempotência).
    if (provision.usedAt || provision.terminalId) {
      if (!provision.terminalId) {
        throw buildHttpError('Código já utilizado', 409, 'CODE_ALREADY_USED');
      }

      const existingTerminal = await tx.terminal.findUnique({
        where: { id: provision.terminalId },
        select: { id: true, merchantId: true, identifier: true, apiKey: true, name: true, status: true, lastSeenAt: true, deviceSerial: true },
      });

      if (
        existingTerminal &&
        Number(existingTerminal.merchantId) === mId &&
        normalizedDeviceId &&
        (existingTerminal.identifier === identifier || String(existingTerminal.deviceSerial || '').trim() === normalizedDeviceId)
      ) {
        // Idempotente: o app repetiu a operação com o mesmo device/identifier.
        // Retornamos a chave legada (texto puro) para compatibilidade. (Não logar a chave)
        return {
          provisioningId: provision.id,
          terminalKey: existingTerminal.apiKey,
          terminal: {
            id: existingTerminal.id,
            merchantId: existingTerminal.merchantId,
            name: existingTerminal.name,
            identifier: existingTerminal.identifier,
            status: existingTerminal.status,
            lastSeenAt: existingTerminal.lastSeenAt,
          },
          idempotent: true,
        };
      }

      throw buildHttpError('Código já foi usado por outro terminal', 409, 'CODE_ALREADY_USED_BY_OTHER_TERMINAL');
    }

    // Se já existe um Terminal com esse identifier, tratamos como "re-vincular" (mesmo merchant) em vez de criar outro.
    const existingByIdentifier = await tx.terminal.findFirst({
      where: { identifier },
      select: { id: true, merchantId: true },
    });

    if (existingByIdentifier && Number(existingByIdentifier.merchantId) !== mId) {
      throw buildHttpError('Terminal já vinculado', 409, 'TERMINAL_ALREADY_LINKED');
    }

    // Geramos a chave que o app vai guardar e usar no header X-Terminal-Key.
    // Em caso de colisão improvável na coluna unique apiKey, tentamos novamente.
    let terminalKey = '';
    let terminalRecord = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      terminalKey = randomBase64Url(32);
      try {
        terminalRecord = existingByIdentifier
          ? await tx.terminal.update({
              where: { id: existingByIdentifier.id },
              data: {
                ...(desiredName ? { name: desiredName } : {}),
                status: 'ONLINE',
                lastSeenAt: now,
                apiKey: terminalKey, // compat legado + idempotência
                deviceModel: deviceModel ? String(deviceModel).trim() : null,
                deviceSerial: normalizedDeviceId || null,
              },
              select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true },
            })
          : await tx.terminal.create({
              data: {
                merchantId: mId,
                name: terminalName,
                identifier,
                apiKey: terminalKey, // compat legado + idempotência
                status: 'ONLINE',
                lastSeenAt: now,
                deviceModel: deviceModel ? String(deviceModel).trim() : null,
                deviceSerial: normalizedDeviceId || null,
              },
              select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true },
            });

        break;
      } catch (err) {
        if (err?.code === 'P2002') {
          const targets = Array.isArray(err?.meta?.target) ? err.meta.target : [];
          if (targets.includes('identifier')) {
            // Corrida/conflito: identifier já existe (ou foi criado em paralelo).
            const existing = await tx.terminal.findFirst({
              where: { identifier },
              select: { id: true, merchantId: true },
            });
            if (existing && Number(existing.merchantId) === mId) {
              terminalRecord = await tx.terminal.update({
                where: { id: existing.id },
                data: {
                  ...(desiredName ? { name: desiredName } : {}),
                  status: 'ONLINE',
                  lastSeenAt: now,
                  apiKey: terminalKey,
                  deviceModel: deviceModel ? String(deviceModel).trim() : null,
                  deviceSerial: normalizedDeviceId || null,
                },
                select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true },
              });
              break;
            }
            throw buildHttpError('Terminal já vinculado', 409, 'TERMINAL_ALREADY_LINKED');
          }
          if (targets.includes('apiKey')) continue; // tenta nova chave
        }
        throw err;
      }
    }

    if (!terminalRecord) {
      throw buildHttpError('Falha ao gerar chave do terminal', 500, 'TERMINAL_KEY_GENERATION_FAILED');
    }

    const keyPrefix = terminalKey.slice(0, 8);
    const keyHash = sha256Hex(terminalKey);

    await tx.terminalApiKey.create({ data: { terminalId: terminalRecord.id, keyPrefix, keyHash } });

    await tx.terminalProvisioningCode.update({
      where: { id: provision.id },
      data: { usedAt: now, terminalId: terminalRecord.id },
    });

    return { provisioningId: provision.id, terminalKey, terminal: terminalRecord, idempotent: false };
  });
}

async function revokeTerminal({ merchantId, terminalId }) {
  const mId = Number(merchantId);
  const tId = Number(terminalId);
  if (!mId) throw new Error('merchantId is required');
  if (!tId) throw new Error('terminalId is required');

  return prisma.$transaction(async (tx) => {
    const terminal = await tx.terminal.findFirst({
      where: { id: tId, merchantId: mId },
      select: { id: true },
    });
    if (!terminal) {
      const err = new Error('Terminal not found');
      err.statusCode = 404;
      throw err;
    }

    await tx.terminalApiKey.updateMany({
      where: { terminalId: tId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Invalida chave legada tambÃ©m (se existir)
    await tx.terminal.update({
      where: { id: tId },
      data: { status: 'DISABLED', apiKey: randomHex(24) },
    });

    return tx.terminal.findUnique({
      where: { id: tId },
      select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true, createdAt: true, updatedAt: true },
    });
  });
}

async function pairTerminal({ pairingCode, deviceModel, deviceSerial, name }) {
  const code = String(pairingCode || '').trim();
  if (!/^\d{6}$/.test(code)) {
    const err = new Error('Invalid pairingCode');
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TerminalPairingCode" WHERE "code" = ${code} FOR UPDATE`;

    const pairing = await tx.terminalPairingCode.findFirst({
      where: { code },
      include: { terminal: { select: { id: true, merchantId: true, name: true, identifier: true, status: true } } },
    });

    if (!pairing || !pairing.terminal) {
      const err = new Error('Pairing code not found');
      err.statusCode = 404;
      throw err;
    }
    if (pairing.usedAt) {
      const err = new Error('Pairing code already used');
      err.statusCode = 409;
      throw err;
    }
    if (pairing.expiresAt && new Date(pairing.expiresAt) < now) {
      const err = new Error('Pairing code expired');
      err.statusCode = 410;
      throw err;
    }
    if (String(pairing.terminal.status || '').toUpperCase() === 'DISABLED') {
      const err = new Error('Terminal disabled');
      err.statusCode = 409;
      throw err;
    }

    await tx.terminalPairingCode.update({
      where: { id: pairing.id },
      data: { usedAt: now },
    });

    const terminalKey = randomBase64Url(32);
    const keyPrefix = terminalKey.slice(0, 8);
    const keyHash = sha256Hex(terminalKey);

    await tx.terminalApiKey.create({
      data: {
        terminalId: pairing.terminal.id,
        keyPrefix,
        keyHash,
      },
    });

    const updatedTerminal = await tx.terminal.update({
      where: { id: pairing.terminal.id },
      data: {
        status: 'ONLINE',
        lastSeenAt: now,
        deviceModel: deviceModel ? String(deviceModel).trim() : undefined,
        deviceSerial: deviceSerial ? String(deviceSerial).trim() : undefined,
        name: String(name || '').trim() || pairing.terminal.name || 'Maquininha',
      },
      select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true },
    });

    return { terminalKey, terminal: updatedTerminal };
  });
}

async function touchTerminal({ terminalId, merchantId }) {
  const tId = Number(terminalId);
  const mId = Number(merchantId);
  if (!tId || !mId) {
    const err = new Error('Invalid terminal');
    err.statusCode = 400;
    throw err;
  }

  return prisma.terminal.update({
    where: { id: tId },
    data: { lastSeenAt: new Date(), status: 'ONLINE' },
    select: { id: true, merchantId: true, name: true, identifier: true, status: true, lastSeenAt: true },
  });
}

module.exports = {
  activateTerminal,
  listTerminals,
  createTerminal,
  createPairingCode,
  createProvisioningCode,
  getProvisioningCode,
  claimProvisioningCode,
  revokeTerminal,
  pairTerminal,
  touchTerminal,
};
