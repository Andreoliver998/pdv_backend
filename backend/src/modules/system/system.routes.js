const express = require("express");
const prisma = require("../../config/prisma");

const router = express.Router();

router.get("/maintenance", async (req, res) => {
  // Endpoint público para o painel do cliente mostrar banner de manutenção.
  // Não exige auth e não expõe dados sensíveis.
  // Evita cache (precisa refletir mudanças imediatamente).
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  try {
    if (!prisma.systemMaintenance) {
      return res.json({ enabled: false, message: null, startsAt: null, endsAt: null });
    }

    // Singleton: preferir id=1. Se não existir (bases antigas), cair para o mais recente por updatedAt.
    let m = await prisma.systemMaintenance.findUnique({
      where: { id: 1 },
      select: { enabled: true, message: true, startsAt: true, endsAt: true },
    });
    if (!m) {
      m = await prisma.systemMaintenance.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { enabled: true, message: true, startsAt: true, endsAt: true },
      });
    }

    const payload = {
      enabled: Boolean(m?.enabled),
      message: m?.message != null ? String(m.message) : null,
      startsAt: m?.startsAt ? new Date(m.startsAt).toISOString() : null,
      endsAt: m?.endsAt ? new Date(m.endsAt).toISOString() : null,
    };

    return res.json(payload);
  } catch {
    return res.json({ enabled: false, message: null, startsAt: null, endsAt: null });
  }
});

module.exports = router;
