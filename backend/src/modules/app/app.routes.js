// backend/src/modules/app/app.routes.js
const express = require("express");
const prisma = require("../../config/prisma");
const { ensureAuth } = require("../../middlewares/auth");

const router = express.Router();

/**
 * GET /api/app/config
 * - JWT obrigatório (USER ou TERMINAL) via ensureAuth
 * - Lê MerchantSettings por merchantId
 * - Retorna apenas flags/config leves para o App
 */
router.get("/config", ensureAuth, async (req, res, next) => {
  try {
    const merchantId = Number(req.user?.merchantId);

    if (!merchantId || Number.isNaN(merchantId)) {
      return res.status(401).json({ message: "UNAUTHENTICATED" });
    }

    const settings = await prisma.merchantSettings.findUnique({
      where: { merchantId },
      select: {
        stockEnabled: true,
        allowNegativeStock: true,
        decrementStockOnSale: true,
        allowCredit: true,
        allowDebit: true,
        allowPix: true,
        allowCash: true,
        defaultPayment: true,
      },
    });

    const stockEnabled = settings?.stockEnabled ?? true;

    return res.json({
      ui: {
        // ✅ Mudança mínima: exibição de estoque = stockEnabled
        showStock: stockEnabled,
      },
      stock: {
        stockEnabled,
        allowNegativeStock: settings?.allowNegativeStock ?? false,
        decrementStockOnSale: settings?.decrementStockOnSale ?? true,
      },
      payments: {
        allowCredit: settings?.allowCredit ?? true,
        allowDebit: settings?.allowDebit ?? true,
        allowPix: settings?.allowPix ?? true,
        allowCash: settings?.allowCash ?? true,
        defaultPayment: settings?.defaultPayment ?? "PIX",
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
