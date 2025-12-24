// backend/src/modules/terminal/terminal.controller.js
const {activateTerminal} = require('./terminal.service');

async function activate(req, res) {
  try {
    if (!req.user || !req.user.merchantId) {
      return res.status(401).json({ message: 'Unauthenticated' });
    }

    const { name, identifier } = req.body;

    const terminal = await activateTerminal({
      merchantId: req.user.merchantId,
      name,
      identifier,
    });

    // Retorna apiKey para o Android guardar e usar nas vendas
    return res.status(201).json({
      terminalId: terminal.id,
      apiKey: terminal.apiKey,
      name: terminal.name,
      identifier: terminal.identifier,
      merchantId: terminal.merchantId,
    });
  } catch (err) {
    const msg = err?.message || 'Error activating terminal';
    return res.status(400).json({ message: msg });
  }
}

module.exports = { activate };