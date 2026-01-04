// backend/src/middlewares/errorHandler.js

function isProd() {
  return String(process.env.NODE_ENV || "").trim() === "production";
}

function errorHandler(err, req, res, next) {
  const requestId = req?.requestId || null;
  const status = Number(err?.statusCode || err?.status || 500) || 500;

  const errorId =
    status >= 500
      ? `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      : null;

  // Log estruturado (nunca logar Authorization/X-Terminal-Key).
  const logPayload = {
    level: "error",
    type: "error",
    requestId,
    errorId,
    status,
    code: String(err?.code || err?.name || "InternalError"),
    message: String(err?.message || "Internal server error"),
    path: req?.originalUrl,
    method: req?.method,
  };

  if (!isProd() && err?.stack) logPayload.stack = String(err.stack);
  console.error(JSON.stringify(logPayload));

  const message = String(err?.message || "Internal server error");

  const payload = {
    ok: false,
    requestId,
    ...(errorId ? { errorId } : {}),
    error: String(err?.code || err?.name || "InternalError"),
    message,
  };

  if (!isProd()) {
    payload.details = {
      path: req?.originalUrl,
      method: req?.method,
    };
    if (err?.stack) payload.stack = String(err.stack);
  }

  return res.status(status).json(payload);
}

module.exports = errorHandler;

