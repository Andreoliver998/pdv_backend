const { Router } = require('express');
const { ensureAuth } = require('../../middlewares/auth');
const { ensureTerminal } = require('../../middlewares/terminalAuth');
const { createSlidingWindowLimiter } = require('../../middlewares/rateLimit');
const terminalController = require('./terminal.controller');

const router = Router();

// Anti-bruteforce: c�digos 6 d�gitos precisam de rate limit por IP e por c�digo.
const claimLimiter = createSlidingWindowLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const ip = String(req.ip || req.connection?.remoteAddress || '');
    const code = String(req.body?.code || req.body?.pairingCode || req.body?.pairing_code || '').trim() || '-';
    return `terminal:claim:${ip}:${code}`;
  },
});

const pairLimiter = createSlidingWindowLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const ip = String(req.ip || req.connection?.remoteAddress || '');
    const code = String(req.body?.pairingCode || req.body?.code || '').trim() || '-';
    return `terminal:pair:${ip}:${code}`;
  },
});

// Legado: ativação por identifier (retorna apiKey em texto puro)
router.post('/activate', ensureAuth, terminalController.activate);

// Painel (JWT)
router.get('/', ensureAuth, terminalController.list);
router.post('/', ensureAuth, terminalController.create);
router.post('/:id/pairing-code', ensureAuth, terminalController.createPairingCode);
router.post('/:id/revoke', ensureAuth, terminalController.revoke);

// Provisionamento (fase 2): gera código 6 dígitos sem criar terminal
router.post('/pairing-codes', ensureAuth, terminalController.createProvisioningCode);
router.get('/pairing-codes/:id', ensureAuth, terminalController.getProvisioningCode);

// Maquininha (pareamento + autenticação via X-Terminal-Key)
router.post('/pair', pairLimiter, terminalController.pair);
router.post('/claim', claimLimiter, terminalController.claimProvisioningCode);
router.get('/me', ensureTerminal, terminalController.me);
router.post('/heartbeat', ensureTerminal, terminalController.heartbeat);

module.exports = router;
