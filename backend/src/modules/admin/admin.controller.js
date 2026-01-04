const adminService = require("./admin.service");

function getReqMeta(req) {
  return {
    ip: String(req.ip || req.connection?.remoteAddress || ""),
    userAgent: String(req.headers["user-agent"] || ""),
  };
}

function isDevEnv() {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() === "development";
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const result = await adminService.login({ email, password });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function bootstrap(req, res, next) {
  try {
    const headerToken = req.headers["x-bootstrap-token"];
    const { email, password, name } = req.body || {};
    const result = await adminService.bootstrapFirstSuperAdmin({ headerToken, email, password, name });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function devBootstrap(req, res, next) {
  try {
    if (!isDevEnv()) return res.status(404).json({ message: "Not found" });

    const result = await adminService.devBootstrapSuperAdminFromEnv();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function forgotPassword(req, res) {
  const { email } = req.body || {};
  try {
    await adminService.forgotPassword({ email });
  } catch (err) {
    // anti-enumeração: não vazar detalhes
  }
  return res.json({
    ok: true,
    message: "Se existir uma conta admin com este e-mail, enviaremos um link de redefinição.",
  });
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body || {};
    const result = await adminService.resetPassword({ token, newPassword });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function listEmailTemplates(req, res, next) {
  try {
    const result = await adminService.listEmailTemplates();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function createEmailTemplate(req, res, next) {
  try {
    const result = await adminService.createEmailTemplate(req.body || {});
    return res.status(201).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function patchEmailTemplate(req, res, next) {
  try {
    const result = await adminService.patchEmailTemplate({ id: req.params.id, patch: req.body || {} });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function sendMerchantEmail(req, res, next) {
  try {
    const result = await adminService.sendMerchantEmail({
      merchantId: req.params.id,
      adminId: req.admin?.id,
      templateKey: req.body?.templateKey,
      subject: req.body?.subject,
      message: req.body?.message,
      reason: req.body?.reason,
      metadata: req.body?.metadata,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function listMerchantEmails(req, res, next) {
  try {
    const result = await adminService.listMerchantEmails({
      merchantId: req.params.id,
      page: req.query?.page,
      limit: req.query?.limit,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function health(req, res) {
  return res.json({ ok: true, timestamp: new Date().toISOString(), admin: req.admin });
}

async function me(req, res) {
  return res.json({ ok: true, admin: req.admin });
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const result = await adminService.changePassword({
      adminId: req.admin?.id,
      currentPassword,
      newPassword,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function listMerchants(req, res, next) {
  try {
    const { status, search, query, sort } = req.query || {};
    const result = await adminService.listMerchants({ status, search, query, sort });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function patchMerchantStatus(req, res, next) {
  try {
    const result = await adminService.patchMerchantStatus({
      id: req.params.id,
      status: req.body?.status,
      reason: req.body?.reason,
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function patchMerchantAccess(req, res, next) {
  try {
    const result = await adminService.patchMerchantAccess({
      id: req.params.id,
      isLoginBlocked: req.body?.isLoginBlocked,
      reason: req.body?.reason,
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function getMerchant(req, res, next) {
  try {
    const result = await adminService.getMerchant({ id: req.params.id });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function patchMerchant(req, res, next) {
  try {
    const result = await adminService.patchMerchant({
      id: req.params.id,
      data: req.body || {},
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function suspendMerchant(req, res, next) {
  try {
    const result = await adminService.suspendMerchant({
      id: req.params.id,
      suspendedReason: req.body?.suspendedReason,
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function unsuspendMerchant(req, res, next) {
  try {
    const result = await adminService.unsuspendMerchant({ id: req.params.id, adminId: req.admin?.id, ...getReqMeta(req) });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function getMerchantBilling(req, res, next) {
  try {
    const result = await adminService.getMerchantBilling({ id: req.params.id });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function patchMerchantBilling(req, res, next) {
  try {
    const result = await adminService.patchMerchantBilling({
      id: req.params.id,
      patch: req.body || {},
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function markMerchantPaid(req, res, next) {
  try {
    const result = await adminService.markMerchantPaid({
      id: req.params.id,
      amountCents: req.body?.amountCents,
      note: req.body?.note,
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function extendMerchantBilling(req, res, next) {
  try {
    const result = await adminService.extendMerchantBilling({
      id: req.params.id,
      days: req.body?.days,
      note: req.body?.note,
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function getMerchantAudit(req, res, next) {
  try {
    const result = await adminService.getMerchantAudit({ id: req.params.id });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function getAudit(req, res, next) {
  try {
    const result = await adminService.getAudit({
      merchantId: req.query?.merchantId,
      take: req.query?.take,
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function getSystemMaintenance(req, res, next) {
  try {
    const result = await adminService.getSystemMaintenance();
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

async function setSystemMaintenance(req, res, next) {
  try {
    const result = await adminService.setSystemMaintenance({
      patch: req.body || {},
      adminId: req.admin?.id,
      ...getReqMeta(req),
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  login,
  bootstrap,
  devBootstrap,
  forgotPassword,
  resetPassword,
  listEmailTemplates,
  createEmailTemplate,
  patchEmailTemplate,
  sendMerchantEmail,
  listMerchantEmails,
  me,
  changePassword,
  health,
  listMerchants,
  getMerchant,
  patchMerchantStatus,
  patchMerchantAccess,
  patchMerchant,
  suspendMerchant,
  unsuspendMerchant,
  getMerchantBilling,
  patchMerchantBilling,
  markMerchantPaid,
  extendMerchantBilling,
  getAudit,
  getMerchantAudit,
  getSystemMaintenance,
  setSystemMaintenance,
};
