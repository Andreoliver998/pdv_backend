const { Router } = require("express");
const controller = require("./dev.controller");

const router = Router();

router.post("/reset", controller.reset);
router.post("/seed", controller.seed);
router.post("/verify-email", controller.verifyEmail);

module.exports = router;
