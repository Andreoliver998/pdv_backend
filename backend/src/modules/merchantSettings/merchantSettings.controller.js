// backend/src/modules/merchantSettings/merchantSettings.controller.js
const merchantSettingsService = require('./merchantSettings.service');

function requireAuth(req, res) {
  if (!req.user || !req.user.merchantId) {
    res.status(401).json({ message: 'Unauthenticated' });
    return false;
  }
  return true;
}

async function get(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const data = await merchantSettingsService.getSettings(req.user.merchantId);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    if (!requireAuth(req, res)) return;

    const patch = req.body || {};
    const data = await merchantSettingsService.updateSettings(req.user.merchantId, patch);
    return res.json(data);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  get,
  update,
};
