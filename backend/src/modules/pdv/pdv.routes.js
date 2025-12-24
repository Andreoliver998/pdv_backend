// backend/src/modules/pdv/pdv.routes.js
const { Router } = require('express');
const { ensureTerminal } = require('../../middlewares/terminalAuth');
const pdvController = require('./pdv.controller');

const router = Router();

router.use(ensureTerminal);

// PDV: lista produtos ativos do merchant do terminal
router.get('/products', pdvController.listProducts);

// PDV: cria venda do terminal (compra)
router.post('/sales', pdvController.createSale);

module.exports = router;