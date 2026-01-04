#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { sendMail, verifySmtpOnce } = require("../src/services/mail");

function readEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return dotenv.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function applyEnv(parsed) {
  if (!parsed) return;
  Object.entries(parsed).forEach(([key, value]) => {
    if (process.env[key] != null) return;
    process.env[key] = value;
  });
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { to: "", subject: "", text: "" };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a) continue;
    if (!out.to && !a.startsWith("--")) {
      out.to = a;
      continue;
    }
    if (a === "--to") out.to = args[++i] || "";
    else if (a === "--subject") out.subject = args[++i] || "";
    else if (a === "--text") out.text = args[++i] || "";
  }
  return out;
}

async function main() {
  // Carrega `.env` e `.env.local` (sem sobrescrever env já definido externamente)
  const envPath = path.join(__dirname, "..", ".env");
  const envLocalPath = path.join(__dirname, "..", ".env.local");
  applyEnv(readEnvFile(envPath));
  applyEnv(readEnvFile(envLocalPath));

  const { to, subject, text } = parseArgs(process.argv);

  if (!to) {
    console.log("Uso:");
    console.log("  node scripts/test-email.js destinatario@exemplo.com");
    console.log('  node scripts/test-email.js --to destinatario@exemplo.com --subject "Teste" --text "Olá"');
    process.exitCode = 1;
    return;
  }

  const check = await verifySmtpOnce();
  if (!check?.ok) {
    console.log("[test-email] SMTP verify não OK (veja logs acima). Mesmo assim vou tentar enviar...");
  }

  const result = await sendMail({
    to,
    subject: subject || "PDV - Teste de e-mail",
    text: text || `Teste de e-mail do PDV.\n\nTimestamp: ${new Date().toISOString()}`,
  });

  console.log("[test-email] result:", {
    delivered: Boolean(result?.delivered),
    provider: result?.provider || null,
    messageId: result?.info?.messageId || null,
  });
}

main().catch((err) => {
  console.error("[test-email] FAIL:", { message: err?.message, code: err?.code });
  process.exitCode = 1;
});

