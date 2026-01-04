// backend/public/config.js
// Runtime config (no build) for DEV/PROD.
// - PROD: uses "/api" (same-origin via Nginx reverse proxy) to avoid CORS/mixed-content.
// - DEV (localhost): defaults to local API.
// Note: Google login prefers loading the Client ID from `GET /api/config/public` (env: GOOGLE_CLIENT_ID).

(function initRuntimeConfig() {
  if (typeof window === "undefined") return;

  if (!window.__APP_CONFIG__ || typeof window.__APP_CONFIG__ !== "object") {
    window.__APP_CONFIG__ = {};
  }

  const hostname = String(window.location?.hostname || "").trim().toLowerCase();
  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]";

  let qsApiBase = "";
  try {
    const u = new URL(window.location.href);
    qsApiBase = String(u.searchParams.get("apiBase") || "").trim();
  } catch (_) {
    qsApiBase = "";
  }

  function normalizeBase(v) {
    let raw = String(v || "").trim();
    if (!raw) return "";

    // Reject obviously unsafe protocols
    const lower = raw.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("data:")) return "";

    // If user passed "api" (no slash), treat as "/api"
    if (!raw.startsWith("/") && !raw.startsWith("http://") && !raw.startsWith("https://")) {
      raw = "/" + raw;
    }

    // Remove trailing slashes
    raw = raw.replace(/\/+$/, "");

    return raw;
  }

  function coerceSafeApiBase(input) {
    const normalized = normalizeBase(input);
    if (!normalized) return "";

    if (isLocal) return normalized;

    // Em produção (host não-local), nunca permitir base absoluta (evita 127.0.0.1 e URLs externas).
    // Forçar uso do proxy reverso na mesma origem.
    if (normalized.startsWith("/")) return normalized;
    return "/api";
  }

  // API base (DEV vs PROD)
  const existing = String(window.__APP_CONFIG__.API_BASE_URL ?? "").trim();
  if (existing) {
    window.__APP_CONFIG__.API_BASE_URL = coerceSafeApiBase(existing) || (isLocal ? "http://127.0.0.1:3333" : "/api");
  } else if (qsApiBase) {
    window.__APP_CONFIG__.API_BASE_URL = coerceSafeApiBase(qsApiBase) || (isLocal ? "http://127.0.0.1:3333" : "/api");
  } else {
    window.__APP_CONFIG__.API_BASE_URL = isLocal ? "http://127.0.0.1:3333" : "/api";
  }

  // Optional health override (app.js supports it)
  if (!String(window.__APP_CONFIG__.API_HEALTH_URL ?? "").trim()) {
    window.__APP_CONFIG__.API_HEALTH_URL = "";
  } else {
    const normalized = normalizeBase(window.__APP_CONFIG__.API_HEALTH_URL);
    // Em produção (host não-local), permitir apenas caminho relativo (mesma origem).
    window.__APP_CONFIG__.API_HEALTH_URL = isLocal ? normalized : normalized.startsWith("/") ? normalized : "";
  }

  // Google Client ID: prefer runtime load from /api/config/public; keep empty here by default
  if (!String(window.__APP_CONFIG__.GOOGLE_CLIENT_ID ?? "").trim()) {
    window.__APP_CONFIG__.GOOGLE_CLIENT_ID = "";
  }
})();
