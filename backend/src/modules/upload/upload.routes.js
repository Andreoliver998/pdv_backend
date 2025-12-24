const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const prisma = require("../../config/prisma");
const { ensureAuth } = require("../../middlewares/auth");

const router = Router();
router.use(ensureAuth);

/**
 * Pasta uploads
 */
const uploadsDir = path.join(__dirname, "../../../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Extensão segura pelo mimetype
 */
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

/**
 * Multer storage CORRETO
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = extFromMime(file.mimetype);
    cb(null, `product_${Date.now()}${ext}`);
  },
});

/**
 * Upload middleware
 */
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Formato de imagem inválido"));
    }
    cb(null, true);
  },
});

/**
 * POST /api/upload/product-image
 */
router.post("/product-image", upload.single("image"), async (req, res, next) => {
  try {
    const merchantId = req.user?.merchantId;
    const productId = Number(req.body?.productId);

    if (!merchantId) {
      return res.status(401).json({ message: "Unauthenticated" });
    }

    if (!productId || !req.file) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ message: "productId e image são obrigatórios" });
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, merchantId },
      select: { id: true, imageUrl: true },
    });

    if (!product) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ message: "Produto não encontrado" });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { imageUrl },
    });

    // Remove imagem antiga
    if (product.imageUrl?.startsWith("/uploads/")) {
      const oldFile = product.imageUrl.replace("/uploads/", "");
      const oldPath = path.join(uploadsDir, oldFile);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    return res.status(201).json({
      ok: true,
      imageUrl,
      publicUrl: `${req.protocol}://${req.get("host")}${imageUrl}`,
      product: updated,
    });
  } catch (err) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return next(err);
  }
});

module.exports = router;
