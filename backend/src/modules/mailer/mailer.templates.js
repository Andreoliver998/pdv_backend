const DEFAULT_TEMPLATES = [
  {
    key: "PAYMENT_OVERDUE_1",
    subject: "Pagamento pendente - {{merchantName}}",
    bodyText:
      "Olá {{merchantName}},\n\nIdentificamos que seu pagamento está em atraso ({{overdueDays}} dias).\n\nPara regularizar, acesse: {{billingUrl}}\n\nSe já efetuou o pagamento, desconsidere esta mensagem.\nSuporte: {{supportEmail}}\n\nAtenciosamente,\nPayTech",
    bodyHtml:
      "<p>Olá <strong>{{merchantName}}</strong>,</p><p>Identificamos que seu pagamento está em atraso (<strong>{{overdueDays}}</strong> dias).</p><p>Para regularizar, acesse: <a href=\"{{billingUrl}}\">{{billingUrl}}</a></p><p>Se já efetuou o pagamento, desconsidere esta mensagem.</p><p><strong>Suporte:</strong> {{supportEmail}}</p><p>Atenciosamente,<br/>PayTech</p>",
  },
  {
    key: "PAYMENT_OVERDUE_2",
    subject: "Lembrete: pagamento em atraso - {{merchantName}}",
    bodyText:
      "Olá {{merchantName}},\n\nEste é um lembrete de que seu pagamento continua pendente ({{overdueDays}} dias).\n\nPara evitar interrupção do serviço, realize o pagamento: {{billingUrl}}\nSuporte: {{supportEmail}}\n\nAtenciosamente,\nPayTech",
    bodyHtml:
      "<p>Olá <strong>{{merchantName}}</strong>,</p><p>Este é um lembrete de que seu pagamento continua pendente (<strong>{{overdueDays}}</strong> dias).</p><p>Para evitar interrupção do serviço, realize o pagamento: <a href=\"{{billingUrl}}\">{{billingUrl}}</a></p><p><strong>Suporte:</strong> {{supportEmail}}</p><p>Atenciosamente,<br/>PayTech</p>",
  },
  {
    key: "SUSPENSION_WARNING",
    subject: "Aviso importante: suspensão iminente - {{merchantName}}",
    bodyText:
      "Olá {{merchantName}},\n\nSua conta está com pagamento em atraso ({{overdueDays}} dias) e poderá ser suspensa em breve.\n\nPara manter o serviço ativo, regularize: {{billingUrl}}\nSuporte: {{supportEmail}}\n\nAtenciosamente,\nPayTech",
    bodyHtml:
      "<p>Olá <strong>{{merchantName}}</strong>,</p><p>Sua conta está com pagamento em atraso (<strong>{{overdueDays}}</strong> dias) e poderá ser suspensa em breve.</p><p>Para manter o serviço ativo, regularize: <a href=\"{{billingUrl}}\">{{billingUrl}}</a></p><p><strong>Suporte:</strong> {{supportEmail}}</p><p>Atenciosamente,<br/>PayTech</p>",
  },
  {
    key: "ACCOUNT_SUSPENDED",
    subject: "Conta suspensa - {{merchantName}}",
    bodyText:
      "Olá {{merchantName}},\n\nSua conta foi suspensa por falta de pagamento.\n\nPara reativar, regularize o pagamento: {{billingUrl}}\nSuporte: {{supportEmail}}\n\nAtenciosamente,\nPayTech",
    bodyHtml:
      "<p>Olá <strong>{{merchantName}}</strong>,</p><p>Sua conta foi suspensa por falta de pagamento.</p><p>Para reativar, regularize o pagamento: <a href=\"{{billingUrl}}\">{{billingUrl}}</a></p><p><strong>Suporte:</strong> {{supportEmail}}</p><p>Atenciosamente,<br/>PayTech</p>",
  },
];

function interpolate(input, vars) {
  const s = String(input || "");
  return s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "";
    return v === null || v === undefined ? "" : String(v);
  });
}

module.exports = { DEFAULT_TEMPLATES, interpolate };

