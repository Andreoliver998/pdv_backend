const prisma = require("../config/prisma");

function truncate(value, maxLen) {
  const s = String(value || "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen);
}

async function writeAuditLog({
  actorType,
  actorId,
  merchantId = null,
  action,
  ip = null,
  userAgent = null,
  payload = null,
}) {
  const aType = String(actorType || "").trim().toUpperCase();
  if (aType !== "ADMIN" && aType !== "USER") return null;

  const aId = Number(actorId);
  if (!Number.isFinite(aId)) return null;

  const mId = merchantId == null ? null : Number(merchantId);

  const act = String(action || "").trim();
  if (!act) return null;

  try {
    return await prisma.auditLog.create({
      data: {
        actorType: aType,
        actorId: aId,
        merchantId: mId || null,
        action: truncate(act, 120),
        ip: ip ? truncate(ip, 80) : null,
        userAgent: userAgent ? truncate(userAgent, 240) : null,
        payload: payload ?? null,
      },
    });
  } catch {
    return null;
  }
}

module.exports = { writeAuditLog };

