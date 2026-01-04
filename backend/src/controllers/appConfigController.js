// backend/src/controllers/appConfigController.js
const prisma = require("../config/prisma");

/**
 * GET /api/app/config
 * Retorna configurações leves para o App (UI/flags), sem dados sensíveis.
 *
 * Auth: JWT (USER ou TERMINAL) via ensureAuth
 * Fonte: MerchantSettings (por merchantId)
 */
async function getAppConfig(req, res, next) {
  try {
    const merchantId = Number(req.user?.merchantId);

    if (!merchantId || Number.isNaN(merchantId)) {
      return res.status(401).json({ message: "UNAUTHENTICATED" });
    }

    const settings = await prisma.merchantSettings.findUnique({
      where: { merchantId },
      select: {
        // UI / estoque
        stockEnabled: true,
        allowNegativeStock: true,
        decrementStockOnSale: true,

        // pagamentos
        allowCredit: true,
        allowDebit: true,
        allowPix: true,
        allowCash: true,
        defaultPayment: true,

        // relatórios (opcional, mas útil)
        reportsDefaultRange: true,
        reportsMaxRows: true,
      },
    });

    // ✅ Defaults seguros (caso settings ainda não exista)
    const stockEnabled = settings?.stockEnabled ?? true;

    return res.json({
      ui: {
        /**
         * ✅ Aqui está o “pulo do gato”:
         * O app usa showStock para mostrar/ocultar "Estoque: X" na UI.
         * Por mudança mínima, mapeamos showStock = stockEnabled.
         */
        showStock: stockEnabled,
      },

      stock: {
        stockEnabled: stockEnabled,
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

      reports: {
        defaultRange: settings?.reportsDefaultRange ?? "today",
        maxRows: settings?.reportsMaxRows ?? 100,
      },
    });
  } catch (err) {
    return next(err);
  }
}

module.exports = { getAppConfig };
