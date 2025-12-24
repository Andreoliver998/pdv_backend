// backend/src/middlewares/auth.js
const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  return token;
}

async function ensureAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ message: "Token not provided" });

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ message: "JWT_SECRET not configured" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    /**
     * =========================
     * TOKEN DE TERMINAL
     * =========================
     */
    if (payload?.type === "TERMINAL") {
      const terminalId = Number(payload.terminalId);
      const merchantId = Number(payload.merchantId);

      if (!terminalId || !merchantId) {
        return res.status(401).json({ message: "Invalid terminal token" });
      }

      const terminal = await prisma.terminal.findFirst({
        where: { id: terminalId, merchantId },
        include: { merchant: true },
      });

      if (!terminal) {
        return res.status(401).json({ message: "Terminal not found" });
      }

      req.user = {
        id: 0,
        merchantId: terminal.merchantId,
        role: "TERMINAL",
        email: null,
        name: terminal.name,
        isActive: true,
      };

      req.terminal = {
        id: terminal.id,
        name: terminal.name,
        identifier: terminal.identifier,
      };

      req.merchant = terminal.merchant;
      return next();
    }

    /**
     * =========================
     * TOKEN DE USUÁRIO
     * =========================
     */
    const userIdRaw = payload?.sub ?? payload?.userId ?? payload?.id;
    const userId = Number(userIdRaw);

    if (!userId || Number.isNaN(userId)) {
      return res.status(401).json({ message: "Invalid token subject" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { merchant: true },
    });

    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.isActive === false) {
      return res.status(403).json({ message: "User inactive" });
    }

    req.user = {
      id: user.id,
      merchantId: user.merchantId,
      role: user.role,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
    };

    req.merchant = user.merchant;
    return next();
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expired" });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
}

module.exports = { ensureAuth };
