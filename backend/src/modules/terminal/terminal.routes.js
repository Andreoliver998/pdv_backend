const { Router } = require('express');
const { ensureAuth } = require('../../middlewares/auth');
const terminalController = require('./terminal.controller');

const router = Router();

// MODO A: ativação exige login do usuário
router.post('/activate', ensureAuth, terminalController.activate);

module.exports = router;