// backend/src/routes/config.routes.js
const express = require("express");

const router = express.Router();

router.get("/public", (req, res) => {
  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();

  // Evita cache (browser/proxy) segurando config antiga
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  return res.json({
    ok: true,

    // Preferido (camelCase) - usado pelo seu front conforme logs anteriores
    googleClientId: googleClientId || null,

    // Compatibilidade (se algum ponto do front usar essa chave)
    GOOGLE_CLIENT_ID: googleClientId || null,

    // Debug útil (opcional, não expõe segredo)
    env: String(process.env.NODE_ENV || "").trim() || "development",
  });
});

module.exports = router;