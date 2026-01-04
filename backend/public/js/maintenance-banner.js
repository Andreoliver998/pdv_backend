// Visual-only Maintenance Banner (non-blocking)
(function maintenanceBannerInit() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  function isLocalHost() {
    const hostname = String(window.location?.hostname || "").trim().toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]"
    );
  }

  function getApiBase() {
    const raw =
      (window.__APP_CONFIG__ && typeof window.__APP_CONFIG__ === "object"
        ? String(window.__APP_CONFIG__.API_BASE_URL || "")
        : "") || "";

    const v = raw.trim().replace(/\/+$/, "");

    // Sem config -> padrão seguro
    if (!v) return isLocalHost() ? "http://127.0.0.1:3333" : "/api";

    // Caminho relativo é sempre ok
    if (v.startsWith("/")) return v;

    // URL absoluta só é permitida em localhost
    if (!isLocalHost()) return "/api";

    return v;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function ensureBannerEl() {
    let el = document.getElementById("maintenanceBanner");
    if (el) {
      // Garante visibilidade mesmo quando o HTML original coloca o banner dentro de um container oculto (ex.: #appRoot display:none).
      if (el.parentElement !== document.body) {
        document.body.prepend(el);
      }
      return el;
    }

    el = document.createElement("div");
    el.id = "maintenanceBanner";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.display = "none";

    document.body.prepend(el);
    return el;
  }

  function ensureStyles() {
    if (document.getElementById("maintenanceBannerStyle")) return;
    const style = document.createElement("style");
    style.id = "maintenanceBannerStyle";
    style.textContent = `
#maintenanceBanner{
  position: sticky;
  top: 0;
  z-index: 9999;
  display: none;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(245, 158, 11, 0.5);
  background: rgba(15, 23, 42, 0.95);
  color: #fde68a;
  font: 600 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
}
#maintenanceBanner strong{ color:#fbbf24; }
`;
    document.head.appendChild(style);
  }

  function normalizeMaintenanceResponse(data) {
    const m = data && typeof data === "object" && data.maintenance && typeof data.maintenance === "object" ? data.maintenance : data;
    return {
      enabled: Boolean(m?.enabled),
      message: m?.message == null ? null : String(m.message).trim(),
      startsAt: m?.startsAt == null ? null : String(m.startsAt),
      endsAt: m?.endsAt == null ? null : String(m.endsAt),
    };
  }

  function render(maintenance) {
    ensureStyles();
    const banner = ensureBannerEl();

    if (!maintenance?.enabled) {
      banner.style.display = "none";
      banner.textContent = "";
      return;
    }

    const msg = maintenance.message || "";
    const extra = msg ? ` — ${escapeHtml(msg)}` : "";
    banner.style.display = "block";
    banner.innerHTML = `<strong>Sistema em manutenção</strong>${extra}`;
  }

  async function refresh() {
    try {
      const apiBase = getApiBase();
      const url = `${apiBase}/system/maintenance`;
      const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await res.json().catch(() => null);
      render(normalizeMaintenanceResponse(data));
    } catch {
      render({ enabled: false });
    }
  }

  function start() {
    if (window.__MAINTENANCE_BANNER_STARTED__) return;
    window.__MAINTENANCE_BANNER_STARTED__ = true;

    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh();
    });
    setInterval(refresh, 60 * 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
