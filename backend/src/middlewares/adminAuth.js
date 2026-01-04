const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const [scheme, token] = String(authHeader).split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

function getAdminJwtSecret() {
  return String(process.env.ADMIN_JWT_SECRET || "").trim();
}

async function adminAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ message: "Token not provided" });

    const secret = getAdminJwtSecret();
    if (!secret) return res.status(500).json({ message: "ADMIN_JWT_SECRET not configured" });

    const payload = jwt.verify(token, secret);

    // Evita aceitar JWT de merchant (ou outro token) como admin
    if (payload?.type && payload.type !== "ADMIN") return res.status(401).json({ message: "Invalid token" });

    const adminIdRaw = payload?.sub ?? payload?.adminId ?? payload?.id;
    const adminId = Number(adminIdRaw);
    if (!adminId || Number.isNaN(adminId)) return res.status(401).json({ message: "Invalid token subject" });

    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    if (!admin) return res.status(401).json({ message: "Admin not found" });
    if (admin.isActive === false) return res.status(403).json({ message: "ADMIN_DISABLED" });

    req.admin = admin;
    return next();
  } catch (err) {
    if (err?.name === "TokenExpiredError") return res.status(401).json({ message: "Token expired" });
    return res.status(401).json({ message: "Invalid token" });
  }
}

function requireAdminRole(...roles) {
  const allowed = roles.filter(Boolean).map((r) => String(r).trim());
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ message: "UNAUTHENTICATED" });
    if (!allowed.length) return next();
    if (!allowed.includes(String(req.admin.role || ""))) return res.status(403).json({ message: "Forbidden" });
    return next();
  };
}

// Compat: mantém nome antigo usado no módulo atual
const ensureSuperAdmin = [adminAuth, requireAdminRole("SUPER_ADMIN")];

module.exports = { adminAuth, requireAdminRole, ensureSuperAdmin };
