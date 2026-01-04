const { Router } = require("express");
const { ensureAuth } = require("../../middlewares/auth");
const controller = require("./merchantSettings.controller");

const router = Router();
router.use(ensureAuth);

// GET /api/merchant-settings
router.get("/", controller.get);

// PUT /api/merchant-settings (update parcial)
router.put("/", controller.update);

// ✅ muitos frontends usam PATCH para update parcial
router.patch("/", controller.update);

module.exports = router;
