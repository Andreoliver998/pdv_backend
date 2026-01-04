const path = require("path");
const fs = require("fs");
const prisma = require("../../config/prisma");

const uploadsDir = path.join(__dirname, "../../../uploads");
const logosDir = path.join(uploadsDir, "logos");

function extractLocalLogoFilename(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;

  const marker = "/uploads/logos/";
  const idx = raw.indexOf(marker);
  if (idx === -1) return null;

  const filePart = raw.slice(idx + marker.length).split("?")[0].split("#")[0].trim();
  if (!filePart) return null;

  // Avoid traversal or nested paths
  if (filePart.includes("..") || filePart.includes("/") || filePart.includes("\\")) return null;

  return filePart;
}

function safeDeleteLogoFileByUrl(url) {
  const filename = extractLocalLogoFilename(url);
  if (!filename) return;
  const filePath = path.join(logosDir, filename);
  if (!filePath.startsWith(logosDir)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function ensureSettings(merchantId, tx = prisma) {
  const mid = Number(merchantId);
  return tx.merchantSettings.upsert({
    where: { merchantId: mid },
    update: {},
    create: { merchantId: mid },
  });
}

async function getLogo({ merchantId }) {
  const mid = Number(merchantId);
  const settings = await ensureSettings(mid);
  return { logoUrl: settings.logoUrl || null, logoUpdatedAt: settings.logoUpdatedAt || null };
}

async function setLogo({ merchantId, filename }) {
  const mid = Number(merchantId);
  const safeFilename = String(filename || "").trim();
  if (!safeFilename) {
    const err = new Error("filename is required");
    err.statusCode = 400;
    throw err;
  }

  const logoUrl = `/uploads/logos/${safeFilename}`;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const current = await ensureSettings(mid, tx);

    const updated = await tx.merchantSettings.update({
      where: { id: current.id },
      data: { logoUrl, logoUpdatedAt: now },
      select: { logoUrl: true, logoUpdatedAt: true },
    });

    return { updated, oldLogoUrl: current.logoUrl || null };
  });

  // Remove arquivo antigo fora da transa\u00e7\u00e3o
  if (result.oldLogoUrl && result.oldLogoUrl !== logoUrl) {
    safeDeleteLogoFileByUrl(result.oldLogoUrl);
  }

  return { logoUrl: result.updated.logoUrl || null, logoUpdatedAt: result.updated.logoUpdatedAt || null };
}

async function deleteLogo({ merchantId }) {
  const mid = Number(merchantId);

  const result = await prisma.$transaction(async (tx) => {
    const current = await ensureSettings(mid, tx);

    const oldLogoUrl = current.logoUrl || null;
    if (!oldLogoUrl) {
      return { oldLogoUrl: null, deleted: false };
    }

    await tx.merchantSettings.update({
      where: { id: current.id },
      data: { logoUrl: null, logoUpdatedAt: new Date() },
    });

    return { oldLogoUrl, deleted: true };
  });

  if (result.oldLogoUrl) safeDeleteLogoFileByUrl(result.oldLogoUrl);

  return { deleted: result.deleted };
}

module.exports = { getLogo, setLogo, deleteLogo };

