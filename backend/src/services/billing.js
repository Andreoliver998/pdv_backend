const prisma = require("../config/prisma");

function now() {
  return new Date();
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  return new Date(date.getTime() + Number(days) * 24 * 60 * 60 * 1000);
}

function normalizePlan(plan) {
  const p = String(plan || "").trim().toUpperCase();
  if (p === "FREE" || p === "BASIC" || p === "PRO") return p;
  return null;
}

function normalizeSubStatus(status) {
  const s = String(status || "").trim().toUpperCase();
  if (s === "ACTIVE" || s === "OVERDUE" || s === "SUSPENDED") return s;
  return null;
}

async function ensureSubscriptionForMerchant({ merchantId }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error("Invalid merchantId");

  const existing = await prisma.subscription.findUnique({ where: { merchantId: mId } });
  if (existing) return existing;

  return prisma.subscription.create({
    data: {
      merchantId: mId,
      plan: "FREE",
      status: "ACTIVE",
      billingDueAt: null,
      graceDays: 3,
    },
  });
}

async function getBilling({ merchantId }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error("Invalid merchantId");

  const subscription = await ensureSubscriptionForMerchant({ merchantId: mId });
  const events = await prisma.billingEvent.findMany({
    where: { merchantId: mId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, type: true, amountCents: true, note: true, createdByAdminId: true, createdAt: true },
  });

  return { subscription, events };
}

async function patchBilling({ merchantId, patch, createdByAdminId = null }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error("Invalid merchantId");

  const subscription = await ensureSubscriptionForMerchant({ merchantId: mId });

  const update = {};

  if (patch.plan !== undefined) {
    const p = normalizePlan(patch.plan);
    if (!p) throw new Error("Invalid plan");
    update.plan = p;
  }

  if (patch.status !== undefined) {
    const s = normalizeSubStatus(patch.status);
    if (!s) throw new Error("Invalid subscription status");
    update.status = s;
  }

  if (patch.graceDays !== undefined) {
    const g = Number(patch.graceDays);
    if (!Number.isFinite(g) || g < 0 || g > 30) throw new Error("Invalid graceDays");
    update.graceDays = Math.floor(g);
  }

  if (patch.billingDueAt !== undefined) {
    if (patch.billingDueAt === null || patch.billingDueAt === "") {
      update.billingDueAt = null;
    } else {
      const d = new Date(patch.billingDueAt);
      if (Number.isNaN(d.getTime())) throw new Error("Invalid billingDueAt");
      update.billingDueAt = d;
    }
  }

  const updated = await prisma.subscription.update({
    where: { merchantId: mId },
    data: update,
  });

  // Espelha dados principais no Merchant (compatibilidade com fase 1)
  const merchantPatch = {};
  if (update.billingDueAt !== undefined) merchantPatch.billingDueAt = update.billingDueAt;
  if (update.status !== undefined) {
    merchantPatch.status = update.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
    if (update.status !== "SUSPENDED") merchantPatch.suspendedReason = null;
  }

  if (Object.keys(merchantPatch).length) {
    await prisma.merchant.update({ where: { id: mId }, data: merchantPatch });
  }

  if (update.plan !== undefined) {
    await prisma.billingEvent.create({
      data: {
        merchantId: mId,
        type: "PLAN_CHANGE",
        note: "Subscription updated",
        createdByAdminId: createdByAdminId ? Number(createdByAdminId) : null,
      },
    });
  }

  return updated;
}

async function markPaid({ merchantId, amountCents, note, createdByAdminId = null }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error("Invalid merchantId");
  const cents = amountCents == null ? null : Number(amountCents);
  if (cents != null && (!Number.isFinite(cents) || cents < 0)) throw new Error("Invalid amountCents");

  const subscription = await ensureSubscriptionForMerchant({ merchantId: mId });

  // Regra MVP: marcar pago => status ACTIVE e due = hoje (início do dia) + 30 dias
  const newDue = addDays(startOfDay(now()), 30);

  const updated = await prisma.subscription.update({
    where: { merchantId: mId },
    data: { status: "ACTIVE", billingDueAt: newDue },
  });

  await prisma.merchant.update({
    where: { id: mId },
    data: { status: "ACTIVE", billingDueAt: newDue, suspendedReason: null },
  });

  await prisma.billingEvent.create({
    data: {
      merchantId: mId,
      type: "PAYMENT",
      amountCents: cents == null ? null : Math.floor(cents),
      note: String(note || "").trim() || null,
      createdByAdminId: createdByAdminId ? Number(createdByAdminId) : null,
    },
  });

  return { previous: subscription, subscription: updated };
}

async function extendDue({ merchantId, days, note, createdByAdminId = null }) {
  const mId = Number(merchantId);
  if (!mId) throw new Error("Invalid merchantId");

  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0 || d > 365) throw new Error("Invalid days");

  const subscription = await ensureSubscriptionForMerchant({ merchantId: mId });
  const base = subscription.billingDueAt ? new Date(subscription.billingDueAt) : startOfDay(now());
  const newDue = addDays(base, Math.floor(d));

  const updated = await prisma.subscription.update({
    where: { merchantId: mId },
    data: { billingDueAt: newDue, status: "ACTIVE" },
  });

  await prisma.merchant.update({
    where: { id: mId },
    data: { status: "ACTIVE", billingDueAt: newDue, suspendedReason: null },
  });

  await prisma.billingEvent.create({
    data: {
      merchantId: mId,
      type: "EXTEND_DUE",
      note: (String(note || "").trim() ? `${String(note).trim()} ` : "") + `(+${Math.floor(d)} days)`,
      createdByAdminId: createdByAdminId ? Number(createdByAdminId) : null,
    },
  });

  return { previous: subscription, subscription: updated };
}

async function billingSweepOnce() {
  const subscriptions = await prisma.subscription.findMany({
    where: { status: { in: ["ACTIVE", "OVERDUE"] } },
    select: { merchantId: true, billingDueAt: true, graceDays: true, status: true },
    take: 2000,
  });

  const nowDate = now();

  for (const sub of subscriptions) {
    if (!sub.billingDueAt) continue;
    const due = new Date(sub.billingDueAt);
    const grace = Number(sub.graceDays || 0);
    const cutoff = addDays(due, grace);

    if (cutoff < nowDate) {
      // Suspende (idempotente)
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { merchantId: sub.merchantId },
          data: { status: "SUSPENDED" },
        });
        await tx.merchant.update({
          where: { id: sub.merchantId },
          data: { status: "SUSPENDED", suspendedReason: "Fatura vencida. Contate o suporte." },
        });
        await tx.billingEvent.create({
          data: {
            merchantId: sub.merchantId,
            type: "SUSPEND",
            note: "Auto-suspend by billing sweep",
            createdByAdminId: null,
          },
        });
      });
    } else if (due < nowDate) {
      // Ainda dentro da carencia: marca overdue (na assinatura)
      if (sub.status !== "OVERDUE") {
        await prisma.subscription.update({
          where: { merchantId: sub.merchantId },
          data: { status: "OVERDUE" },
        });
      }
    } else {
      // Em dia
      if (sub.status === "OVERDUE") {
        await prisma.subscription.update({
          where: { merchantId: sub.merchantId },
          data: { status: "ACTIVE" },
        });
      }
    }
  }
}

module.exports = {
  ensureSubscriptionForMerchant,
  getBilling,
  patchBilling,
  markPaid,
  extendDue,
  billingSweepOnce,
};
