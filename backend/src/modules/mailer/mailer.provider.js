const { sendMail } = require("../../services/mail");
const { escapeHtml } = require("./mailer.validators");

function devMode() {
  return String(process.env.DEV_MODE_EMAIL || "").trim().toLowerCase();
}

function shouldDevLog() {
  return devMode() === "log";
}

function buildHtmlFromText(text) {
  const safe = escapeHtml(text).replace(/\r?\n/g, "<br/>");
  return `<div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4">${safe}</div>`;
}

async function sendEmail({ to, subject, text, html }) {
  const toEmail = String(to || "").trim();
  const subj = String(subject || "").trim();

  const textBody = String(text || "").trim();
  const htmlBody = String(html || "").trim() || (textBody ? buildHtmlFromText(textBody) : "");

  if (shouldDevLog()) {
    console.log("[DEV_LOG EMAIL] to=", toEmail);
    console.log("[DEV_LOG EMAIL] subject=", subj);
    if (textBody) console.log("[DEV_LOG EMAIL] text=", textBody.slice(0, 800));
    else console.log("[DEV_LOG EMAIL] html=", htmlBody.slice(0, 800));
    return { provider: "DEV_LOG", providerMessageId: null };
  }

  const result = await sendMail({
    to: toEmail,
    subject: subj,
    text: textBody || undefined,
    html: htmlBody || undefined,
  });

  return { provider: "SMTP", providerMessageId: result?.info?.messageId || null };
}

module.exports = { sendEmail };

