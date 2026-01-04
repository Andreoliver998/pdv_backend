const crypto = require("crypto");

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const requestId =
    typeof incoming === "string" && incoming.trim()
      ? incoming.trim().slice(0, 64)
      : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  return next();
}

module.exports = { requestIdMiddleware };

