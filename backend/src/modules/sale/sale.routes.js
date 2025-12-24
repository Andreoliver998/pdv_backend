const { Router } = require('express');
const { authOrTerminal } = require('../../middlewares/authOrTerminal');
const saleController = require('./sale.controller');

const router = Router();

// Aceita JWT (painel) OU x-terminal-key (maquininha)
router.use(authOrTerminal);

router.post('/', saleController.create);
router.patch('/:id/status', saleController.updateStatus);

module.exports = router;