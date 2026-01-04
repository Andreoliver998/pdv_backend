// backend/src/middlewares/rateLimit.js
//
// Rate limit simples (in-memory) para evitar abuso em endpoints sensíveis.
// - Sem dependências externas
// - Suficiente para DEV/VPS single-instance
// - Se futuramente rodar com múltiplas instâncias, substitua por Redis

function createSlidingWindowLimiter({ windowMs, max, keyFn, onLimit }) {
  const hits = new Map(); // key -> number[]

  const win = Number(windowMs) || 60_000;
  const limit = Number(max) || 10;
  const keyFactory = typeof keyFn === "function" ? keyFn : () => "global";

  function prune(now, arr) {
    const threshold = now - win;
    let i = 0;
    while (i < arr.length && arr[i] <= threshold) i += 1;
    if (i > 0) arr.splice(0, i);
    return arr;
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = String(keyFactory(req) || "global");

    const arr = hits.get(key) || [];
    prune(now, arr);
    arr.push(now);
    hits.set(key, arr);

    if (arr.length > limit) {
      if (typeof onLimit === "function") return onLimit(req, res, next);
      return res.status(429).json({
        ok: false,
        error: "RateLimited",
        message: "Muitas tentativas. Tente novamente em alguns minutos.",
      });
    }

    return next();
  };
}

module.exports = { createSlidingWindowLimiter };

