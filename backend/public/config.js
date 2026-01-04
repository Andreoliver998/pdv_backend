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

  // API base
  if (!String(window.__APP_CONFIG__.API_BASE_URL ?? "").trim()) {
    const base = qsApiBase
      ? normalizeBase(qsApiBase)
      : normalizeBase(isLocal ? "http://127.0.0.1:3333" : "/api");

    window.__APP_CONFIG__.API_BASE_URL = base || (isLocal ? "http://127.0.0.1:3333" : "/api");
  } else {
    window.__APP_CONFIG__.API_BASE_URL = normalizeBase(window.__APP_CONFIG__.API_BASE_URL);
  }

  // Optional health override (app.js supports it)
  if (!String(window.__APP_CONFIG__.API_HEALTH_URL ?? "").trim()) {
    window.__APP_CONFIG__.API_HEALTH_URL = "";
  } else {
    window.__APP_CONFIG__.API_HEALTH_URL = normalizeBase(window.__APP_CONFIG__.API_HEALTH_URL);
  }

  // Google Client ID: prefer runtime load from /api/config/public; keep empty here by default
  if (!String(window.__APP_CONFIG__.GOOGLE_CLIENT_ID ?? "").trim()) {
    window.__APP_CONFIG__.GOOGLE_CLIENT_ID = "";
  }
})();