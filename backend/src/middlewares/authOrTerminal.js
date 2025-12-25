// backend/src/middlewares/authOrTerminal.js
const { ensureAuth } = require('./auth');
const { ensureTerminal } = require('./terminalAuth');

function authOrTerminal(req, res, next) {
  const hasTerminalKey =
    !!req.headers['x-terminal-key'] ||
    !!req.headers['x-terminal-api-key'] ||
    !!req.headers['x-api-key'];

  if (hasTerminalKey) {
    return ensureTerminal(req, res, next);
  }

  return ensureAuth(req, res, next);
}

module.exports = { authOrTerminal };