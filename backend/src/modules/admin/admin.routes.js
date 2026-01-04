const express = require("express");
const router = express.Router();

const controller = require("./admin.controller");
const { adminAuth, requireAdminRole } = require("../../middlewares/adminAuth");

router.post("/auth/login", controller.login);
router.post("/auth/bootstrap", controller.bootstrap);
router.post("/auth/forgot-password", controller.forgotPassword);
router.post("/auth/reset-password", controller.resetPassword);

// DEV-only: bootstrap do SUPER_ADMIN a partir de env (nao loga senha/hash)
router.post("/dev/bootstrap", controller.devBootstrap);

router.use(adminAuth);

router.get("/me", controller.me);
router.post("/me/password", controller.changePassword);
// Alias "profissional" (auth/change-password) para uso no Portal (mantém compat)
router.post("/auth/change-password", controller.changePassword);
router.get("/health", controller.health);

// Templates (listar: qualquer admin; criar/editar: SUPER_ADMIN)
router.get("/email-templates", requireAdminRole("SUPER_ADMIN", "SUPPORT", "FINANCE"), controller.listEmailTemplates);
router.post("/email-templates", requireAdminRole("SUPER_ADMIN"), controller.createEmailTemplate);
router.patch("/email-templates/:id", requireAdminRole("SUPER_ADMIN"), controller.patchEmailTemplate);

// Envio e histórico por merchant (qualquer admin role)
router.post("/merchants/:id/email", requireAdminRole("SUPER_ADMIN", "SUPPORT", "FINANCE"), controller.sendMerchantEmail);
router.get("/merchants/:id/emails", requireAdminRole("SUPER_ADMIN", "SUPPORT", "FINANCE"), controller.listMerchantEmails);

// Apenas SUPER_ADMIN pode gerenciar merchants/billing/audit (mantém regra atual)
router.use(requireAdminRole("SUPER_ADMIN"));
router.get("/merchants", controller.listMerchants);
router.get("/merchants/:id", controller.getMerchant);
router.patch("/merchants/:id/status", controller.patchMerchantStatus);
router.patch("/merchants/:id/access", controller.patchMerchantAccess);
router.patch("/merchants/:id", controller.patchMerchant);
router.post("/merchants/:id/suspend", controller.suspendMerchant);
router.post("/merchants/:id/unsuspend", controller.unsuspendMerchant);

// Aliases (compatibilidade de naming): "clients" == "merchants" (sem mudar a lÓgica interna)
router.get("/clients", controller.listMerchants);
router.get("/clients/:id", controller.getMerchant);
router.patch("/clients/:id/status", controller.patchMerchantStatus);
router.patch("/clients/:id/access", controller.patchMerchantAccess);
router.patch("/clients/:id", controller.patchMerchant);
router.post("/clients/:id/suspend", controller.suspendMerchant);
router.post("/clients/:id/unsuspend", controller.unsuspendMerchant);

// Ativar/desativar (alias simples): active=true -> ACTIVE, active=false -> SUSPENDED
router.patch("/clients/:id/activate", (req, res, next) => {
  const active = req.body?.active;
  if (active === true) req.body = { ...(req.body || {}), status: "ACTIVE" };
  if (active === false) req.body = { ...(req.body || {}), status: "SUSPENDED" };
  return controller.patchMerchantStatus(req, res, next);
});

// Billing
router.get("/merchants/:id/billing", controller.getMerchantBilling);
router.patch("/merchants/:id/billing", controller.patchMerchantBilling);
router.post("/merchants/:id/billing/mark-paid", controller.markMerchantPaid);
router.post("/merchants/:id/billing/extend", controller.extendMerchantBilling);

// Audit
router.get("/audit", controller.getAudit);
router.get("/merchants/:id/audit", controller.getMerchantAudit);

// System maintenance
router.get("/system/maintenance", controller.getSystemMaintenance);
router.post("/system/maintenance", controller.setSystemMaintenance);

module.exports = router;
