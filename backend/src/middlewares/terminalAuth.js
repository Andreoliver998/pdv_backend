// backend/src/middlewares/terminalAuth.js
const prisma = require("../config/prisma");

async function ensureTerminal(req, res, next) {
  try {
    const headerKey = req.headers["x-terminal-key"];
    const apiKey = String(headerKey || "").trim();

    console.log("=== PDV TERMINAL AUTH ===");
    console.log("Terminal apiKey final:", apiKey);

    if (!apiKey) {
      return res.status(401).json({ message: "Terminal key missing" });
    }

    const terminal = await prisma.terminal.findFirst({
      where: { apiKey },
      select: {
        id: true,
        name: true,
        merchantId: true,
        identifier: true,
      },
    });

    console.log("Terminal encontrado:", terminal);

    if (!terminal) {
      return res.status(401).json({ message: "Invalid terminal key" });
    }

    req.terminal = terminal;
    req.merchantId = terminal.merchantId;

    return next();
  } catch (err) {
    console.error("ensureTerminal error:", err);
    return res.status(500).json({ message: "Terminal auth error" });
  }
}

module.exports = { ensureTerminal };
