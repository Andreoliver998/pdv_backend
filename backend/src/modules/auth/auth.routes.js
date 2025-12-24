// backend/src/modules/auth/auth.routes.js
const express = require("express");
const router = express.Router();

const authController = require("./auth.controller");
const { ensureAuth } = require("../../middlewares/auth");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.get("/me", ensureAuth, authController.me);

module.exports = router;
