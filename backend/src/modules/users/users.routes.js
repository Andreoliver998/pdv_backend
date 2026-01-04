const { Router } = require("express");
const { ensureAuth } = require("../../middlewares/auth");
const controller = require("./users.controller");

const router = Router();

router.use(ensureAuth);

router.get("/", controller.list);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.put("/:id/status", controller.updateStatus);

module.exports = router;
