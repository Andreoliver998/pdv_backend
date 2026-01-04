/* =========================
   PDV – Painel Web (app.js)
   Completo — robustez, UX, Auth (Login/Register) e exportação (CSV/Excel) PT-BR
   Alinhado ao index.html fornecido pelo Sr. André
========================= */

/* =========================
   CONFIG
========================= */

/**
 * Em produção, você pode injetar window.API_BASE antes do App.js carregar.
 * Correção: remover IP fixo e usar caminho relativo (/api) para proxy reverso.
 *
 * Regras:
 * - Prod: consumimos "/api" na mesma origem (proxy).
 * - Dev: se precisar apontar para API local, use window.API_BASE ou API_ORIGIN.
 * - Se window.API_BASE existir -> usa ele (ex.: host/porta custom em DEV).
 */
// Base única para DEV e PROD (via Nginx)
const ensureRuntimeConfig = () => {
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

  // Backward compatibility: suportar injeção antiga via `window.API_BASE` / `window.API_HEALTH`
  if (
    !String(window.__APP_CONFIG__.API_BASE_URL ?? "").trim() &&
    typeof window.API_BASE === "string" &&
    window.API_BASE.trim()
  ) {
    window.__APP_CONFIG__.API_BASE_URL = window.API_BASE.trim();
  }

  // Mantém compatibilidade com API_HEALTH antigo, mas com saneamento depois
  if (
    !String(window.__APP_CONFIG__.API_HEALTH_URL ?? "").trim() &&
    typeof window.__APP_CONFIG__.API_HEALTH === "string" &&
    window.__APP_CONFIG__.API_HEALTH.trim()
  ) {
    window.__APP_CONFIG__.API_HEALTH_URL = window.__APP_CONFIG__.API_HEALTH.trim();
  }

  if (
    !String(window.__APP_CONFIG__.API_HEALTH_URL ?? "").trim() &&
    typeof window.API_HEALTH === "string" &&
    window.API_HEALTH.trim()
  ) {
    window.__APP_CONFIG__.API_HEALTH_URL = window.API_HEALTH.trim();
  }

  // --- Saneamento: PROD nunca pode apontar para host/URL absoluta ---
  // Em produção, força usar proxy reverso na mesma origem: "/api"
  const rawBase = String(window.__APP_CONFIG__.API_BASE_URL ?? "").trim();

  if (!rawBase) {
    window.__APP_CONFIG__.API_BASE_URL = isLocal ? "http://127.0.0.1:3333" : "/api";
  } else {
    // Se é produção e a base NÃO começa com "/", bloqueia e força "/api"
    if (!isLocal && !rawBase.startsWith("/")) {
      window.__APP_CONFIG__.API_BASE_URL = "/api";
    }
  }

  // Health: se for produção, só aceita path relativo (ou vazio)
  const rawHealth = String(window.__APP_CONFIG__.API_HEALTH_URL ?? "").trim();
  if (rawHealth) {
    if (!isLocal && !rawHealth.startsWith("/")) {
      window.__APP_CONFIG__.API_HEALTH_URL = "";
    }
  }
};

ensureRuntimeConfig();
const API_ORIGIN = (() => {
  if (typeof window === "undefined") return "";
  const hostname = String(window.location?.hostname || "").trim().toLowerCase();
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]";
  const raw = String(window.__APP_CONFIG__?.API_BASE_URL ?? "").trim().replace(/\/$/, "");
  let apiOrigin = "";
  if (!isLocalHost && raw && !raw.startsWith("/")) return "";
  if (raw && !raw.startsWith("/")) {
    try {
      apiOrigin = new URL(raw).origin;
    } catch {}
  }
  // Prod: string vazia força uso do proxy reverso (/api) na mesma origem
  return apiOrigin;
})();
const API_BASE = (() => {
  const hostname = typeof window !== "undefined" ? String(window.location?.hostname || "").trim().toLowerCase() : "";
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]";
  const raw = String(window.__APP_CONFIG__?.API_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!raw) return "/api";
  if (raw.startsWith("/")) return raw;
  if (!isLocalHost) return "/api";

  try {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === "/") url.pathname = "/api";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
})();
const API_HEALTH = (() => {
  const injected = String(
    window.__APP_CONFIG__?.API_HEALTH_URL ?? window.__APP_CONFIG__?.API_HEALTH ?? ""
  ).trim();
  const base = injected || `${API_BASE}/health`;
  return base.replace(/\/$/, "");
})();
const MOCK_MODE = typeof window !== "undefined" && window.MOCK_MODE === true;
let mockApiFetchImpl = null;
let mockApiUploadImpl = null;

let products = [];
let cart = [];
let cachedSalesForExport = [];

// Produtos (painel)
let cachedProductsForPanel = [];
let editingProductId = null;

// Merchant Settings
let merchantSettings = null;

// System maintenance banner (public endpoint)
let maintenanceIntervalId = null;

// Estado UI
let isBusy = false;

// Auth Mode
let authMode = "login"; // "login" | "register"

/* =========================
   CATEGORIAS (DINÂMICAS)
========================= */

function normalizeCategoryKey(input) {
  const s = String(input ?? "").trim();
  if (!s) return "uncategorized";
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeCategoryLabel(input) {
  const s = String(input ?? "").trim();
  return s || "Sem categoria";
}

function getCategoriesFromProducts(list) {
  const map = new Map(); // key -> label
  (list || [])
    .filter((p) => p && p.active !== false)
    .forEach((p) => {
      const raw = p.category;
      const label = normalizeCategoryLabel(raw);
      const key = normalizeCategoryKey(raw);
      if (!map.has(key)) map.set(key, label);
    });

  return Array.from(map.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
}

function getActiveCategory() {
  const bar = document.getElementById("categoryBar");
  const active = bar?.querySelector(".category.active");
  return active?.getAttribute("data-category") || "all";
}

function setActiveCategory(categoryKey) {
  const bar = document.getElementById("categoryBar");
  if (!bar) return;

  const btn = bar.querySelector(`.category[data-category="${CSS.escape(categoryKey)}"]`);
  const fallback = bar.querySelector(`.category[data-category="all"]`);
  const next = btn || fallback;

  bar.querySelectorAll(".category").forEach((b) => b.classList.toggle("active", b === next));
}

function buildCategoryBar(list) {
  const bar = document.getElementById("categoryBar");
  if (!bar) return;

  const prevActive = getActiveCategory();
  const cats = getCategoriesFromProducts(list);

  // Sempre existe "Todos"
  const buttons = [{ key: "all", label: "Todos" }, ...cats];

  bar.innerHTML = buttons
    .map(
      (c) =>
        `<button class="category" data-category="${escapeHtml(c.key)}" type="button">${escapeHtml(
          c.label
        )}</button>`
    )
    .join("");

  const exists = buttons.some((b) => b.key === prevActive);
  setActiveCategory(exists ? prevActive : "all");
}

/* =========================
   HELPERS (UI / Dados)
========================= */

function moneyBR(v) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v || 0));
}

function isoToBR(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR");
}

function resolveImageUrl(imageUrl, fallbackName = "Produto") {
  if (!imageUrl) return `https://via.placeholder.com/200x150?text=${encodeURIComponent(fallbackName)}`;
  const src = String(imageUrl);
  if (src.startsWith("blob:") || src.startsWith("data:")) return src;
  if (src.startsWith("http")) return src;
  if (src.startsWith("/uploads/")) return `${API_ORIGIN}${src}`;
  if (src.startsWith("uploads/")) return `${API_ORIGIN}/${src}`;
  return `${API_ORIGIN}/${src.replace(/^\//, "")}`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[;"\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function getToken() {
  return localStorage.getItem("token");
}
function setToken(t) {
  localStorage.setItem("token", t);
}
function clearToken() {
  localStorage.removeItem("token");
}

const MERCHANT_LOGO_KEY = "merchantLogoUrl";

function readMerchantLogoUrl() {
  return localStorage.getItem(MERCHANT_LOGO_KEY) || "";
}

function setMerchantLogoInDom(url) {
  const img = document.getElementById("merchantLogoImg");
  if (!img) return;

  const u = String(url || "").trim();
  if (!u) {
    img.removeAttribute("src");
    img.style.display = "none";
    return;
  }

  img.src = u;
  img.style.display = "block";
}

function setMerchantLogoUrl(url) {
  const u = String(url || "").trim();
  if (u) localStorage.setItem(MERCHANT_LOGO_KEY, u);
  else localStorage.removeItem(MERCHANT_LOGO_KEY);
  setMerchantLogoInDom(u);
}

function setSessionInfo(user, merchant) {
  if (user?.name) localStorage.setItem("userName", user.name);
  if (merchant?.name) localStorage.setItem("merchantName", merchant.name);
}

function readSessionInfo() {
  return {
    userName: localStorage.getItem("userName") || "",
    merchantName: localStorage.getItem("merchantName") || "",
  };
}

function setApiStatus(isOnline, text) {
  const dot = document.getElementById("apiDot");
  const label = document.getElementById("apiStatusText");
  if (dot) dot.style.background = isOnline ? "#22c55e" : "#ef4444";
  if (label) label.textContent = text || (isOnline ? "API: Online" : "API: Offline");
}

function setMaintenanceBanner(maintenance) {
  const banner = document.getElementById("maintenanceBanner");
  if (!banner) return;

  const enabled = Boolean(maintenance?.enabled);
  if (!enabled) {
    banner.style.display = "none";
    banner.textContent = "";
    return;
  }

  const msg = String(maintenance?.message || "").trim() || "Sistema em manutenção. Algumas funções podem ficar indisponíveis.";
  banner.style.display = "block";
  banner.innerHTML = `<strong>Manutenção:</strong> ${escapeHtml(msg)}`;
}

async function fetchMaintenanceOnce() {
  if (MOCK_MODE) return setMaintenanceBanner({ enabled: false });
  try {
    const res = await fetch(`${API_BASE}/system/maintenance`, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = await res.json().catch(() => null);
    setMaintenanceBanner(data?.maintenance || data || { enabled: false });
  } catch {
    // Silencioso: não travar o painel se a chamada falhar.
    setMaintenanceBanner({ enabled: false });
  }
}

function startMaintenancePolling() {
  if (maintenanceIntervalId) return;
  fetchMaintenanceOnce();
  maintenanceIntervalId = setInterval(fetchMaintenanceOnce, 60 * 1000);
}

function stopMaintenancePolling() {
  if (!maintenanceIntervalId) return;
  clearInterval(maintenanceIntervalId);
  maintenanceIntervalId = null;
  setMaintenanceBanner({ enabled: false });
}

/* =========================
   AUTH UI
========================= */

function setAuthMsg(mode, text) {
  const el = document.getElementById(mode === "register" ? "registerMsg" : "loginMsg");
  if (el) el.textContent = text || "";
}

function setGoogleMsg(text) {
  const ids = ["googleMsgLogin", "googleMsgRegister"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text || "";
  });
}

function clearAuthMsgs() {
  setAuthMsg("login", "");
  setAuthMsg("register", "");
  setGoogleMsg("");
  setResendVerificationVisible(false);
}

function setResendVerificationVisible(visible) {
  const btn = document.getElementById("resendVerificationBtn");
  if (!btn) return;
  btn.style.display = visible ? "block" : "none";
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  clearAuthMsgs();

  const tabLogin = document.getElementById("tabLoginBtn");
  const tabRegister = document.getElementById("tabRegisterBtn");

  if (tabLogin) {
    tabLogin.classList.toggle("active", authMode === "login");
    tabLogin.setAttribute("aria-selected", authMode === "login" ? "true" : "false");
    tabLogin.setAttribute("tabindex", authMode === "login" ? "0" : "-1");
  }
  if (tabRegister) {
    tabRegister.classList.toggle("active", authMode === "register");
    tabRegister.setAttribute("aria-selected", authMode === "register" ? "true" : "false");
    tabRegister.setAttribute("tabindex", authMode === "register" ? "0" : "-1");
  }

  const paneLogin = document.getElementById("auth-login");
  const paneRegister = document.getElementById("auth-register");

  if (paneLogin) paneLogin.classList.toggle("active", authMode === "login");
  if (paneRegister) paneRegister.classList.toggle("active", authMode === "register");

  if (authMode === "login") document.getElementById("email")?.focus?.();
  else document.getElementById("regName")?.focus?.();

  safeSetLoading(isBusy);
}

/* =========================
   LOADING / LOCK UI
========================= */

function safeSetLoading(loading, message) {
  isBusy = !!loading;

  // AUTH buttons
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  if (loginBtn) loginBtn.disabled = isBusy;
  if (registerBtn) registerBtn.disabled = isBusy;

  // AUTH inputs login
  const email = document.getElementById("email");
  const pass = document.getElementById("password");
  if (email) email.disabled = isBusy;
  if (pass) pass.disabled = isBusy;

  // AUTH inputs register
  const regName = document.getElementById("regName");
  const regEmail = document.getElementById("regEmail");
  const regPass = document.getElementById("regPassword");
  const regMerchantName = document.getElementById("regMerchantName");
  if (regName) regName.disabled = isBusy;
  if (regEmail) regEmail.disabled = isBusy;
  if (regPass) regPass.disabled = isBusy;
  if (regMerchantName) regMerchantName.disabled = isBusy;

  // PDV buttons
  const finishBtn = document.getElementById("finishSaleBtn");
  const clearBtn = document.getElementById("clearCartBtn");
  if (finishBtn) finishBtn.disabled = isBusy || cart.length === 0;
  if (clearBtn) clearBtn.disabled = isBusy || cart.length === 0;

  // Panel buttons
  const saveProductBtn = document.getElementById("saveProductBtn");
  const newProductBtn = document.getElementById("newProductBtn");
  const exportProductsCsvBtn = document.getElementById("exportProductsCsvBtn");
  const exportProductsXlsxBtn = document.getElementById("exportProductsXlsxBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  const exportXlsxBtn = document.getElementById("exportXlsxBtn");
  const loadReportsBtn = document.getElementById("loadReportsBtn");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const restoreSettingsBtn = document.getElementById("restoreSettingsBtn");

  if (saveProductBtn) saveProductBtn.disabled = isBusy;
  if (newProductBtn) newProductBtn.disabled = isBusy;
  if (exportProductsCsvBtn) exportProductsCsvBtn.disabled = isBusy;
  if (exportProductsXlsxBtn) exportProductsXlsxBtn.disabled = isBusy;
  if (exportCsvBtn) exportCsvBtn.disabled = isBusy;
  if (exportXlsxBtn) exportXlsxBtn.disabled = isBusy;
  if (loadReportsBtn) loadReportsBtn.disabled = isBusy;
  if (saveSettingsBtn) saveSettingsBtn.disabled = isBusy;
  if (restoreSettingsBtn) restoreSettingsBtn.disabled = isBusy;

  // message optional
  if (typeof message === "string") {
    if (authMode === "register") setAuthMsg("register", message);
    else setAuthMsg("login", message);
  }
}

function normalizeApiError(err) {
  const raw = String(err?.message || "");
  if (!raw) return "Ocorreu um erro inesperado.";
  if (raw.includes("Failed to fetch")) return "Não foi possível conectar à API. Verifique o servidor.";
  if (/HTTP 401/i.test(raw)) return "Sessão expirada. Faça login novamente.";
  return raw;
}

/* =========================
   API CLIENT
========================= */

async function apiFetch(path, options = {}) {
  if (MOCK_MODE && typeof mockApiFetchImpl === "function") {
    return mockApiFetchImpl(path, options);
  }

  const token = getToken();
  const sentAuth = Boolean(String(token || "").trim());

  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      ...options,
      headers,
    });
  } catch {
    throw new Error("Failed to fetch");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.message || `HTTP ${res.status}`;

    if (res.status === 401) {
      // 401 sem token (ex.: login inválido) NÃO é "sessão expirada"
      // 401 com token (chamadas autenticadas) é tratado como token inválido/expirado
      if (sentAuth) {
        clearToken();
        const ex = new Error("Sessão expirada. Faça login novamente.");
        ex.httpStatus = 401;
        ex.code = err.error || null;
        throw ex;
      }

      const ex = new Error(msg);
      ex.httpStatus = 401;
      ex.code = err.error || null;
      throw ex;
    }

    const ex = new Error(msg);
    ex.httpStatus = res.status;
    ex.code = err.error || null;
    throw ex;
  }

  if (res.status === 204) return null;
  return res.json();
}

async function apiUpload(path, formData) {
  if (MOCK_MODE && typeof mockApiUploadImpl === "function") {
    return mockApiUploadImpl(path, formData);
  }

  const token = getToken();
  const sentAuth = Boolean(String(token || "").trim());

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
  } catch {
    throw new Error("Failed to fetch");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 401) {
      if (sentAuth) {
        clearToken();
        throw new Error("Sessão expirada. Faça login novamente.");
      }
      throw new Error(err.message || `HTTP ${res.status}`);
    }
    throw new Error(err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

/* =========================
   MOCK MODE (sem backend)
========================= */

if (MOCK_MODE) {
  console.warn("MOCK_MODE ativo: usando dados fictícios e ignorando chamadas de API.");

  const mockUser = { name: "Usuário Demo" };
  const mockMerchant = { name: "Loja Demo" };
  const mockSettings = {
    allowCredit: true,
    allowDebit: true,
    allowPix: true,
    allowCash: true,
    defaultPayment: "PIX",
    allowNegativeStock: false,
    reportsDefaultRange: "today",
    reportsMaxRows: 100,
  };

  const mockProducts = [
    {
      id: 1,
      name: "Coxinha",
      category: "Salgados",
      price: 7.5,
      stock: 50,
      active: true,
      imageUrl: "https://via.placeholder.com/200x150.png?text=Coxinha",
    },
    {
      id: 2,
      name: "Suco de Laranja",
      category: "Bebidas",
      price: 6,
      stock: 30,
      active: true,
      imageUrl: "https://via.placeholder.com/200x150.png?text=Suco",
    },
    {
      id: 3,
      name: "Café",
      category: "Bebidas",
      price: 4,
      stock: 80,
      active: true,
      imageUrl: "https://via.placeholder.com/200x150.png?text=Cafe",
    },
  ];

  const mockSales = [
    {
      id: 10,
      createdAt: new Date().toISOString(),
      paymentType: "PIX",
      status: "PAID",
      totalAmount: 12.5,
      items: [
        { name: "Coxinha", quantity: 1 },
        { name: "Suco de Laranja", quantity: 1 },
      ],
    },
    {
      id: 9,
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
      paymentType: "PIX",
      status: "PAID",
      totalAmount: 12,
      items: [{ name: "Café", quantity: 3 }],
    },
    {
      id: 7,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      paymentType: "CREDIT",
      status: "PAID",
      totalAmount: 12.5,
      items: [
        { name: "Coxinha", quantity: 1 },
        { name: "Café", quantity: 1 },
      ],
    },
  ];

  function mockSummary() {
    const paymentsMap = new Map();
    let totalAmount = 0;
    let totalItems = 0;
    for (const s of mockSales) {
      totalAmount += Number(s.totalAmount || 0);
      const count = (s.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
      totalItems += count;
      const key = s.paymentType;
      paymentsMap.set(key, (paymentsMap.get(key) || 0) + Number(s.totalAmount || 0));
    }
    const payments = Array.from(paymentsMap.entries()).map(([paymentType, amount]) => ({
      paymentType,
      totalAmount: amount,
      count: mockSales.filter((s) => s.paymentType === paymentType).length,
    }));
    const salesCount = mockSales.length;
    const avgTicket = salesCount ? totalAmount / salesCount : 0;
    return { totalAmount, salesCount, avgTicket, payments };
  }

  mockApiFetchImpl = async function (path, options = {}) {
    const p = String(path || "");
    if (p.startsWith("/auth/login") || p.startsWith("/auth/register")) {
      return { token: "mock-token", user: mockUser, merchant: mockMerchant };
    }
    if (p.startsWith("/merchant-settings")) {
      if ((options.method || "").toUpperCase() === "PUT") {
        try {
          const body = options.body ? JSON.parse(options.body) : {};
          Object.assign(mockSettings, body);
        } catch {
          // ignore parse errors in mock
        }
      }
      return mockSettings;
    }
    if (p.startsWith("/settings/default") || p.startsWith("/settings")) {
      return mockSettings;
    }
    if (p.startsWith("/products")) {
      const method = (options.method || "GET").toUpperCase();
      const parts = p.split("/").filter(Boolean); // ["products", "id?"]
      const id = parts.length > 1 ? Number(parts[1]) : null;
      if (method === "GET") {
        return mockProducts;
      }
      if (method === "POST") {
        const body = options.body ? JSON.parse(options.body) : {};
        const nextId = mockProducts.length ? Math.max(...mockProducts.map((m) => m.id)) + 1 : 1;
        const product = {
          id: nextId,
          name: body.name || "Produto",
          category: body.category || "",
          price: Number(body.price || 0),
          stock: Number(body.stock || 0),
          active: body.active !== false,
          imageUrl: body.imageUrl || "",
        };
        mockProducts.push(product);
        return product;
      }
      if (method === "PUT" && id) {
        const idx = mockProducts.findIndex((p) => p.id === id);
        if (idx !== -1) {
          const body = options.body ? JSON.parse(options.body) : {};
          mockProducts[idx] = { ...mockProducts[idx], ...body, id };
          return mockProducts[idx];
        }
      }
      return mockProducts;
    }
    if (p.startsWith("/reports/summary")) {
      return mockSummary();
    }
    if (p.startsWith("/reports/sales")) {
      return mockSales;
    }
    if (p.startsWith("/reports/top-products")) {
      const agg = new Map();
      for (const sale of mockSales) {
        for (const it of sale.items || []) {
          const key = it.name || "Produto";
          const quantity = Number(it.quantity || 0);
          const price = Number(it.unitPrice || 0);
          const prev = agg.get(key) || { name: key, quantity: 0, revenue: 0 };
          agg.set(key, { name: key, quantity: prev.quantity + quantity, revenue: prev.revenue + price * quantity });
        }
      }
      return Array.from(agg.values());
    }
    if (p.startsWith("/sales")) {
      const body = options.body ? JSON.parse(options.body) : { items: [], paymentType: "PIX" };
      const items = Array.isArray(body.items) ? body.items : [];
      let totalAmount = 0;
      const enrichedItems = items.map((it) => {
        const prod = mockProducts.find((p) => p.id === Number(it.productId));
        const quantity = Number(it.quantity || 0);
        const price = prod ? Number(prod.price || 0) : 0;
        totalAmount += price * quantity;
        if (prod) {
          const allowNegative = toBool(mockSettings.allowNegativeStock, false);
          prod.stock = allowNegative ? prod.stock - quantity : Math.max(0, prod.stock - quantity);
        }
        return {
          productId: it.productId,
          quantity,
          name: prod?.name || "Produto",
          unitPrice: price,
        };
      });

      const sale = {
        id: mockSales.length ? Math.max(...mockSales.map((s) => s.id)) + 1 : 1,
        createdAt: new Date().toISOString(),
        paymentType: body.paymentType || "PIX",
        status: "PAID",
        totalAmount,
        items: enrichedItems,
      };
      mockSales.unshift(sale);
      return sale;
    }
    return null;
  };

  mockApiUploadImpl = async function (path, formData) {
    // Simula upload de imagem associando uma blob URL ao produto
    const productId = Number(formData?.get?.("productId"));
    const file = formData?.get?.("image");
    if (!productId || !file) return { ok: true };

    const prod = mockProducts.find((p) => p.id === productId);
    if (!prod) return { ok: true };

    try {
      const url = URL.createObjectURL(file);
      prod.imageUrl = url;
    } catch {
      // fallback: mantém imagem existente
    }

    return { ok: true };
  };

  // já considera usuário logado
  setToken("mock-token");
  setSessionInfo(mockUser, mockMerchant);
}

/* =========================
   EXPORTAÇÃO (CSV/EXCEL)
========================= */

function formatDateForFileName(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportToCsvFile(rows, fileName) {
  const BOM = "\uFEFF";
  const csv = rows.map((r) => r.map(csvEscape).join(";")).join("\n");
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, fileName);
}

function ensureXlsxReady() {
  if (typeof XLSX === "undefined") {
    alert("Biblioteca XLSX não carregada. Verifique a inclusão do script no HTML.");
    return false;
  }
  return true;
}

function setSheetColumnWidths(ws, widths) {
  ws["!cols"] = (widths || []).map((wch) => ({ wch }));
}

function exportJsonToXlsxFile(rows, sheetName, fileName, columnWidths) {
  if (!ensureXlsxReady()) return;

  const ws = XLSX.utils.json_to_sheet(rows || []);
  if (Array.isArray(columnWidths) && columnWidths.length) {
    setSheetColumnWidths(ws, columnWidths);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || "Planilha");
  XLSX.writeFile(wb, fileName);
}

const paymentLabels = { CREDIT: "Crédito", DEBIT: "Débito", PIX: "PIX", CASH: "Dinheiro" };
const statusLabels = { PAID: "Pago", PENDING: "Pendente", CANCELED: "Cancelado" };
const humanPayment = (paymentType) => paymentLabels[paymentType] || paymentType;
const humanStatus = (status) => statusLabels[status] || status;
function formatSaleItemsList(items) {
  return (items || [])
    .map((it) => `${it.name || "—"} (x${it.quantity || 0}) - ${moneyBR(it.unitPrice ?? 0)}`)
    .join(" | ");
}

/* =========================
   API HEALTH
========================= */

async function pingApi() {
  if (MOCK_MODE) {
    setApiStatus(true, "API: Mock");
    return;
  }
  try {
    await fetch(API_HEALTH, { cache: "no-store" });
    setApiStatus(true, "API: Online");
  } catch {
    setApiStatus(false, "API: Offline");
  }
}

/* =========================
   LOGIN / REGISTER / LOGOUT
========================= */

async function login() {
  if (isBusy) return;

  setAuthMode("login");
  clearAuthMsgs();
  setResendVerificationVisible(false);

  const email = document.getElementById("email")?.value?.trim() || "";
  const password = document.getElementById("password")?.value || "";

  if (!email || !password) {
    setAuthMsg("login", "Informe e-mail e senha.");
    return;
  }

  safeSetLoading(true, "Autenticando...");

  try {
    const data = await apiFetch(`/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    setToken(data.token);
    setSessionInfo(data.user, data.merchant);

    document.getElementById("loginBox").style.display = "none";
    document.getElementById("appRoot").style.display = "flex";

    hydrateTopBarInfo();
    setApiStatus(true, "API: Online");

    await loadMerchantSettings();
    await loadProducts();
    await loadProductsPanel();
    setDefaultReportDates();
  } catch (e) {
    if (String(e?.message || "").includes("Failed to fetch")) setApiStatus(false, "API: Offline");
    else setApiStatus(true, "API: Online");
    setAuthMsg("login", normalizeApiError(e));
    if (e?.code === "EMAIL_NOT_VERIFIED") setResendVerificationVisible(true);
  } finally {
    safeSetLoading(false);
  }
}

async function register() {
  if (isBusy) return;

  setAuthMode("register");
  clearAuthMsgs();
  setResendVerificationVisible(false);

  const name = document.getElementById("regName")?.value?.trim() || "";
  const email = document.getElementById("regEmail")?.value?.trim() || "";
  const password = document.getElementById("regPassword")?.value || "";
  const merchantName = document.getElementById("regMerchantName")?.value?.trim() || "";

  if (!name || !email || !password || !merchantName) {
    setAuthMsg("register", "Preencha todos os campos para criar sua conta.");
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    setAuthMsg("register", "Informe um e-mail válido.");
    return;
  }
  if (String(password).length < 6) {
    setAuthMsg("register", "A senha deve ter pelo menos 6 caracteres.");
    return;
  }

  safeSetLoading(true, "Criando conta...");

  try {
    const data = await apiFetch(`/auth/register`, {
      method: "POST",
      body: JSON.stringify({ name, email, password, merchantName }),
    });

    // limpa campos cadastro
    document.getElementById("regName").value = "";
    document.getElementById("regEmail").value = "";
    document.getElementById("regPassword").value = "";
    document.getElementById("regMerchantName").value = "";

    const loginEmail = document.getElementById("email");
    const loginPass = document.getElementById("password");
    if (loginEmail) loginEmail.value = email;
    if (loginPass) loginPass.value = "";

    setAuthMode("login");
    setApiStatus(true, "API: Online");
    setAuthMsg(
      "login",
      data?.message || "Enviamos um e-mail de confirmação. Verifique sua caixa de entrada e spam para ativar a conta."
    );
  } catch (e) {
    if (String(e?.message || "").includes("Failed to fetch")) setApiStatus(false, "API: Offline");
    else setApiStatus(true, "API: Online");
    setAuthMsg("register", normalizeApiError(e));
  } finally {
    safeSetLoading(false);
  }
}

async function resendVerification() {
  if (isBusy) return;

  setAuthMode("login");
  const email = document.getElementById("email")?.value?.trim() || "";
  if (!email) {
    setAuthMsg("login", "Informe o e-mail para reenviar a verificação.");
    return;
  }

  const btn = document.getElementById("resendVerificationBtn");
  if (btn) btn.disabled = true;
  safeSetLoading(true, "Reenviando verificação...");

  try {
    const data = await apiFetch(`/auth/resend-verification`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setApiStatus(true, "API: Online");
    setAuthMsg(
      "login",
      data?.message || "Se existir uma conta com este e-mail, enviaremos um novo link de verificação."
    );
  } catch (e) {
    if (String(e?.message || "").includes("Failed to fetch")) setApiStatus(false, "API: Offline");
    else setApiStatus(true, "API: Online");
    setAuthMsg("login", normalizeApiError(e));
  } finally {
    safeSetLoading(false);
    if (btn) btn.disabled = false;
  }
}

function logout() {
  clearToken();
  localStorage.removeItem(MERCHANT_LOGO_KEY);
  cart = [];
  products = [];
  cachedSalesForExport = [];
  cachedProductsForPanel = [];
  editingProductId = null;
  merchantSettings = null;

  document.getElementById("appRoot").style.display = "none";
  document.getElementById("loginBox").style.display = "flex";

  clearAuthMsgs();
  setApiStatus(false, "API: Offline");
  stopMaintenancePolling();

  setAuthMode("login");
}

/* =========================
   TOP BAR
========================= */

function hydrateTopBarInfo() {
  const { userName, merchantName } = readSessionInfo();

  const subtitle = document.getElementById("merchantSubtitle");
  if (subtitle) subtitle.textContent = merchantName || "Painel Web";

  // Logo (se houver; atualizado ao carregar merchant-settings)
  setMerchantLogoInDom(readMerchantLogoUrl());

  const merchantCard = document.getElementById("merchantNameCard");
  const userCard = document.getElementById("userNameCard");
  if (merchantCard) merchantCard.textContent = merchantName || "—";
  if (userCard) userCard.textContent = userName || "—";

  const envText = document.getElementById("envText");
  if (envText) {
    const hostname = String(window.location?.hostname || "").trim().toLowerCase();
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]";
    envText.textContent = isLocal ? "Local" : "Produção";
  }

  const apiBaseInfo = document.getElementById("apiBaseInfo");
  const apiOriginInfo = document.getElementById("apiOriginInfo");
  if (apiBaseInfo) apiBaseInfo.textContent = API_BASE;
  if (apiOriginInfo) apiOriginInfo.textContent = API_ORIGIN;
}

/* =========================
   NAV (SIDEBAR)
========================= */

function setupNav() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((btn) => {
    btn.addEventListener("click", async () => {
      navItems.forEach((b) => b.classList.toggle("active", b === btn));

      const tab = btn.getAttribute("data-tab");
      document.querySelectorAll(".tab-page").forEach((p) => p.classList.remove("active"));

      const page = document.getElementById(`tab-${tab}`);
      if (page) page.classList.add("active");

      try {
        if (tab === "reports") await loadReports();
        if (tab === "products") await loadProductsPanel();
        if (tab === "settings") {
          hydrateTopBarInfo();
          await loadMerchantSettings();
        }
      } catch (e) {
        console.error(e);
      }
    });
  });
}

/* =========================
   MERCHANT SETTINGS
========================= */

function hasSettingsUI() {
  return !!document.getElementById("settingsForm");
}

function setSettingsMsg(text) {
  const el = document.getElementById("settingsMsg");
  if (el) el.textContent = text || "";
}

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  if (typeof v === "number") return v === 1;
  return fallback;
}

function setElValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value ?? "";
}

function setElChecked(id, checked) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!checked;
}

function readElValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function readElChecked(id) {
  const el = document.getElementById(id);
  return el ? !!el.checked : false;
}

function fillSettingsForm(data) {
  // Dados da empresa
  setElValue("stCompanyName", data.companyName || "");
  setElValue("stTradeName", data.tradeName || "");
  setElValue("stDocument", data.document || "");
  setElValue("stPhone", data.phone || "");
  setElValue("stAddress", data.address || "");

  // Pagamentos
  setElChecked("stAllowCredit", toBool(data.allowCredit, true));
  setElChecked("stAllowDebit", toBool(data.allowDebit, true));
  setElChecked("stAllowPix", toBool(data.allowPix, true));
  setElChecked("stAllowCash", toBool(data.allowCash, true));
  setElValue("stDefaultPayment", data.defaultPayment || "PIX");

  // Estoque
  setElChecked("stStockEnabled", toBool(data.stockEnabled, true));
  setElChecked("stAllowNegativeStock", toBool(data.allowNegativeStock, false));

  // Relatórios
  setElValue("stReportsDefaultRange", data.reportsDefaultRange || "today");
  setElValue("stReportsMaxRows", String(data.reportsMaxRows ?? 50));

  // Metadata (se existir no HTML)
  const created = document.getElementById("stCreatedAt");
  const updated = document.getElementById("stUpdatedAt");
  if (created) created.textContent = isoToBR(data.createdAt);
  if (updated) updated.textContent = isoToBR(data.updatedAt);
}

function applyStoreNameFromSettings(data) {
  const el = document.getElementById("storeName");
  if (!el) return;

  const tradeName = String(data?.tradeName || "").trim();
  const companyName = String(data?.companyName || "").trim();
  const fallback = readSessionInfo().merchantName || "-";
  el.textContent = tradeName || companyName || fallback;
}

function readSettingsForm() {
  const reportsMaxRowsRaw = Number(readElValue("stReportsMaxRows") || 50);

  return {
    // Dados da empresa
    companyName: String(readElValue("stCompanyName") || "").trim(),
    tradeName: String(readElValue("stTradeName") || "").trim(),
    document: String(readElValue("stDocument") || "").trim(),
    phone: String(readElValue("stPhone") || "").trim(),
    address: String(readElValue("stAddress") || "").trim(),

    allowCredit: readElChecked("stAllowCredit"),
    allowDebit: readElChecked("stAllowDebit"),
    allowPix: readElChecked("stAllowPix"),
    allowCash: readElChecked("stAllowCash"),

    defaultPayment: String(readElValue("stDefaultPayment") || "PIX").toUpperCase(),

    stockEnabled: readElChecked("stStockEnabled"),
    allowNegativeStock: readElChecked("stAllowNegativeStock"),

    reportsDefaultRange: String(readElValue("stReportsDefaultRange") || "today"),
    reportsMaxRows: Number.isFinite(reportsMaxRowsRaw) ? reportsMaxRowsRaw : 50,
  };
}

function validateSettingsPayload(payload) {
  if (!payload.companyName) return "Informe o Nome da empresa.";

  const allowedPay = [];
  if (payload.allowCredit) allowedPay.push("CREDIT");
  if (payload.allowDebit) allowedPay.push("DEBIT");
  if (payload.allowPix) allowedPay.push("PIX");
  if (payload.allowCash) allowedPay.push("CASH");

  if (allowedPay.length === 0) return "Você não pode desabilitar todos os meios de pagamento.";
  if (!allowedPay.includes(payload.defaultPayment)) return "O pagamento padrão precisa estar habilitado.";

  if (payload.reportsMaxRows < 50 || payload.reportsMaxRows > 200)
    return "Máximo de linhas do relatório deve ficar entre 50 e 200.";

  return null;
}

async function loginWithGoogleIdToken(idToken) {
  if (isBusy) return;

  setAuthMode("login");
  clearAuthMsgs();

  const tokenIn = String(idToken || "").trim();
  if (!tokenIn) {
    setGoogleMsg("Falha ao obter token do Google. Tente novamente.");
    return;
  }

  safeSetLoading(true, "Autenticando com Google...");

  try {
    const data = await apiFetch(`/auth/google`, {
      method: "POST",
      body: JSON.stringify({ credential: tokenIn }),
    });

    // Valida retorno mínimo
    const apiToken = String(data?.token || "").trim();
    if (!apiToken) {
      throw Object.assign(new Error("Token ausente na resposta."), {
        code: "BAD_AUTH_RESPONSE",
      });
    }

    const created = data?.created === true;
    const needsEmailVerify = data?.needsEmailVerify === true;

    const postLoginNotice =
      created
        ? needsEmailVerify
          ? "Conta criada com Google. Verifique seu e-mail para confirmar."
          : "Conta criada com Google com sucesso."
        : "";

    setToken(apiToken);
    setSessionInfo(data?.user || null, data?.merchant || null);

    const loginBox = document.getElementById("loginBox");
    const appRoot = document.getElementById("appRoot");
    if (loginBox) loginBox.style.display = "none";
    if (appRoot) appRoot.style.display = "flex";

    hydrateTopBarInfo();
    setApiStatus(true, "API: Online");

    // Carregamentos pós-login — mantém sua ordem
    await loadMerchantSettings();
    await loadProducts();
    await loadProductsPanel();
    setDefaultReportDates();

    setGoogleMsg("");
    if (postLoginNotice) setTimeout(() => alert(postLoginNotice), 50);
  } catch (e) {
    // Normaliza status offline vs erro de regra
    const msg = String(e?.message || "");
    const offline =
      msg.includes("Failed to fetch") ||
      msg.includes("NetworkError") ||
      msg.includes("ECONNREFUSED");

    setApiStatus(!offline, offline ? "API: Offline" : "API: Online");

    // Tratamento por códigos que o backend pode devolver
    if (e?.code === "ACCOUNT_EXISTS_LOCAL") {
      setGoogleMsg("Esse e-mail já foi cadastrado por senha. Entre com e-mail/senha.");
    } else if (e?.code === "ACCOUNT_CONFLICT") {
      setGoogleMsg("Conflito de conta Google. Contate o suporte para recuperar o acesso.");
    } else if (e?.code === "BAD_AUTH_RESPONSE") {
      setGoogleMsg("Resposta inválida da API ao autenticar com Google. Contate o suporte.");
      console.warn("[GOOGLE] bad auth response:", e);
    } else {
      setGoogleMsg(normalizeApiError(e) || "Erro ao autenticar com Google.");
    }
  } finally {
    safeSetLoading(false);
  }
}

function setupGoogleLoginUX() {
  let clientId = String(window.__APP_CONFIG__?.GOOGLE_CLIENT_ID ?? "").trim();

  const targets = [
    { boxId: "googleLoginBoxLogin", btnId: "googleBtnLogin" },
    { boxId: "googleLoginBoxRegister", btnId: "googleBtnRegister" },
  ];

  const existingTargets = targets
    .map((t) => ({ ...t, box: document.getElementById(t.boxId), btn: document.getElementById(t.btnId) }))
    .filter((t) => t.box && t.btn);

  if (!existingTargets.length) return;

  const ensureClientId = async () => {
  const fromRuntime = String(window.__APP_CONFIG__?.GOOGLE_CLIENT_ID ?? "").trim();
  if (fromRuntime) return fromRuntime;

  try {
    const res = await fetch(`${API_BASE}/config/public`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    const cid = String(data?.googleClientId || "").trim();
    if (cid) {
      window.__APP_CONFIG__.GOOGLE_CLIENT_ID = cid;
      return cid;
    }
  } catch (e) {
    console.warn("[GOOGLE] could not load /config/public:", e?.message || e);
  }

  return "";
};

  // Se não configurou o Client ID no runtime config, tenta buscar do backend
  if (!clientId) {
    existingTargets.forEach((t) => {
      t.box.style.display = "block";
      t.btn.innerHTML = "";
    });

    setGoogleMsg("Carregando configuração do Google...");

    ensureClientId().then((cid) => {
      if (!cid) {
        // Não é erro “fatal”: apenas Google não está habilitado
        setGoogleMsg("Login com Google indisponível. Configure GOOGLE_CLIENT_ID no servidor para habilitar.");
        // Opcional: manter só a msg e esconder o espaço do botão para não ficar “vazio”
        existingTargets.forEach((t) => {
          t.btn.innerHTML = "";
        });
        return;
      }

      clientId = cid;
      tryInit(0);
    });

    return;
  }

  existingTargets.forEach((t) => (t.box.style.display = "block"));

  function tryInit(attempt = 0) {
    const max = 30;
    if (attempt > max) {
      setGoogleMsg("Google: biblioteca não carregou. Recarregue a página.");
      return;
    }

    const gis = window.google?.accounts?.id;
    if (!gis) {
      setTimeout(() => tryInit(attempt + 1), 150);
      return;
    }

    try {
      gis.initialize({
        client_id: clientId,
        callback: (resp) => {
          const token = String(resp?.credential || "").trim();
          if (!token) {
            console.warn("[GOOGLE] empty credential received");
            setGoogleMsg("Falha ao autenticar com Google. Tente novamente.");
            return;
          }

          loginWithGoogleIdToken(token);
        },
        ux_mode: "popup",
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      existingTargets.forEach((t) => {
        t.btn.innerHTML = "";
        gis.renderButton(t.btn, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "rectangular",
          width: 320,
        });
      });

      setGoogleMsg("");
    } catch (e) {
      console.error("[GOOGLE] init failed:", e);
      setGoogleMsg("Falha ao inicializar Login com Google.");
    }
  }

  tryInit(0);
}

function setChangePasswordMsg(text) {
  const el = document.getElementById("changePasswordMsg");
  if (el) el.textContent = text || "";
}

async function changePassword(e) {
  e?.preventDefault?.();
  if (isBusy) return;

  setChangePasswordMsg("");

  const currentPassword = String(document.getElementById("cpCurrentPassword")?.value || "");
  const newPassword = String(document.getElementById("cpNewPassword")?.value || "");
  const confirm = String(document.getElementById("cpConfirmPassword")?.value || "");

  if (!currentPassword || !newPassword || !confirm) {
    setChangePasswordMsg("Preencha todos os campos.");
    return;
  }
  if (newPassword.length < 6) {
    setChangePasswordMsg("A nova senha deve ter pelo menos 6 caracteres.");
    return;
  }
  if (newPassword !== confirm) {
    setChangePasswordMsg("A confirmação não confere.");
    return;
  }

  const btn = document.getElementById("changePasswordBtn");
  if (btn) btn.disabled = true;

  safeSetLoading(true, "Atualizando senha...");
  try {
    const res = await apiFetch(`/auth/change-password`, {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    setChangePasswordMsg(res?.message || "Senha atualizada com sucesso.");
    document.getElementById("cpCurrentPassword").value = "";
    document.getElementById("cpNewPassword").value = "";
    document.getElementById("cpConfirmPassword").value = "";
  } catch (err) {
    console.error("[CHANGE_PASSWORD] failed:", err);
    setChangePasswordMsg(normalizeApiError(err) || "Erro ao atualizar senha.");
  } finally {
    safeSetLoading(false);
    if (btn) btn.disabled = false;
  }
}

function applyPaymentOptionsFromSettings() {
  const select = document.getElementById("paymentType");
  if (!select || !merchantSettings) return;

  const allow = {
    CREDIT: toBool(merchantSettings.allowCredit, true),
    DEBIT: toBool(merchantSettings.allowDebit, true),
    PIX: toBool(merchantSettings.allowPix, true),
    CASH: toBool(merchantSettings.allowCash, true),
  };

  const options = Array.from(select.querySelectorAll("option"));
  options.forEach((opt) => {
    const key = String(opt.value || "").toUpperCase();
    const enabled = allow[key] !== false;
    opt.disabled = !enabled;
    opt.hidden = !enabled;
  });

  const allowedValues = Object.entries(allow)
    .filter(([, ok]) => ok !== false)
    .map(([k]) => k);

  if (allowedValues.length === 0) {
    options.forEach((opt) => {
      opt.disabled = false;
      opt.hidden = false;
    });
    return;
  }

  const current = String(select.value || "").toUpperCase();
  const def = String(merchantSettings.defaultPayment || "PIX").toUpperCase();

  const next = allowedValues.includes(current) ? current : allowedValues.includes(def) ? def : allowedValues[0];
  select.value = next;
}

function ensurePaymentAllowed(paymentType) {
  if (!merchantSettings) return true;
  const key = String(paymentType || "").toUpperCase();
  const map = { CREDIT: "allowCredit", DEBIT: "allowDebit", PIX: "allowPix", CASH: "allowCash" };
  const prop = map[key];
  if (!prop) return true;
  return toBool(merchantSettings[prop], true);
}

function isStockEnabled() {
  if (!merchantSettings) return true;
  return toBool(merchantSettings.stockEnabled, true);
}

function applyStockUiFromSettings() {
  const enabled = isStockEnabled();
  document.body.classList.toggle("stock-disabled", !enabled);
}

function canAddItemGivenStock(product, nextQty) {
  if (!isStockEnabled()) return true;
  const stock = Number(product?.stock ?? 0);
  if (!merchantSettings) return nextQty <= stock;

  const allowNegative = toBool(merchantSettings.allowNegativeStock, false);
  return allowNegative ? true : nextQty <= stock;
}

async function loadMerchantSettings() {
  if (!hasSettingsUI()) return;

  setSettingsMsg("Carregando configurações...");
  safeSetLoading(true);

  try {
    const data = await apiFetch(`/merchant-settings`);
    merchantSettings = data;
    applyStockUiFromSettings();

    fillSettingsForm(data);
    applyStoreNameFromSettings(data);
    applyMerchantLogoFromSettings(data);
    applyPaymentOptionsFromSettings();
    renderProducts(getActiveCategory(), getSalesSearchQuery());
    applyProductsPanelFilter();

    setSettingsMsg("Configurações carregadas.");
  } catch (e) {
    setSettingsMsg(normalizeApiError(e) || "Erro ao carregar configurações.");
  } finally {
    safeSetLoading(false);
  }
}

/* =========================
   MERCHANT LOGO (upload)
========================= */

let logoPreviewObjectUrl = null;

function hasLogoSettingsUI() {
  return !!document.getElementById("stLogoFile");
}

function setLogoMsg(text) {
  const el = document.getElementById("stLogoMsg");
  if (el) el.textContent = text || "";
}

function resetLocalLogoPreview() {
  try {
    if (logoPreviewObjectUrl) URL.revokeObjectURL(logoPreviewObjectUrl);
  } catch {}
  logoPreviewObjectUrl = null;
}

function setLogoPreview(url) {
  const img = document.getElementById("stLogoPreviewImg");
  const placeholder = document.getElementById("stLogoPreviewPlaceholder");
  const removeBtn = document.getElementById("stLogoRemoveBtn");

  if (!img || !placeholder) return;

  const u = String(url || "").trim();
  if (!u) {
    img.removeAttribute("src");
    img.style.display = "none";
    placeholder.style.display = "block";
    if (removeBtn) removeBtn.disabled = true;
    return;
  }

  img.src = u;
  img.style.display = "block";
  placeholder.style.display = "none";
  if (removeBtn) removeBtn.disabled = false;
}

function applyMerchantLogoFromSettings(data) {
  if (!hasLogoSettingsUI()) return;
  const url = String(data?.logoUrl || "").trim();
  setMerchantLogoUrl(url);
  setLogoPreview(url);
}

function validateLogoFile(file) {
  if (!file) return "Selecione uma imagem para enviar.";

  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(String(file.type || ""))) {
    return "Formato inv\u00e1lido. Use PNG, JPG ou WEBP.";
  }

  const size = Number(file.size || 0);
  if (size <= 0) return "Arquivo inv\u00e1lido.";
  if (size > 2 * 1024 * 1024) return "Arquivo muito grande. Limite: 2MB.";

  return null;
}

async function uploadMerchantLogo() {
  if (isBusy) return;
  if (!hasLogoSettingsUI()) return;

  setLogoMsg("");

  const input = document.getElementById("stLogoFile");
  const file = input?.files?.[0];

  const err = validateLogoFile(file);
  if (err) {
    setLogoMsg(err);
    return;
  }

  const size = Number(file.size || 0);
  if (size > 1 * 1024 * 1024) {
    setLogoMsg("Aviso: arquivo acima de 1MB. Se poss\u00edvel, envie uma vers\u00e3o menor (limite 2MB).");
  }

  safeSetLoading(true, "Enviando logo...");
  try {
    const fd = new FormData();
    fd.append("logo", file);

    const data = await apiUpload(`/merchant/logo`, fd);
    const url = String(data?.logoUrl || "").trim();

    resetLocalLogoPreview();
    setMerchantLogoUrl(url);
    setLogoPreview(url);

    if (input) input.value = "";
    setLogoMsg("Logo atualizado com sucesso.");
  } catch (e) {
    setLogoMsg(normalizeApiError(e) || "Erro ao enviar logo.");
  } finally {
    safeSetLoading(false);
  }
}

async function removeMerchantLogo() {
  if (isBusy) return;
  if (!hasLogoSettingsUI()) return;

  setLogoMsg("");

  const ok = window.confirm("Remover o logo do estabelecimento?");
  if (!ok) return;

  safeSetLoading(true, "Removendo logo...");
  try {
    await apiFetch(`/merchant/logo`, { method: "DELETE" });

    resetLocalLogoPreview();
    setMerchantLogoUrl("");
    setLogoPreview("");
    setLogoMsg("Logo removido.");
  } catch (e) {
    setLogoMsg(normalizeApiError(e) || "Erro ao remover logo.");
  } finally {
    safeSetLoading(false);
  }
}

function setupMerchantLogoEvents() {
  if (!hasLogoSettingsUI()) return;

  const input = document.getElementById("stLogoFile");
  const uploadBtn = document.getElementById("stLogoUploadBtn");
  const removeBtn = document.getElementById("stLogoRemoveBtn");

  uploadBtn?.addEventListener("click", uploadMerchantLogo);
  removeBtn?.addEventListener("click", removeMerchantLogo);

  input?.addEventListener("change", () => {
    setLogoMsg("");
    const file = input.files?.[0];
    const err = validateLogoFile(file);
    if (err) {
      resetLocalLogoPreview();
      setLogoPreview(merchantSettings?.logoUrl || "");
      setLogoMsg(err);
      return;
    }

    resetLocalLogoPreview();
    try {
      logoPreviewObjectUrl = URL.createObjectURL(file);
    } catch {
      logoPreviewObjectUrl = null;
    }
    if (logoPreviewObjectUrl) {
      setLogoPreview(logoPreviewObjectUrl);
      setLogoMsg("Preview pronto. Clique em \u201cEnviar logo\u201d para salvar.");
    }
  });
}

async function saveMerchantSettings() {
  if (!hasSettingsUI() || isBusy) return;

  setSettingsMsg("");
  const payload = readSettingsForm();

  const err = validateSettingsPayload(payload);
  if (err) {
    setSettingsMsg(err);
    return;
  }

  safeSetLoading(true);
  setSettingsMsg("Salvando...");

  try {
    const updated = await apiFetch(`/merchant-settings`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });

    merchantSettings = updated;
    applyStockUiFromSettings();
    fillSettingsForm(updated);
    applyStoreNameFromSettings(updated);
    applyPaymentOptionsFromSettings();

    setSettingsMsg("Configurações salvas com sucesso.");
  } catch (e) {
    setSettingsMsg(normalizeApiError(e) || "Erro ao salvar configurações.");
  } finally {
    safeSetLoading(false);
  }
}

function restoreDefaultSettingsUI() {
  if (!hasSettingsUI()) return;

  const defaults = {
    allowCredit: true,
    allowDebit: true,
    allowPix: true,
    allowCash: true,
    defaultPayment: "PIX",
    stockEnabled: true,
    allowNegativeStock: false,
    reportsDefaultRange: "today",
    reportsMaxRows: 100,
  };

  // Mantém dados da empresa ao restaurar apenas preferências
  const next = { ...(merchantSettings || {}), ...defaults };
  fillSettingsForm(next);
  applyStoreNameFromSettings(next);
  applyStockUiFromSettings();
  renderProducts(getActiveCategory(), getSalesSearchQuery());
  applyProductsPanelFilter();
  renderCart();
  setSettingsMsg("Padrões restaurados (ainda não salvos).");

  merchantSettings = { ...(merchantSettings || {}), ...readSettingsForm() };
  applyPaymentOptionsFromSettings();
  applyStockUiFromSettings();
}

function setupMerchantSettingsEvents() {
  const saveBtn = document.getElementById("saveSettingsBtn");
  const restoreBtn = document.getElementById("restoreSettingsBtn");

  saveBtn?.addEventListener("click", saveMerchantSettings);
  restoreBtn?.addEventListener("click", restoreDefaultSettingsUI);

  document.getElementById("changePasswordForm")?.addEventListener("submit", changePassword);

  const reapplyIds = ["stAllowCredit", "stAllowDebit", "stAllowPix", "stAllowCash", "stDefaultPayment"];
  reapplyIds.forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      merchantSettings = { ...(merchantSettings || {}), ...readSettingsForm() };
      applyPaymentOptionsFromSettings();
    });
  });

  const stockIds = ["stStockEnabled", "stAllowNegativeStock"];
  stockIds.forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      merchantSettings = { ...(merchantSettings || {}), ...readSettingsForm() };
      applyStockUiFromSettings();
      renderProducts(getActiveCategory(), getSalesSearchQuery());
      applyProductsPanelFilter();
      renderCart();
    });
  });

  setupMerchantLogoEvents();
}

/* =========================
   VENDAS / CARRINHO
========================= */

async function loadProducts() {
  const data = await apiFetch(`/products`);
  products = (data || []).slice();

  buildCategoryBar(products);
  renderProducts(getActiveCategory(), getSalesSearchQuery());
  applyPaymentOptionsFromSettings();
}

function getSalesSearchQuery() {
  return (document.getElementById("salesSearch")?.value || "").trim().toLowerCase();
}

async function forgotPassword() {
  if (isBusy) return;

  const email = document.getElementById("forgotEmail")?.value?.trim() || "";
  const msgEl = document.getElementById("forgotMsg");
  if (msgEl) msgEl.textContent = "";

  if (!email) {
    if (msgEl) msgEl.textContent = "Informe o e-mail para receber o link.";
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    if (msgEl) msgEl.textContent = "Informe um e-mail válido.";
    return;
  }

  const url = `${API_BASE}/auth/forgot-password`;

  if (typeof window !== "undefined" && !window.__FORGOT_DEBUG_LOGGED__) {
    window.__FORGOT_DEBUG_LOGGED__ = true;
    console.debug("[FORGOT] config:", {
      __APP_CONFIG__: window.__APP_CONFIG__,
      API_BASE,
      url,
    });
  }

  const sendBtn = document.getElementById("forgotSendBtn");
  if (sendBtn) sendBtn.disabled = true;

  safeSetLoading(true, "Enviando link...");
  try {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutMs = 10_000;
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        signal: controller?.signal,
      });
    } catch (err) {
      if (controller?.signal?.aborted) {
        throw new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) ao contatar a API.`);
      }
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.message || `HTTP ${res.status}`;
      throw new Error(`${msg} (HTTP ${res.status})`);
    }

    if (msgEl) msgEl.textContent = data?.message || "Se existir uma conta, enviaremos o link.";
  } catch (e) {
    console.error("[FORGOT] failed:", e);
    if (msgEl) msgEl.textContent = normalizeApiError(e) || "Falha ao enviar o link.";
  } finally {
    safeSetLoading(false);
    if (sendBtn) sendBtn.disabled = false;
  }
}

function findProductById(id) {
  const pid = Number(id);
  return (
    products.find((p) => Number(p.id) === pid) ||
    cachedProductsForPanel.find((p) => Number(p.id) === pid) ||
    null
  );
}

function decorateSaleItems(items) {
  return (items || []).map((it) => {
    const prod = findProductById(it.productId);
    return {
      ...it,
      name: it?.name || prod?.name || `Produto #${it?.productId ?? "?"}`,
      unitPrice: it?.unitPrice ?? prod?.price ?? 0,
    };
  });
}

function productMatchesSearch(p, q) {
  if (!q) return true;
  const name = String(p.name || "").toLowerCase();
  const cat = String(p.category || "").toLowerCase();
  return name.includes(q) || cat.includes(q);
}

function filterByCategory(product, category) {
  if (category === "all") return true;
  const prodKey = normalizeCategoryKey(product.category);
  return prodKey === String(category);
}

function renderProducts(category, searchQuery) {
  const grid = document.getElementById("productGrid");
  if (!grid) return;

  grid.innerHTML = "";

  const visible = products
    .filter((p) => p.active !== false)
    .filter((p) => filterByCategory(p, category))
    .filter((p) => productMatchesSearch(p, searchQuery));

  const info = document.getElementById("productsCountInfo");
  if (info) info.textContent = visible.length ? `${visible.length} produto(s)` : "";

  if (visible.length === 0) {
    grid.innerHTML = `<div class="hint" style="padding:10px;">Nenhum produto encontrado.</div>`;
    return;
  }

  visible.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";

    const img = resolveImageUrl(product.imageUrl, product.name);
    const stockLine = isStockEnabled()
      ? `<div class="product-stock">Estoque: ${Number(product.stock ?? 0)}</div>`
      : "";

    card.innerHTML = `
      <img class="product-image" src="${img}" alt="${escapeHtml(product.name)}" />
      <div class="product-name">${escapeHtml(product.name)}</div>
      <div class="product-price">${moneyBR(product.price)}</div>
      ${stockLine}
    `;

    card.addEventListener("click", () => addToCart(product.id));
    grid.appendChild(card);
  });
}

function setCartMessage(t) {
  const el = document.getElementById("cartMessage");
  if (el) el.textContent = t || "";
}

function addToCart(productId) {
  const product = products.find((p) => p.id === productId);
  if (!product) return;

  const existing = cart.find((item) => item.productId === productId);
  const currentQty = existing ? existing.quantity : 0;

  if (!canAddItemGivenStock(product, currentQty + 1)) {
    if (Number(product.stock ?? 0) <= 0) setCartMessage("Produto sem estoque.");
    else setCartMessage("Estoque insuficiente.");
    return;
  }

  if (existing) existing.quantity += 1;
  else
    cart.push({
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.price || 0),
      quantity: 1,
    });

  setCartMessage("");
  renderCart();
}

function renderCart() {
  const container = document.getElementById("cartItems");
  const totalEl = document.getElementById("cartTotalText");
  const countEl = document.getElementById("cartCount");
  const badgeEl = document.getElementById("cartCountBadge");
  if (!container || !totalEl || !countEl) return;

  container.innerHTML = "";

  let total = 0;
  let count = 0;

  cart.forEach((item, index) => {
    const subtotal = item.unitPrice * item.quantity;
    total += subtotal;
    count += item.quantity;

    const row = document.createElement("div");
    row.className = "cart-item";

    row.innerHTML = `
      <div class="cart-item-info">
        <span class="cart-item-name">${escapeHtml(item.name)}</span>
        <span class="cart-item-details">
          ${item.quantity} x ${moneyBR(item.unitPrice)} = ${moneyBR(subtotal)}
        </span>
      </div>
      <div class="cart-item-actions">
        <button class="qty-btn" aria-label="Diminuir" type="button">-</button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" aria-label="Aumentar" type="button">+</button>
        <button class="remove-btn" title="Remover" aria-label="Remover" type="button">&times;</button>
      </div>
    `;

    const buttons = row.querySelectorAll("button");
    const btnDec = buttons[0];
    const btnInc = buttons[1];
    const btnRemove = buttons[2];

    btnDec.addEventListener("click", () => {
      if (item.quantity > 1) item.quantity -= 1;
      else cart.splice(index, 1);
      renderCart();
    });

    btnInc.addEventListener("click", () => {
      const p = products.find((x) => x.id === item.productId);
      const nextQty = item.quantity + 1;

      if (p && !canAddItemGivenStock(p, nextQty)) {
        setCartMessage("Estoque insuficiente.");
        return;
      }

      item.quantity = nextQty;
      setCartMessage("");
      renderCart();
    });

    btnRemove.addEventListener("click", () => {
      cart.splice(index, 1);
      renderCart();
    });

    container.appendChild(row);
  });

  totalEl.textContent = moneyBR(total);
  countEl.textContent = String(count);
  if (badgeEl) badgeEl.textContent = String(count);

  const finishBtn = document.getElementById("finishSaleBtn");
  const clearBtn = document.getElementById("clearCartBtn");
  if (finishBtn) finishBtn.disabled = isBusy || count === 0;
  if (clearBtn) clearBtn.disabled = isBusy || count === 0;
}

async function finishSale() {
  if (isBusy) return;
  setCartMessage("");

  if (cart.length === 0) {
    setCartMessage("Carrinho vazio.");
    return;
  }

  applyPaymentOptionsFromSettings();

  const paymentType = String(document.getElementById("paymentType")?.value || "PIX").toUpperCase();
  if (!ensurePaymentAllowed(paymentType)) {
    setCartMessage("Forma de pagamento desabilitada nas configurações do estabelecimento.");
    return;
  }

  const items = cart.map((item) => ({ productId: item.productId, quantity: item.quantity }));

  safeSetLoading(true);
  try {
    const sale = await apiFetch(`/sales`, {
      method: "POST",
      body: JSON.stringify({ paymentType, items }),
    });

    setCartMessage(`Venda #${sale.id} registrada com sucesso. Total: ${moneyBR(sale.totalAmount)}.`);

    cart = [];
    renderCart();

    await loadProducts();
    await loadProductsPanel();
    setDefaultReportDates();
    await loadReports();
  } catch (err) {
    setCartMessage(normalizeApiError(err) || "Erro ao finalizar venda.");
  } finally {
    safeSetLoading(false);
  }
}

function clearCart() {
  cart = [];
  setCartMessage("");
  renderCart();
}

/* =========================
   RELATÓRIOS (CSV + EXCEL)
========================= */

function setDefaultReportDates() {
  const fromEl = document.getElementById("fromDate");
  const toEl = document.getElementById("toDate");
  if (!fromEl || !toEl) return;

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;

  // aplica ranges pelo settings, se existir e inputs vazios
  if (!fromEl.value && !toEl.value && merchantSettings?.reportsDefaultRange) {
    const range = String(merchantSettings.reportsDefaultRange || "today");
    const end = new Date();
    let start = new Date(end);

    if (range === "week") start.setDate(end.getDate() - 6);
    else if (range === "month") start.setDate(end.getDate() - 29);

    const sY = start.getFullYear();
    const sM = String(start.getMonth() + 1).padStart(2, "0");
    const sD = String(start.getDate()).padStart(2, "0");
    fromEl.value = `${sY}-${sM}-${sD}`;

    const eY = end.getFullYear();
    const eM = String(end.getMonth() + 1).padStart(2, "0");
    const eD = String(end.getDate()).padStart(2, "0");
    toEl.value = `${eY}-${eM}-${eD}`;
    return;
  }

  if (!fromEl.value) fromEl.value = today;
  if (!toEl.value) toEl.value = today;
}

function buildReportRangeRaw(fromValue, toValue) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10); // yyyy-mm-dd

  const from = fromValue || todayStr;
  let to = toValue || todayStr;

  // garante que to >= from
  if (to < from) to = from;

  return { from, to };
}

async function loadReports() {
  const msg = document.getElementById("reportsMsg");
  if (msg) msg.textContent = "";

  const from = document.getElementById("fromDate")?.value || "";
  const to = document.getElementById("toDate")?.value || "";
  const { from: fromStr, to: toStr } = buildReportRangeRaw(from, to);

  // garante que os inputs reflitam o range usado
  const fromEl = document.getElementById("fromDate");
  const toEl = document.getElementById("toDate");
  if (fromEl && !fromEl.value) fromEl.value = fromStr;
  if (toEl && !toEl.value) toEl.value = toStr;
  if (fromEl && toEl && toEl.value < fromEl.value) {
    toEl.value = fromEl.value;
  }

  safeSetLoading(true);

  try {
    const summary = await apiFetch(`/reports/summary?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`);
    const salesRaw = await apiFetch(`/reports/sales?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`);
    const top = await apiFetch(`/reports/top-products?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`);

    const sales = (salesRaw || []).map((s) => {
      const items = decorateSaleItems(s.items);
      return { ...s, items };
    });

    document.getElementById("repTotal").textContent = moneyBR(summary.totalAmount);
    document.getElementById("repCount").textContent = String(summary.salesCount);
    document.getElementById("repAvg").textContent = moneyBR(summary.avgTicket);

    // pagamentos
    const payBox = document.getElementById("repPayments");
    if (payBox) {
      payBox.innerHTML = "";
      (summary.payments || []).forEach((p) => {
        const div = document.createElement("div");
        div.className = "list-row";
        div.innerHTML = `<span>${escapeHtml(p.paymentType)}</span><strong>${moneyBR(p.totalAmount)} (${p.count})</strong>`;
        payBox.appendChild(div);
      });
      if ((summary.payments || []).length === 0) {
        payBox.innerHTML = `<div class="list-empty">Sem dados no período.</div>`;
      }
    }

    // top produtos
    const topBox = document.getElementById("topProducts");
    if (topBox) {
      topBox.innerHTML = "";
      (top || []).forEach((p, idx) => {
        const div = document.createElement("div");
        div.className = "list-row";
        div.innerHTML = `<span>${idx + 1}. ${escapeHtml(p.name)}</span><strong>${moneyBR(p.revenue)} • qtd ${p.quantity}</strong>`;
        topBox.appendChild(div);
      });
      if ((top || []).length === 0) {
        topBox.innerHTML = `<div class="list-empty">Sem vendas no período.</div>`;
      }
    }

    cachedSalesForExport = sales || [];
    renderSalesTable(cachedSalesForExport);
  } catch (e) {
    if (msg) msg.textContent = normalizeApiError(e) || "Erro ao gerar relatório.";
  } finally {
    safeSetLoading(false);
  }
}

function renderSalesTable(sales) {
  const tbody = document.querySelector("#salesTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  (sales || []).forEach((s) => {
    const tr = document.createElement("tr");
    const itemsCount = (s.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);

    tr.innerHTML = `
      <td>${s.id}</td>
      <td>${isoToBR(s.createdAt)}</td>
      <td>${escapeHtml(humanPayment(s.paymentType))}</td>
      <td>${escapeHtml(humanStatus(s.status))}</td>
      <td>${moneyBR(s.totalAmount)}</td>
      <td>${itemsCount}</td>
    `;
    tbody.appendChild(tr);
  });

  if (!sales || sales.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" style="text-align:center;opacity:.7;padding:12px">Nenhuma venda no período.</td>`;
    tbody.appendChild(tr);
  }
}

function exportSalesCsv() {
  const from = document.getElementById("fromDate")?.value || "";
  const to = document.getElementById("toDate")?.value || "";

  const rows = [];
  rows.push(["Relatório de Vendas (PDV)"]);
  rows.push([`Período: ${from || "-"} até ${to || "-"}`]);
  rows.push([]);
  rows.push(["ID", "Data/Hora", "Pagamento", "Status", "Total (R$)", "Qtd Itens", "Itens"]);

  for (const s of cachedSalesForExport) {
    const itemsCount = (s.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    rows.push([
      s.id,
      isoToBR(s.createdAt),
      humanPayment(s.paymentType),
      humanStatus(s.status),
      Number(s.totalAmount || 0),
      itemsCount,
      formatSaleItemsList(s.items),
    ]);
  }

  const fileName = `relatorio_vendas_${from || formatDateForFileName()}_a_${to || formatDateForFileName()}.csv`;
  exportToCsvFile(rows, fileName);
}

function exportSalesXlsx() {
  const from = document.getElementById("fromDate")?.value || "";
  const to = document.getElementById("toDate")?.value || "";

  const rows = (cachedSalesForExport || []).map((s) => {
    const itemsCount = (s.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
    const itemsList = formatSaleItemsList(s.items);
    return {
      ID: s.id,
      "Data/Hora": isoToBR(s.createdAt),
      Pagamento: humanPayment(s.paymentType),
      Status: humanStatus(s.status),
      "Total (R$)": Number(s.totalAmount || 0),
      "Qtd. Itens": itemsCount,
      Itens: itemsList,
    };
  });

  const fileName = `relatorio_vendas_${from || formatDateForFileName()}_a_${to || formatDateForFileName()}.xlsx`;
  exportJsonToXlsxFile(rows, "Relatório", fileName, [10, 22, 14, 12, 14, 12, 60]);
}

/* =========================
   PRODUTOS (PAINEL)
========================= */

async function loadProductsPanel() {
  const msg = document.getElementById("productsMsg");
  if (msg) msg.textContent = "";

  safeSetLoading(true);

  try {
    const data = await apiFetch(`/products`);
    cachedProductsForPanel = (data || []).slice();
    applyProductsPanelFilter();

    // sincroniza com vendas
    products = (data || []).slice();
    buildCategoryBar(products);
    renderProducts(getActiveCategory(), getSalesSearchQuery());
  } catch (e) {
    if (msg) msg.textContent = normalizeApiError(e) || "Erro ao carregar produtos.";
  } finally {
    safeSetLoading(false);
  }
}

function applyProductsPanelFilter() {
  const q = (document.getElementById("productsSearch")?.value || "").trim().toLowerCase();
  const filtered = cachedProductsForPanel.filter((p) => {
    const name = String(p.name || "").toLowerCase();
    const cat = String(p.category || "").toLowerCase();
    return !q || name.includes(q) || cat.includes(q);
  });
  renderProductsTable(filtered);
}

function renderProductsTable(list) {
  const tbody = document.querySelector("#productsTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  (list || []).forEach((p) => {
    const tr = document.createElement("tr");
    const activeText = p.active === false ? "Inativo" : "Ativo";

    tr.innerHTML = `
      <td>${p.id}</td>
      <td>${escapeHtml(p.name || "")}</td>
      <td>${escapeHtml(p.category || "-")}</td>
      <td>${moneyBR(p.price)}</td>
      <td class="stock-col">${Number(p.stock ?? 0)}</td>
      <td>${activeText}</td>
      <td>
        <button class="btn-primary small" data-act="edit" type="button">Editar</button>
        <button class="btn-outline small" data-act="toggle" type="button">${p.active === false ? "Ativar" : "Desativar"}</button>
      </td>
    `;

    tr.querySelector("button[data-act='edit']")?.addEventListener("click", () => openProductModal(p));
    tr.querySelector("button[data-act='toggle']")?.addEventListener("click", () => toggleProductActive(p));

    tbody.appendChild(tr);
  });

  if (!list || list.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" style="text-align:center;opacity:.7;padding:12px">Nenhum produto cadastrado.</td>`;
    tbody.appendChild(tr);
  }
}

function openProductModal(product) {
  editingProductId = product?.id ?? null;

  const modal = document.getElementById("productModal");
  const title = document.getElementById("modalTitle");
  const msg = document.getElementById("modalMsg");
  if (msg) msg.textContent = "";

  document.getElementById("mName").value = product?.name ?? "";
  document.getElementById("mCategory").value = product?.category ?? "";
  document.getElementById("mPrice").value = product?.price ?? 0;
  document.getElementById("mStock").value = product?.stock ?? 0;
  document.getElementById("mActive").value = product?.active === false ? "false" : "true";

  const file = document.getElementById("mImage");
  if (file) file.value = "";

  if (title) title.textContent = editingProductId ? `Editar Produto #${editingProductId}` : "Novo Produto";
  if (modal) modal.style.display = "flex";
}

function closeProductModal() {
  const modal = document.getElementById("productModal");
  const msg = document.getElementById("modalMsg");
  if (msg) msg.textContent = "";
  editingProductId = null;
  if (modal) modal.style.display = "none";
}

async function toggleProductActive(product) {
  const msg = document.getElementById("productsMsg");
  if (msg) msg.textContent = "";

  safeSetLoading(true);

  try {
    const nextActive = product.active === false ? true : false;

    await apiFetch(`/products/${product.id}`, {
      method: "PUT",
      body: JSON.stringify({ active: nextActive }),
    });

    await loadProductsPanel();
  } catch (e) {
    if (msg) msg.textContent = normalizeApiError(e) || "Falha ao alterar status.";
  } finally {
    safeSetLoading(false);
  }
}

async function saveProductFromModal() {
  const msg = document.getElementById("modalMsg");
  if (msg) msg.textContent = "";

  const name = document.getElementById("mName").value.trim();
  const category = document.getElementById("mCategory").value.trim();
  const price = Number(document.getElementById("mPrice").value || 0);
  const stockEnabled = isStockEnabled();
  const stock = stockEnabled ? Number(document.getElementById("mStock").value || 0) : null;
  const active = document.getElementById("mActive").value === "true";

  if (!name) {
    if (msg) msg.textContent = "Nome do produto é obrigatório.";
    return;
  }
  if (Number.isNaN(price) || price < 0) {
    if (msg) msg.textContent = "Preço inválido.";
    return;
  }
  if (stockEnabled && (Number.isNaN(stock) || stock < 0)) {
    if (msg) msg.textContent = "Estoque inválido.";
    return;
  }

  safeSetLoading(true);

  try {
    let saved = null;
    const payload = { name, category: category || null, price, active };
    if (stockEnabled) payload.stock = stock;

    if (!editingProductId) {
      saved = await apiFetch(`/products`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } else {
      saved = await apiFetch(`/products/${editingProductId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    }

    const productId = saved?.id ?? editingProductId;
    if (!productId) throw new Error("Não foi possível obter o ID do produto.");

    const fileInput = document.getElementById("mImage");
    const file = fileInput?.files?.[0];

    if (file) {
      const maxMB = 5;
      const sizeMB = file.size / (1024 * 1024);
      if (sizeMB > maxMB) throw new Error(`Imagem muito grande. Máximo: ${maxMB}MB.`);
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(file.type)) throw new Error("Formato de imagem inválido. Use JPG/PNG/WebP.");

      const form = new FormData();
      form.append("productId", String(productId));
      form.append("image", file);
      await apiUpload(`/upload/product-image`, form);
    }

    await loadProductsPanel();
    await loadProducts();

    closeProductModal();
  } catch (e) {
    if (msg) msg.textContent = normalizeApiError(e) || "Erro ao salvar produto.";
  } finally {
    safeSetLoading(false);
  }
}

function exportProductsCsv() {
  const q = (document.getElementById("productsSearch")?.value || "").trim().toLowerCase();
  const list = cachedProductsForPanel.filter((p) => {
    const name = String(p.name || "").toLowerCase();
    const cat = String(p.category || "").toLowerCase();
    return !q || name.includes(q) || cat.includes(q);
  });

  const includeStock = isStockEnabled();
  const rows = [];
  rows.push(["Produtos (PDV)"]);
  rows.push([`Exportado em: ${new Date().toLocaleString("pt-BR")}`]);
  if (q) rows.push([`Filtro: ${q}`]);
  rows.push([]);
  rows.push(["ID", "Produto", "Categoria", "Preço (R$)", "Estoque", "Ativo", "Imagem (URL)"]);

  for (const p of list) {
    rows.push([
      p.id,
      p.name,
      p.category || "",
      Number(p.price || 0),
      Number(p.stock ?? 0),
      p.active === false ? "Não" : "Sim",
      p.imageUrl || "",
    ]);
  }

  const fileName = `produtos_${formatDateForFileName()}.csv`;
  exportToCsvFile(rows, fileName);
}

function exportProductsXlsx() {
  const q = (document.getElementById("productsSearch")?.value || "").trim().toLowerCase();
  const list = cachedProductsForPanel.filter((p) => {
    const name = String(p.name || "").toLowerCase();
    const cat = String(p.category || "").toLowerCase();
    return !q || name.includes(q) || cat.includes(q);
  });

  const rows = list.map((p) => ({
    ID: p.id,
    Produto: p.name,
    Categoria: p.category || "",
    "Preço (R$)": Number(p.price || 0),
    Estoque: Number(p.stock ?? 0),
    Ativo: p.active === false ? "Não" : "Sim",
    "Imagem (URL)": p.imageUrl || "",
  }));

  const fileName = `produtos_${formatDateForFileName()}.xlsx`;
  exportJsonToXlsxFile(rows, "Produtos", fileName, [8, 36, 20, 14, 10, 10, 40]);
}

/* =========================
   UI EVENTS
========================= */

function setupCategoryBar() {
  const bar = document.getElementById("categoryBar");
  if (!bar) return;

  bar.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".category");
    if (!btn) return;

    const category = btn.getAttribute("data-category") || "all";
    bar.querySelectorAll(".category").forEach((b) => b.classList.toggle("active", b === btn));
    renderProducts(category, getSalesSearchQuery());
  });
}

function setupSalesSearch() {
  const salesSearch = document.getElementById("salesSearch");
  if (!salesSearch) return;

  salesSearch.addEventListener("input", () => {
    renderProducts(getActiveCategory(), getSalesSearchQuery());
  });
}

function setupLoginUX() {
  // Tabs
  document.getElementById("tabLoginBtn")?.addEventListener("click", () => setAuthMode("login"));
  document.getElementById("tabRegisterBtn")?.addEventListener("click", () => setAuthMode("register"));

  // Submit forms
  document.getElementById("loginForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    login();
  });

  document.getElementById("registerForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    register();
  });

  // Forgot password UI
  const forgotLink = document.getElementById("forgotPasswordLink");
  const forgotBox = document.getElementById("forgotBox");
  const forgotEmail = document.getElementById("forgotEmail");
  const forgotSendBtn = document.getElementById("forgotSendBtn");
  const forgotCancelBtn = document.getElementById("forgotCancelBtn");
  const resendBtn = document.getElementById("resendVerificationBtn");

  const showForgot = () => {
    if (forgotBox) forgotBox.style.display = "block";
    forgotEmail?.focus?.();
  };
  const hideForgot = () => {
    if (forgotBox) forgotBox.style.display = "none";
    const msg = document.getElementById("forgotMsg");
    if (msg) msg.textContent = "";
  };

  forgotLink?.addEventListener("click", showForgot);
  forgotCancelBtn?.addEventListener("click", hideForgot);
  forgotSendBtn?.addEventListener("click", forgotPassword);
  resendBtn?.addEventListener("click", resendVerification);
  forgotEmail?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      forgotPassword();
    }
  });

  setupGoogleLoginUX();

  // Enter UX login
  const email = document.getElementById("email");
  const pass = document.getElementById("password");

  email?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      pass?.focus();
    }
  });

  pass?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      login();
    }
  });

  // Enter UX register
  const regName = document.getElementById("regName");
  const regEmail = document.getElementById("regEmail");
  const regPass = document.getElementById("regPassword");
  const regMerchantName = document.getElementById("regMerchantName");

  regName?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      regEmail?.focus?.();
    }
  });
  regEmail?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      regPass?.focus?.();
    }
  });
  regPass?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      regMerchantName?.focus?.();
    }
  });
  regMerchantName?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      register();
    }
  });

  setAuthMode("login");
}

function setupModalUX() {
  const modal = document.getElementById("productModal");
  const closeBtn = document.getElementById("closeProductModalBtn");
  const cancelBtn = document.getElementById("cancelProductBtn");

  closeBtn?.addEventListener("click", closeProductModal);
  cancelBtn?.addEventListener("click", closeProductModal);

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeProductModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const isOpen = modal && modal.style.display === "flex";
      if (isOpen) closeProductModal();
    }
  });
}

function setupButtons() {
  document.getElementById("logoutBtn")?.addEventListener("click", logout);

  document.getElementById("finishSaleBtn")?.addEventListener("click", finishSale);
  document.getElementById("clearCartBtn")?.addEventListener("click", clearCart);

  document.getElementById("loadReportsBtn")?.addEventListener("click", loadReports);
  document.getElementById("exportCsvBtn")?.addEventListener("click", exportSalesCsv);
  document.getElementById("exportXlsxBtn")?.addEventListener("click", exportSalesXlsx);

  document.getElementById("newProductBtn")?.addEventListener("click", () => openProductModal(null));
  document.getElementById("saveProductBtn")?.addEventListener("click", saveProductFromModal);

  document.getElementById("exportProductsCsvBtn")?.addEventListener("click", exportProductsCsv);
  document.getElementById("exportProductsXlsxBtn")?.addEventListener("click", exportProductsXlsx);

  document.getElementById("productsSearch")?.addEventListener("input", applyProductsPanelFilter);
}

/* =========================
   INIT
========================= */

function init() {
  setupNav();
  setupCategoryBar();
  setupSalesSearch();
  setupButtons();
  setupModalUX();
  setupLoginUX();
  setupMerchantSettingsEvents();

  if (MOCK_MODE) {
    document.getElementById("loginBox").style.display = "none";
    document.getElementById("appRoot").style.display = "flex";
    hydrateTopBarInfo();
    setApiStatus(true, "API: Mock");
    startMaintenancePolling();
    Promise.resolve()
      .then(loadMerchantSettings)
      .then(loadProducts)
      .then(loadProductsPanel)
      .then(setDefaultReportDates)
      .catch(() => {});
  } else {
    pingApi();
    setInterval(pingApi, 15000);

    const token = getToken();
    if (token) {
      document.getElementById("loginBox").style.display = "none";
      document.getElementById("appRoot").style.display = "flex";

      hydrateTopBarInfo();
      setApiStatus(true, "API: Online");
      startMaintenancePolling();

      Promise.resolve()
        .then(loadMerchantSettings)
        .then(loadProducts)
        .then(loadProductsPanel)
        .then(setDefaultReportDates)
        .catch(() => logout());
    } else {
      document.getElementById("loginBox").style.display = "flex";
      document.getElementById("appRoot").style.display = "none";
      stopMaintenancePolling();
    }
  }

  renderCart();
}

init();
