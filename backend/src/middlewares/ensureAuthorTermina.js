// backend/src/middlewares/ensureAuthOrTerminal.js
const { ensureAuth } = require('./auth');
const { ensureTerminal } = require('./terminalAuth');

async function ensureAuthOrTerminal(req, res, next) {
  const hasBearer = Boolean(req.headers.authorization);
  const hasApiKey = Boolean(req.headers['x-api-key']);

  if (hasBearer) {
    return ensureAuth(req, res, next);
  }

  if (hasApiKey) {
    return ensureTerminal(req, res, next);
  }

  return res.status(401).json({ message: 'Unauthenticated (no Bearer token or x-api-key)' });
}

module.exports = { ensureAuthOrTerminal };