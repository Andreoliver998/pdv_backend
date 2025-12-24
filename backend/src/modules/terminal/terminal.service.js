// backend/src/modules/terminal/terminal.service.js
const crypto = require("crypto");
const prisma = require("../../config/prisma");

function newApiKey() {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Ativa (cria ou reativa) um terminal para um merchant.
 * - Se já existir terminal com mesmo merchantId + identifier: atualiza apiKey e nome.
 * - Se não existir: cria.
 *
 * OBS: NÃO usa isActive porque seu schema não tem esse campo.
 */
async function activateTerminal({ merchantId, name, identifier }) {
  const mId = Number(merchantId);
  const n = String(name || "").trim();
  const idf = String(identifier || "").trim();

  if (!mId || mId <= 0) throw new Error("MERCHANT_ID_INVALID");
  if (!idf) throw new Error("IDENTIFIER_REQUIRED");

  const existing = await prisma.terminal.findFirst({
    where: { merchantId: mId, identifier: idf },
    select: { id: true },
  });

  const apiKey = newApiKey();

  if (existing) {
    return prisma.terminal.update({
      where: { id: existing.id },
      data: {
        name: n || "Terminal",
        apiKey, // rotaciona chave
      },
    });
  }

  return prisma.terminal.create({
    data: {
      merchantId: mId,
      name: n || "Terminal",
      identifier: idf,
      apiKey,
    },
  });
}

module.exports = { activateTerminal };