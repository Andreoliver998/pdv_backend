// backend/src/routes/appConfigRoutes.js
const express = require("express");
const { ensureAuth } = require("../middlewares/auth");
const { getAppConfig } = require("../controllers/appConfigController");

const router = express.Router();

// JWT (USER ou TERMINAL)
router.get("/config", ensureAuth, getAppConfig);

module.exports = router;
