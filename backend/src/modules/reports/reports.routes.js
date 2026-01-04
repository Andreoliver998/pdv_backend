// backend/src/modules/reports/reports.routes.js
const { Router } = require('express');
const { ensureAuth } = require('../../middlewares/auth');
const reportsController = require('./reports.controller');

const router = Router();
router.use(ensureAuth);

// Resumo (total, count, avg, por pagamento)
router.get('/summary', reportsController.summary);

// Lista de vendas (para tabela)
router.get('/sales', reportsController.listSales);

// Top produtos
router.get('/top-products', reportsController.topProducts);

module.exports = router;