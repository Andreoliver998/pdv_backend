const prisma = require("../../config/prisma");
const { DEFAULT_TEMPLATES } = require("./mailer.templates");
const { sendEmail } = require("./mailer.provider");

function isDevEnv() {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() !== "production";
}

function isMissingTableError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || "");

  // Prisma: P2021 = table does not exist
  if (code === "P2021") return true;
  return msg.includes("does not exist");
}

async function ensureDefaultEmailTemplates() {
  // Opcional: pode ser desligado via env
  const enabled = String(process.env.EMAIL_TEMPLATES_SEED ?? "true").trim().toLowerCase() !== "false";
  if (!enabled) return { ok: true, seeded: 0 };

  // Se o Prisma Client estiver desatualizado (sem os models), não tenta seedar.
  if (!prisma.emailMessageTemplate || typeof prisma.emailMessageTemplate.upsert !== "function") {
    if (isDevEnv()) {
      console.warn(
        "[MAILER] Prisma Client sem EmailMessageTemplate. Rode `npx prisma generate` e aplique o schema no DB (db push)."
      );
    }
    return { ok: false, seeded: 0, reason: "PRISMA_CLIENT_OUTDATED" };
  }

  // Se o model ainda não existe no DB, o prisma vai lançar; não bloqueia o startup.
  let seeded = 0;
  for (const t of DEFAULT_TEMPLATES) {
    try {
      await prisma.emailMessageTemplate.upsert({
        where: { key: t.key },
        update: {},
        create: {
          key: t.key,
          subject: t.subject,
          bodyHtml: t.bodyHtml,
          bodyText: t.bodyText || null,
          isActive: true,
        },
      });
      seeded += 1;
    } catch (err) {
      if (isMissingTableError(err)) {
        if (isDevEnv()) {
          console.warn(
            "[MAILER] Tabela EmailMessageTemplate ausente no banco. Rode `npx prisma migrate deploy` (ou `npx prisma migrate dev`) para aplicar as migrations."
          );
        }
        return { ok: false, seeded, reason: "DB_TABLE_MISSING" };
      }
      if (isDevEnv()) {
        console.warn("[MAILER] could not seed template:", t.key, err?.message || err);
      }
      return { ok: false, seeded };
    }
  }

  return { ok: true, seeded };
}

module.exports = { sendEmail, ensureDefaultEmailTemplates };
