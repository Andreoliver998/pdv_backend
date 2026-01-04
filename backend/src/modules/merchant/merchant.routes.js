const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { ensureAuth } = require("../../middlewares/auth");
const controller = require("./merchantLogo.controller");

const router = Router();
router.use(ensureAuth);

const uploadsDir = path.join(__dirname, "../../../uploads");
const logosDir = path.join(uploadsDir, "logos");

if (!fs.existsSync(logosDir)) {
  fs.mkdirSync(logosDir, { recursive: true });
}

function extFromMime(mime) {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, logosDir);
  },
  filename: (req, file, cb) => {
    const merchantId = Number(req.user?.merchantId || 0);
    const ext = extFromMime(file.mimetype);
    cb(null, `merchant_${merchantId || "unknown"}_${Date.now()}${ext}`);
  },
});

const uploadLogo = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // hard limit 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      const err = new Error("Formato de imagem inv\u00e1lido. Use PNG, JPG ou WEBP.");
      err.statusCode = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// GET /api/merchant/logo
router.get("/logo", controller.getLogo);

// POST /api/merchant/logo (multipart/form-data, field: logo)
router.post("/logo", uploadLogo.single("logo"), controller.uploadLogo);

// DELETE /api/merchant/logo
router.delete("/logo", controller.deleteLogo);

module.exports = router;

