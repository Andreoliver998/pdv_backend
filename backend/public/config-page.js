/* =========================
   PDV - Configurações (config-page.js)
   Apenas:
   - Dados da Empresa (merchant)
   - Trocar senha (usuário logado)
========================= */

function ensureRuntimeConfig() {
  if (typeof window === "undefined") return;
  if (!window.__APP_CONFIG__ || typeof window.__APP_CONFIG__ !== "object") window.__APP_CONFIG__ = {};
  if (!String(window.__APP_CONFIG__.API_BASE_URL ?? "").trim()) window.__APP_CONFIG__.API_BASE_URL = "/api";
}

function resolveApiBase() {
  ensureRuntimeConfig();
  const raw = String(window.__APP_CONFIG__?.API_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!raw) return "/api";
  if (raw.startsWith("/")) return raw;

  try {
    const url = new URL(raw);
    if (!url.pathname || url.pathname === "/") url.pathname = "/api";
    return url.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

const API_BASE = resolveApiBase();

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || "";
}

function getToken() {
  return localStorage.getItem("token");
}

function decodeJwtPayload(token) {
  const t = String(token || "").trim();
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function logout() {
  localStorage.removeItem("token");
  window.location.href = "./index.html";
}

function maskEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  const [name, domain] = e.split("@");
  if (!name || !domain) return "";
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : "";
  return `${head}***${tail}@${domain}`;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function apiFetch(path, init) {
  const url = `${API_BASE}${String(path || "").startsWith("/") ? "" : "/"}${String(path || "")}`;
  const token = getToken();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();
    const data = parseJsonSafe(text);

    if (!res.ok) {
      const message =
        (data && (data.message || data.error)) ||
        `HTTP ${res.status} ${res.statusText}`.trim();
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data ?? {};
  } catch (err) {
    if (err?.name === "AbortError") {
      const e = new Error("Timeout (10s) ao chamar a API.");
      e.code = "TIMEOUT";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function validateCompanyPayload(payload) {
  if (!payload.companyName) return "Informe o Nome da empresa.";
  if (payload.companyName.length > 120) return "Nome da empresa muito longo (máx 120).";

  if (payload.document) {
    const digits = onlyDigits(payload.document);
    if (!digits) return null;
    if (digits.length !== 11 && digits.length !== 14) {
      return "CPF/CNPJ deve ter 11 (CPF) ou 14 (CNPJ) dígitos.";
    }
  }
  return null;
}

function readCompanyForm() {
  const companyName = String(document.getElementById("companyName")?.value || "").trim();
  const tradeName = String(document.getElementById("tradeName")?.value || "").trim();
  const documentRaw = String(document.getElementById("document")?.value || "").trim();
  const phone = String(document.getElementById("phone")?.value || "").trim();
  const address = String(document.getElementById("address")?.value || "").trim();

  return {
    companyName,
    tradeName,
    document: onlyDigits(documentRaw),
    phone,
    address,
  };
}

function fillCompanyForm(data) {
  document.getElementById("companyName").value = String(data?.companyName || "");
  document.getElementById("tradeName").value = String(data?.tradeName || "");
  document.getElementById("document").value = String(data?.document || "");
  document.getElementById("phone").value = String(data?.phone || "");
  document.getElementById("address").value = String(data?.address || "");
}

async function loadCompanySettings() {
  setText("companyMsg", "Carregando...");
  try {
    const data = await apiFetch("/merchant-settings");
    fillCompanyForm(data);
    setText("companyMsg", "");
  } catch (err) {
    console.error("[CONFIG] load merchant-settings failed:", err);
    setText("companyMsg", err?.message || "Erro ao carregar dados.");
  }
}

async function saveCompanySettings(e) {
  e?.preventDefault?.();

  setText("companyMsg", "");
  const payload = readCompanyForm();

  const errMsg = validateCompanyPayload(payload);
  if (errMsg) {
    setText("companyMsg", errMsg);
    return;
  }

  const btn = document.getElementById("saveCompanyBtn");
  if (btn) btn.disabled = true;
  setText("companyMsg", "Salvando...");

  try {
    const updated = await apiFetch("/merchant-settings", {
      method: "PUT",
      body: JSON.stringify({
        companyName: payload.companyName,
        tradeName: payload.tradeName || null,
        document: payload.document || null,
        phone: payload.phone || null,
        address: payload.address || null,
      }),
    });

    fillCompanyForm(updated);
    setText("companyMsg", "Dados da empresa salvos com sucesso.");
  } catch (err) {
    console.error("[CONFIG] save merchant-settings failed:", err);
    setText("companyMsg", err?.message || "Erro ao salvar dados.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function changePassword(e) {
  e?.preventDefault?.();
  setText("changePasswordMsg", "");

  const currentPassword = String(document.getElementById("currentPassword")?.value || "");
  const newPassword = String(document.getElementById("newPassword")?.value || "");
  const confirmPassword = String(document.getElementById("confirmPassword")?.value || "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    setText("changePasswordMsg", "Preencha todos os campos.");
    return;
  }
  if (newPassword.length < 6) {
    setText("changePasswordMsg", "A nova senha deve ter pelo menos 6 caracteres.");
    return;
  }
  if (newPassword !== confirmPassword) {
    setText("changePasswordMsg", "A confirmação não confere.");
    return;
  }

  const btn = document.getElementById("changePasswordBtn");
  if (btn) btn.disabled = true;
  setText("changePasswordMsg", "Atualizando...");

  try {
    const res = await apiFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    setText("changePasswordMsg", res?.message || "Senha atualizada com sucesso.");
    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmPassword").value = "";
  } catch (err) {
    console.error("[CONFIG] change-password failed:", err);
    setText("changePasswordMsg", err?.message || "Erro ao atualizar senha.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function init() {
  console.log("[CONFIG] runtime", { __APP_CONFIG__: window.__APP_CONFIG__, API_BASE });

  setText("apiBaseInfo", API_BASE);
  setText("userNameInfo", localStorage.getItem("userName") || "-");
  const jwtEmail = decodeJwtPayload(getToken())?.email;
  setText("userEmailInfo", jwtEmail ? maskEmail(jwtEmail) : "");

  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("companyForm")?.addEventListener("submit", saveCompanySettings);
  document.getElementById("changePasswordForm")?.addEventListener("submit", changePassword);

  const docEl = document.getElementById("document");
  docEl?.addEventListener("input", () => {
    const digits = onlyDigits(docEl.value);
    docEl.value = digits;
  });

  const token = getToken();
  if (!token) {
    setText("companyMsg", "Faça login no PDV primeiro.");
    setText("changePasswordMsg", "Faça login no PDV primeiro.");
    return;
  }

  loadCompanySettings();
}

init();
