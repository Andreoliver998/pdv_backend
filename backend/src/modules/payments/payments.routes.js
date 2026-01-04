const { Router } = require('express');
const { authOrTerminal } = require('../../middlewares/authOrTerminal');
const paymentsController = require('./payments.controller');

const router = Router();

// Aceita JWT (painel) ou X-Terminal-Key (maquininha)
router.use(authOrTerminal);

router.post('/intents', paymentsController.createIntent);
router.get('/intents/:id', paymentsController.getIntent);

router.post('/intents/:id/confirm', paymentsController.confirmIntent);
router.post('/intents/:id/fail', paymentsController.failIntent);

// Callback gen�rico (ex.: retorno do app ap�s deep link)
router.post('/callback', paymentsController.callback);

// DEV-only (mock)
router.post('/intents/:id/mock-approve', paymentsController.mockApprove);
router.post('/intents/:id/mock-decline', paymentsController.mockDecline);

module.exports = router;
