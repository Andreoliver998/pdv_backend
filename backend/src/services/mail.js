// backend/src/services/mail.js
//
// Serviço de e-mail:
// - PROD: envia via SMTP (nodemailer)
// - DEV: se SMTP não estiver configurado, não quebra e mostra preview no console
//
// Regras:
// - Nunca logar senha
// - Em DEV sempre logar falhas de envio

function isProdEnv() {
  return String(process.env.NODE_ENV || "").trim() === "production";
}

function devMode() {
  return String(process.env.DEV_MODE_EMAIL || "").trim().toLowerCase();
}

function shouldDevLog() {
  return devMode() === "log";
}

function maskEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const [name, domain] = e.split("@");
  if (!name || !domain) return "";
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
}

function parseBoolEnv(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return null;
}

function redactTokenInUrl(url) {
  const s = String(url || "");
  return s.replace(/([?&]token=)[^&]+/gi, "$1<REDACTED>");
}

function redactSensitiveInText(text) {
  const s = String(text || "");
  return s.replace(/([?&]token=)[^\\s&]+/gi, "$1<REDACTED>");
}

// Importação lazy para não derrubar o servidor quando `nodemailer` ainda não foi instalado.
function tryRequireNodemailer() {
  try {
    // eslint-disable-next-line global-require
    return require("nodemailer");
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

function readSmtpConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 0) || 587;
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const fromRaw = String(process.env.SMTP_FROM || "").trim();
  const fromName = String(process.env.SMTP_FROM_NAME || "").trim();
  const fromEmail = String(process.env.SMTP_FROM_EMAIL || "").trim();

  // Sanitiza valores comuns vindos de `.env` com aspas extras.
  function sanitizeFrom(value) {
    let v = String(value || "").trim();
    // remove aspas em volta (caso estejam balanceadas)
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1).trim();
    // remove aspas sobrando no fim (caso de erro de digitação no .env)
    v = v.replace(/"+$/, "").trim();
    return v;
  }

  const from = sanitizeFrom(fromRaw) || (fromEmail ? `${fromName || "PDV"} <${fromEmail}>` : "");
  const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 0) || 10_000;
  const secureEnv = parseBoolEnv(process.env.SMTP_SECURE);

  return { host, port, user, pass, from, timeoutMs, secureEnv };
}

function hasSmtpConfig(cfg) {
  return Boolean(cfg.host && cfg.port && cfg.user && cfg.pass && cfg.from);
}

function summarizeSmtpConfig(cfg) {
  const host = String(cfg?.host || "");
  const port = Number(cfg?.port || 0) || 0;
  const secure = cfg?.secureEnv ?? port === 465;
  const from = String(cfg?.from || "");
  const user = String(cfg?.user || "");
  return { host, port, secure, from: from ? "<configured>" : "", user: user ? "<configured>" : "" };
}

let cachedTransport = null;
function getTransport() {
  if (cachedTransport) return cachedTransport;

  const cfg = readSmtpConfig();
  if (!hasSmtpConfig(cfg)) return null;

  const nodemailer = tryRequireNodemailer();
  if (!nodemailer) {
    const err = new Error("NODEMAILER_MISSING");
    err.code = "NODEMAILER_MISSING";
    throw err;
  }

  const secure = cfg.secureEnv ?? cfg.port === 465;
  const isGmail = String(cfg.host || "").toLowerCase() === "smtp.gmail.com";
  cachedTransport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // Gmail (587) exige STARTTLS; `requireTLS` melhora previsibilidade.
    ...(isGmail && !secure ? { requireTLS: true } : {}),
    connectionTimeout: cfg.timeoutMs,
    greetingTimeout: cfg.timeoutMs,
    socketTimeout: cfg.timeoutMs,
  });

  return cachedTransport;
}

async function verifySmtpOnce() {
  const cfg = readSmtpConfig();
  if (!hasSmtpConfig(cfg)) {
    console.warn("[MAIL] SMTP not configured (verify skipped)", summarizeSmtpConfig(cfg));
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  try {
    const transport = getTransport();
    await transport.verify();
    console.log("[MAIL] SMTP verify OK", summarizeSmtpConfig(cfg));
    return { ok: true };
  } catch (err) {
    console.error("[MAIL] SMTP verify FAIL", {
      ...summarizeSmtpConfig(cfg),
      code: err?.code,
      command: err?.command,
      response: err?.response,
      message: err?.message,
    });
    return { ok: false, reason: "VERIFY_FAILED" };
  }
}

function shouldRetry(err) {
  const code = String(err?.code || "").toUpperCase();
  const msg = String(err?.message || "");
  // Casos típicos de falha transitória
  if (["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ECONNREFUSED", "ENOTFOUND"].includes(code)) return true;
  if (msg.includes("Greeting never received")) return true;
  return false;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendMail({ to, subject, text, html }) {
  const cfg = readSmtpConfig();

  if (shouldDevLog()) {
    console.log("[DEV_LOG EMAIL] to=", maskEmail(to));
    console.log("[DEV_LOG EMAIL] subject=", String(subject || "").trim());
    const preview = String(text || html || "").trim().slice(0, 800);
    if (preview) console.log("[DEV_LOG EMAIL] preview=", redactSensitiveInText(preview));
    return { delivered: false, info: null, provider: "DEV_LOG" };
  }

  if (!hasSmtpConfig(cfg)) {
    console.warn("[MAIL] SMTP not configured; email will NOT be delivered", summarizeSmtpConfig(cfg));
    if (!isProdEnv()) {
      console.log(`[MAIL DEV] To=${maskEmail(to)} Subject=${subject}`);
      if (text) {
        const preview = redactSensitiveInText(text).split("\n").slice(0, 4).join(" | ");
        console.log(`[MAIL DEV] Preview: ${preview}`);
      }
    }
    return { delivered: false, info: null, provider: "NONE" };
  }

  const secure = cfg.secureEnv ?? cfg.port === 465;
  console.log("[MAIL] SMTP enabled", { host: cfg.host, port: cfg.port, secure, from: "<configured>" });
  console.log(`[MAIL] sending to=${maskEmail(to)} host=${cfg.host} port=${cfg.port} secure=${secure}`);

  const maxAttempts = 2;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const transport = getTransport();

      // Ajuda a diagnosticar credenciais/handshake (não bloqueia: erro aqui vira erro do envio)
      if (!isProdEnv() && attempt === 1) {
        await transport.verify();
      }

      const info = await transport.sendMail({
        from: cfg.from,
        to,
        subject,
        text,
        html,
      });

      console.log(`[MAIL] sent OK attempt=${attempt} messageId=${info?.messageId || ""}`);
      return { delivered: true, info, provider: "SMTP" };
    } catch (err) {
      lastErr = err;
      console.error("[MAIL] sent FAIL", {
        attempt,
        code: err?.code,
        command: err?.command,
        response: err?.response,
        message: err?.message,
      });

      // reset cache para forçar nova conexão no retry
      cachedTransport = null;

      if (attempt < maxAttempts && shouldRetry(err)) {
        await sleep(400 * attempt);
        continue;
      }
      throw err;
    }
  }

  // unreachable, mas mantém fluxo explícito
  throw lastErr || new Error("MAIL_SEND_FAILED");
}

async function sendResetEmail(toEmail, resetLink) {
  const to = String(toEmail || "").trim();
  const link = String(resetLink || "").trim();

  const subject = "Redefinição de senha";
  const text = `Você solicitou a redefinição de senha.\n\nAbra o link: ${link}\n\nSe não foi você, ignore este e-mail.`;
  const html = `
    <p>Você solicitou a redefinição de senha.</p>
    <p><a href="${link}">Clique aqui para redefinir sua senha</a></p>
    <p>Se não foi você, ignore este e-mail.</p>
  `.trim();

  const result = await sendMail({ to, subject, text, html });

  if (!result?.delivered) {
    // Fallback DEV: imprimir o link para copiar e testar localmente
    console.log(`[MAIL DEV] Reset link (token redacted): ${redactTokenInUrl(link)}`);
  }

  return result;
}

async function sendVerificationEmail(toEmail, verifyLink) {
  const to = String(toEmail || "").trim();
  const link = String(verifyLink || "").trim();

  const subject = "Confirme seu e-mail";
  const text = `Bem-vindo!\n\nPara ativar sua conta, confirme seu e-mail:\n${link}\n\nSe não foi você, ignore este e-mail.`;
  const html = `
    <p>Bem-vindo!</p>
    <p>Para ativar sua conta, confirme seu e-mail:</p>
    <p><a href="${link}">Confirmar e-mail</a></p>
    <p>Se não foi você, ignore este e-mail.</p>
  `.trim();

  const result = await sendMail({ to, subject, text, html });

  if (!result?.delivered) {
    // Fallback DEV: imprimir o link para copiar e testar localmente
    console.log(`[MAIL DEV] Verify link (token redacted): ${redactTokenInUrl(link)}`);
  }

  return result;
}

async function sendAdminResetEmail(toEmail, resetLink) {
  const to = String(toEmail || "").trim();
  const link = String(resetLink || "").trim();

  const subject = "Redefinição de senha (Admin)";
  const text = `Você solicitou a redefinição de senha do Portal do SuperDono.\n\nAbra o link: ${link}\n\nSe não foi você, ignore este e-mail.`;
  const html = `
    <p>Você solicitou a redefinição de senha do Portal do SuperDono.</p>
    <p><a href="${link}">Clique aqui para redefinir sua senha</a></p>
    <p>Se não foi você, ignore este e-mail.</p>
  `.trim();

  const result = await sendMail({ to, subject, text, html });

  if (!result?.delivered) {
    // Fallback DEV: imprimir o link para copiar e testar localmente
    console.log(`[MAIL DEV] Admin reset link (token redacted): ${redactTokenInUrl(link)}`);
  }

  return result;
}

module.exports = { sendMail, sendResetEmail, sendVerificationEmail, sendAdminResetEmail, verifySmtpOnce };
