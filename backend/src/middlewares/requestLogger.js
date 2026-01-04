function isDev() {
  return String(process.env.NODE_ENV || "development").trim().toLowerCase() !== "production";
}

function safeString(v, maxLen = 200) {
  const s = String(v || "");
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

function requestLoggerMiddleware(req, res, next) {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;

    const ip = safeString(String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim(), 80);
    const userAgent = safeString(req.headers["user-agent"], 200);

    const line = {
      level: "info",
      type: "http",
      requestId: req.requestId || null,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ip: ip || null,
      userAgent: userAgent || null,
      merchantId: req.merchant?.id ?? req.user?.merchantId ?? req.terminal?.merchantId ?? null,
      terminalId: req.terminal?.id ?? null,
    };

    if (isDev()) {
      const origin = safeString(req.headers.origin, 200);
      if (origin) line.origin = origin;
    }

    console.log(JSON.stringify(line));
  });

  return next();
}

module.exports = { requestLoggerMiddleware };

