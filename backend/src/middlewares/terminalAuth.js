// backend/src/middlewares/terminalAuth.js
// Autentica terminais via header `X-Terminal-Key`:
// - Novo formato: chave aleatória (nunca armazenada em texto puro), valida por hash (sha256) + prefix
// - Compatibilidade: aceita `Terminal.apiKey` legado (texto puro) sem logar a chave
const crypto = require("crypto");
const prisma = require("../config/prisma");

function isDev() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "development";
}

function getTerminalKeyFromHeaders(req) {
  const headerKey =
    req.headers["x-terminal-key"] || req.headers["x-terminal-api-key"] || req.headers["x-api-key"];
  return String(headerKey || "").trim();
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function safeEqualHex(a, b) {
  const aBuf = Buffer.from(String(a || ""), "hex");
  const bBuf = Buffer.from(String(b || ""), "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function isTerminalDisabled(status) {
  return String(status || "").trim().toUpperCase() === "DISABLED";
}

function shouldSkipTerminalApiKeyLookup(err) {
  const code = String(err?.code || "").trim();
  const msg = String(err?.message || err || "");
  if (code === "P2021") return true; // table does not exist
  if (/terminalApiKey/i.test(msg) && /(does not exist|no such table|relation .* does not exist)/i.test(msg)) return true;
  return false;
}

async function ensureTerminal(req, res, next) {
  try {
    const terminalKey = getTerminalKeyFromHeaders(req);
    if (!terminalKey) return res.status(401).json({ message: "Terminal key missing" });

    // 1) Novo formato: TerminalApiKey (hash + prefix)
    const prefix = terminalKey.slice(0, 8);
    if (prefix.length === 8 && prisma.terminalApiKey && typeof prisma.terminalApiKey.findMany === "function") {
      let candidates = [];
      try {
        candidates = await prisma.terminalApiKey.findMany({
          where: { keyPrefix: prefix, revokedAt: null },
          select: {
            id: true,
            keyHash: true,
            terminal: {
              select: {
                id: true,
                name: true,
                merchantId: true,
                identifier: true,
                status: true,
                merchant: {
                  select: { id: true, name: true, status: true, isLoginBlocked: true, loginBlockedReason: true },
                },
              },
            },
          },
          take: 20,
        });
      } catch (err) {
        // Se o schema/migration ainda não tem TerminalApiKey no banco, cai para o fluxo legado (Terminal.apiKey).
        if (!shouldSkipTerminalApiKeyLookup(err)) throw err;
        candidates = [];
      }

      const providedHash = sha256Hex(terminalKey);
      for (const c of candidates) {
        if (!c?.keyHash || !c?.terminal) continue;
        if (!safeEqualHex(c.keyHash, providedHash)) continue;

        const terminal = c.terminal;

        if (isTerminalDisabled(terminal.status)) {
          return res.status(403).json({ message: "Terminal blocked/inactive" });
        }
        if (!terminal.merchantId) {
          return res.status(403).json({ message: "Terminal is not linked to a merchant" });
        }
        if (terminal.merchant && String(terminal.merchant.status || "").toUpperCase() !== "ACTIVE") {
          return res.status(403).json({ message: "Merchant is suspended" });
        }
        if (terminal.merchant && terminal.merchant.isLoginBlocked) {
          return res.status(403).json({ message: "Merchant access blocked" });
        }

        req.terminal = {
          id: terminal.id,
          merchantId: terminal.merchantId,
          name: terminal.name,
          identifier: terminal.identifier,
          status: terminal.status,
        };

        req.user = {
          id: 0,
          merchantId: terminal.merchantId,
          role: "TERMINAL",
          email: null,
          name: terminal.name || "Terminal",
          isActive: true,
        };

        req.merchant = terminal.merchant || null;
        return next();
      }
    }

    // 2) Compatibilidade: apiKey legado em Terminal (texto puro)
    const legacy = await prisma.terminal.findFirst({
      where: { apiKey: terminalKey },
      select: {
        id: true,
        name: true,
        merchantId: true,
        identifier: true,
        status: true,
        merchant: { select: { id: true, name: true, status: true, isLoginBlocked: true, loginBlockedReason: true } },
      },
    });

    if (legacy) {
      if (isTerminalDisabled(legacy.status)) {
        return res.status(403).json({ message: "Terminal blocked/inactive" });
      }
      if (!legacy.merchantId) {
        return res.status(403).json({ message: "Terminal is not linked to a merchant" });
      }
      if (legacy.merchant && String(legacy.merchant.status || "").toUpperCase() !== "ACTIVE") {
        return res.status(403).json({ message: "Merchant is suspended" });
      }
      if (legacy.merchant && legacy.merchant.isLoginBlocked) {
        return res.status(403).json({ message: "Merchant access blocked" });
      }

      req.terminal = {
        id: legacy.id,
        merchantId: legacy.merchantId,
        name: legacy.name,
        identifier: legacy.identifier,
        status: legacy.status,
      };

      req.user = {
        id: 0,
        merchantId: legacy.merchantId,
        role: "TERMINAL",
        email: null,
        name: legacy.name || "Terminal",
        isActive: true,
      };

      req.merchant = legacy.merchant || null;
      return next();
    }

    return res.status(401).json({ message: "Invalid terminal key" });
  } catch (err) {
    if (isDev()) {
      console.error("[terminalAuth] error:", err?.message || err);
    }
    return res.status(500).json({ message: "Terminal auth error" });
  }
}

module.exports = { ensureTerminal };
