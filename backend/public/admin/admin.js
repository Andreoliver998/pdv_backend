(function adminPortal() {
  const TOKEN_KEY = "pdv_admin_token";
  const state = {
    merchantId: null,
    merchant: null,
    tab: "summary",
    templates: null,
  };

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

  function $(id) {
    return document.getElementById(id);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = String(text || "");
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, String(token));
  }

  function normalizeApiError(err) {
    const raw = String(err?.message || "");
    if (!raw) return "Erro inesperado.";
    if (raw.includes("Failed to fetch")) return "Não foi possível conectar à API. Verifique o servidor.";
    if (Number(err?.status || 0) === 401) return "Sessão expirada. Faça login novamente.";
    return raw;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function badgeStatus(status) {
    const s = String(status || "").toUpperCase();
    const cls = s === "SUSPENDED" ? "suspended" : "active";
    const label = s === "SUSPENDED" ? "SUSPENSO" : s === "ACTIVE" ? "ATIVO" : s || "-";
    return `<span class="badge ${cls}">${label}</span>`;
  }

  function badgeChip(label, value, cls) {
    const safeLabel = escapeHtml(label);
    const safeValue = escapeHtml(value);
    return `<span class="badge ${cls || ""}"><span class="mono">${safeLabel}</span>&nbsp;${safeValue}</span>`;
  }

  function formatDateTime(iso) {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleString("pt-BR");
    } catch {
      return String(iso);
    }
  }

  function toLocalDatetimeInputValue(date) {
    if (!date) return "";
    try {
      const d = new Date(date);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  async function apiFetch(path, options = {}) {
    const token = getToken();
    const headers = {
      Accept: "application/json",
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const hasBody = options.body !== undefined && options.body !== null;
    if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...options, headers });
    } catch {
      throw new Error("Failed to fetch");
    }

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
      const e = new Error(msg);
      e.status = res.status;
      e.data = data;

      if (res.status === 401) {
        setToken("");
        showLogin(true);
        setText("loginMsg", "Sessão expirada. Faça login novamente.");
      }
      throw e;
    }

    return data;
  }

  function showLogin(show) {
    const loginCard = $("loginCard");
    const appCard = $("appCard");
    const logoutBtn = $("logoutBtn");

    document.body?.classList?.toggle?.("is-login", Boolean(show));

    if (loginCard) loginCard.style.display = show ? "block" : "none";
    if (appCard) appCard.style.display = show ? "none" : "grid";
    if (logoutBtn) logoutBtn.style.display = show ? "none" : "inline-flex";
  }

  function toast(text, kind = "info") {
    const msgId = kind === "maintenance" ? "maintenanceMsg" : kind === "details" ? "detailsMsg" : "listMsg";
    setText(msgId, text);
  }

  async function loadHealth() {
    const res = await apiFetch("/admin/health", { method: "GET" });
    const who = res?.admin ? `${res.admin.email} (${res.admin.role})` : "-";
    setText("adminWho", who);
  }

  function renderStats(stats) {
    setText("statActive", stats?.active ?? "-");
    setText("statSuspended", stats?.suspended ?? "-");
    setText("statSales", stats?.sales ?? "-");
    setText("statTerminals", stats?.terminals ?? "-");
    setText("listSummary", stats?.total != null ? `${stats.total} cliente(s)` : "");
  }

  function renderMerchantsTable(merchants) {
    const body = $("merchantsBody");
    if (!body) return;

    if (!Array.isArray(merchants) || merchants.length === 0) {
      body.innerHTML = "";
      toast("Nenhum cliente encontrado.");
      return;
    }

    body.innerHTML = merchants
      .map((m) => {
        const store = escapeHtml(m.tradeName || m.name || "-");
        const ownerName = escapeHtml(m.owner?.name || "-");
        const ownerEmail = escapeHtml(m.owner?.email || "-");
        const phone = escapeHtml(m.phone || "-");
        const lastAct = escapeHtml(formatDateTime(m.lastActivityAt));
        const sales = escapeHtml(String(m.counts?.sales ?? 0));
        const terminals = escapeHtml(String(m.counts?.terminals ?? 0));

        const statusBadge = badgeStatus(m.status);
        const viewBtn = `<button class="btn-ghost" data-action="view" data-id="${m.id}" type="button">Ver</button>`;
        const emailBtn = `<button class="btn-outline" data-action="email" data-id="${m.id}" type="button">E-mail</button>`;
        const suspendBtn =
          String(m.status).toUpperCase() === "SUSPENDED"
            ? `<button class="btn-success" data-action="activate" data-id="${m.id}" type="button">Reativar</button>`
            : `<button class="btn-danger" data-action="suspend" data-id="${m.id}" type="button">Suspender</button>`;
        const accessBtn = m.isLoginBlocked
          ? `<button class="btn-outline" data-action="unblock" data-id="${m.id}" type="button">Desbloquear</button>`
          : `<button class="btn-ghost" data-action="block" data-id="${m.id}" type="button">Bloquear login</button>`;

        return `
          <tr>
            <td>${statusBadge}</td>
            <td>
              <div class="mono">${store}</div>
              <div class="hint" style="margin:4px 0 0 0">#${m.id} · ${escapeHtml(m.cnpj || "")}</div>
            </td>
            <td>${ownerName}</td>
            <td class="mono">${ownerEmail}</td>
            <td class="mono">${phone}</td>
            <td class="mono">${sales}</td>
            <td class="mono">${terminals}</td>
            <td class="mono">${lastAct}</td>
            <td>
              <div class="row">
                ${viewBtn}
                ${emailBtn}
                ${accessBtn}
                ${suspendBtn}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    body.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const action = btn.getAttribute("data-action");
        if (!id || !action) return;
        await handleMerchantAction(action, id);
      });
    });
  }

  function currentListFilters() {
    const query = String($("queryInput")?.value || "").trim();
    const status = String($("statusSelect")?.value || "").trim();
    const sort = String($("sortSelect")?.value || "").trim();
    return { query, status, sort };
  }

  async function loadMerchants() {
    toast("");
    const { query, status, sort } = currentListFilters();
    const qs = new URLSearchParams();
    if (query) qs.set("query", query);
    if (status) qs.set("status", status);
    if (sort) qs.set("sort", sort);

    try {
      const res = await apiFetch(`/admin/merchants?${qs.toString()}`, { method: "GET" });
      renderStats(res?.stats || null);
      renderMerchantsTable(res?.merchants || []);
    } catch (err) {
      toast(normalizeApiError(err));
    }
  }

  async function handleMerchantAction(action, id) {
    if (action === "view") return showMerchantDetails(id, "summary");
    if (action === "email") return showMerchantDetails(id, "communication");

    if (action === "suspend") {
      const reason = prompt("Motivo da suspensão (opcional):", "Conta suspensa. Contate o suporte.");
      try {
        await apiFetch(`/admin/merchants/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: "SUSPENDED", reason: String(reason || "").trim() || undefined }),
        });
        await loadMerchants();
        if (String(state.merchantId) === String(id)) await showMerchantDetails(id, state.tab);
      } catch (err) {
        toast(normalizeApiError(err));
      }
      return;
    }

    if (action === "activate") {
      try {
        await apiFetch(`/admin/merchants/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) });
        await loadMerchants();
        if (String(state.merchantId) === String(id)) await showMerchantDetails(id, state.tab);
      } catch (err) {
        toast(normalizeApiError(err));
      }
      return;
    }

    if (action === "block") {
      const reason = prompt("Motivo do bloqueio (opcional):", "Acesso bloqueado pelo suporte.");
      try {
        await apiFetch(`/admin/merchants/${id}/access`, {
          method: "PATCH",
          body: JSON.stringify({ isLoginBlocked: true, reason: String(reason || "").trim() || undefined }),
        });
        await loadMerchants();
        if (String(state.merchantId) === String(id)) await showMerchantDetails(id, state.tab);
      } catch (err) {
        toast(normalizeApiError(err));
      }
      return;
    }

    if (action === "unblock") {
      try {
        await apiFetch(`/admin/merchants/${id}/access`, { method: "PATCH", body: JSON.stringify({ isLoginBlocked: false }) });
        await loadMerchants();
        if (String(state.merchantId) === String(id)) await showMerchantDetails(id, state.tab);
      } catch (err) {
        toast(normalizeApiError(err));
      }
    }
  }

  function renderDetails(merchant) {
    const el = $("detailsCard");
    if (!el) return;
    if (!merchant) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }

    const owner = Array.isArray(merchant.users) ? merchant.users.find((u) => String(u.role || "") === "OWNER") : null;
    const paymentStatus = merchant.paymentStatus || merchant.subscription?.status || "-";

    const chips = [
      badgeChip("Status:", String(merchant.status || "-"), ""),
      badgeChip("Pagamento:", String(paymentStatus || "-"), ""),
      merchant.isLoginBlocked ? badgeChip("Acesso:", "BLOQUEADO", "suspended") : badgeChip("Acesso:", "OK", "active"),
      merchant.lastLoginAt ? badgeChip("Último login:", formatDateTime(merchant.lastLoginAt), "") : badgeChip("Último login:", "-", ""),
      merchant.lastActivityAt ? badgeChip("Última atividade:", formatDateTime(merchant.lastActivityAt), "") : badgeChip("Última atividade:", "-", ""),
    ].join("");

    const canSuspend = String(merchant.status).toUpperCase() !== "SUSPENDED";
    const suspendBtn = canSuspend
      ? `<button class="btn-danger" id="detailsSuspendBtn" type="button">Suspender</button>`
      : `<button class="btn-success" id="detailsActivateBtn" type="button">Reativar</button>`;

    const accessBtn = merchant.isLoginBlocked
      ? `<button class="btn-outline" id="detailsUnblockBtn" type="button">Desbloquear login</button>`
      : `<button class="btn-ghost" id="detailsBlockBtn" type="button">Bloquear login</button>`;

    el.style.display = "block";
    el.innerHTML = `
      <div class="details-head">
        <div>
          <h2 style="margin:0">Cliente #${merchant.id} · ${escapeHtml(merchant.name || "-")}</h2>
          <div class="chips">${chips}</div>
        </div>
        <div class="row">
          ${accessBtn}
          ${suspendBtn}
        </div>
      </div>

      <div class="tabs" role="tablist" aria-label="Seções do cliente">
        <button class="tab-btn ${state.tab === "summary" ? "active" : ""}" data-tab="summary" type="button">Resumo</button>
        <button class="tab-btn ${state.tab === "communication" ? "active" : ""}" data-tab="communication" type="button">Comunicação</button>
        <button class="tab-btn ${state.tab === "audit" ? "active" : ""}" data-tab="audit" type="button">Auditoria</button>
        <button class="tab-btn ${state.tab === "terminals" ? "active" : ""}" data-tab="terminals" type="button">Terminais</button>
      </div>

      <div id="detailsMsg" class="hint"></div>

      <div id="tab-summary" class="tab-panel ${state.tab === "summary" ? "active" : ""}">
        <div class="split">
          <div class="card" style="padding:12px">
            <div class="hint" style="margin:0 0 6px 0">Dados</div>
            <div class="row">
              <div class="badge mono">Loja: ${escapeHtml(merchant.settings?.tradeName || merchant.name || "-")}</div>
              <div class="badge mono">Documento: ${escapeHtml(merchant.cnpj || "-")}</div>
              <div class="badge mono">Telefone: ${escapeHtml(merchant.settings?.phone || "-")}</div>
            </div>
            <div class="row" style="margin-top:8px">
              <div class="badge mono">Cadastro: ${escapeHtml(formatDateTime(merchant.createdAt))}</div>
              <div class="badge mono">Vendas: ${escapeHtml(String(merchant._count?.sales ?? merchant.counts?.sales ?? 0))}</div>
              <div class="badge mono">Terminais: ${escapeHtml(String(merchant._count?.terminals ?? merchant.counts?.terminals ?? 0))}</div>
            </div>
            <div class="row" style="margin-top:8px">
              <div class="badge mono">Owner: ${escapeHtml(owner?.name || "-")} · ${escapeHtml(owner?.email || "-")}</div>
            </div>
          </div>

          <div class="card" style="padding:12px">
            <div class="hint" style="margin:0 0 6px 0">Observações internas</div>
            <textarea id="adminNotesInput" rows="6" placeholder="Anotações internas...">${escapeHtml(merchant.adminNotes || "")}</textarea>
            <div class="row" style="margin-top:10px;justify-content:flex-end">
              <button id="saveNotesBtn" class="btn-primary" type="button">Salvar notas</button>
            </div>
          </div>
        </div>
      </div>

      <div id="tab-communication" class="tab-panel ${state.tab === "communication" ? "active" : ""}">
        <div class="split">
          <div class="card" style="padding:12px">
            <div class="hint" style="margin:0 0 6px 0">Enviar e-mail</div>
            <div class="row">
              <label style="min-width:260px">
                <span>Template</span>
                <select id="emailTemplateSelect"></select>
              </label>
              <label style="flex:1;min-width:260px">
                <span>Assunto</span>
                <input id="emailSubject" type="text" placeholder="Assunto..." />
              </label>
            </div>
            <label style="margin-top:10px">
              <span>Mensagem (opcional)</span>
              <textarea id="emailMessage" rows="6" placeholder="Se vazio, usa o template."></textarea>
            </label>
            <div class="row" style="margin-top:10px;justify-content:flex-end">
              <button id="sendEmailBtn" class="btn-primary" type="button">Enviar</button>
            </div>
          </div>

          <div class="card" style="padding:12px">
            <div class="row between" style="margin-bottom:10px">
              <div class="hint" style="margin:0">Histórico</div>
              <button id="refreshEmailsBtn" class="btn-ghost" type="button">Atualizar</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Status</th>
                    <th>Assunto</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody id="emailLogsBody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div id="tab-audit" class="tab-panel ${state.tab === "audit" ? "active" : ""}">
        <div class="row between" style="margin-bottom:10px">
          <div class="hint" style="margin:0">Eventos recentes</div>
          <button id="refreshAuditBtn" class="btn-ghost" type="button">Atualizar</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Ator</th>
                <th>Ação</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody id="auditBody"></tbody>
          </table>
        </div>
      </div>

      <div id="tab-terminals" class="tab-panel ${state.tab === "terminals" ? "active" : ""}">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nome</th>
                <th>Identificador</th>
                <th>Status</th>
                <th>Último contato</th>
              </tr>
            </thead>
            <tbody>
              ${
                Array.isArray(merchant.terminals) && merchant.terminals.length
                  ? merchant.terminals
                      .map((t) => {
                        return `
                          <tr>
                            <td class="mono">${escapeHtml(String(t.id))}</td>
                            <td>${escapeHtml(t.name || "-")}</td>
                            <td class="mono">${escapeHtml(t.identifier || "-")}</td>
                            <td class="mono">${escapeHtml(String(t.status || "-"))}</td>
                            <td class="mono">${escapeHtml(formatDateTime(t.lastSeenAt))}</td>
                          </tr>
                        `;
                      })
                      .join("")
                  : `<tr><td colspan="5" class="hint">Nenhum terminal cadastrado.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    el.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tab = btn.getAttribute("data-tab");
        if (!tab) return;
        await switchTab(tab);
      });
    });

    $("saveNotesBtn")?.addEventListener("click", async () => {
      const adminNotes = String($("adminNotesInput")?.value || "").trim();
      try {
        await apiFetch(`/admin/merchants/${merchant.id}`, { method: "PATCH", body: JSON.stringify({ adminNotes }) });
        toast("Notas salvas.", "details");
        await showMerchantDetails(merchant.id, state.tab);
      } catch (err) {
        toast(normalizeApiError(err), "details");
      }
    });

    $("detailsSuspendBtn")?.addEventListener("click", async () => handleMerchantAction("suspend", String(merchant.id)));
    $("detailsActivateBtn")?.addEventListener("click", async () => handleMerchantAction("activate", String(merchant.id)));
    $("detailsBlockBtn")?.addEventListener("click", async () => handleMerchantAction("block", String(merchant.id)));
    $("detailsUnblockBtn")?.addEventListener("click", async () => handleMerchantAction("unblock", String(merchant.id)));

    // Primeiro carregamento de dados dos tabs
    void ensureCommunicationUi();
    void loadEmailLogs();
    void loadAuditLogs();
  }

  async function switchTab(tab) {
    state.tab = tab;
    renderDetails(state.merchant);
  }

  async function showMerchantDetails(id, tab) {
    toast("");
    try {
      const res = await apiFetch(`/admin/merchants/${id}`, { method: "GET" });
      state.merchantId = String(id);
      state.merchant = res?.merchant || null;
      state.tab = tab || "summary";
      renderDetails(state.merchant);
    } catch (err) {
      toast(normalizeApiError(err));
    }
  }

  async function loadEmailTemplates() {
    if (Array.isArray(state.templates)) return state.templates;
    const res = await apiFetch("/admin/email-templates", { method: "GET" });
    state.templates = Array.isArray(res?.templates) ? res.templates : [];
    return state.templates;
  }

  async function ensureCommunicationUi() {
    if (!state.merchant) return;

    const select = $("emailTemplateSelect");
    if (!select) return;

    const templates = await loadEmailTemplates();

    select.innerHTML = [
      `<option value="">(mensagem personalizada)</option>`,
      ...templates.map((t) => `<option value="${escapeHtml(t.key)}">${escapeHtml(t.key)}</option>`),
    ].join("");

    select.addEventListener("change", () => {
      const key = String(select.value || "").trim();
      const tmpl = templates.find((t) => String(t.key) === key);
      const subj = $("emailSubject");
      const msg = $("emailMessage");
      if (tmpl && subj && !String(subj.value || "").trim()) subj.value = String(tmpl.subject || "");
      if (msg && String(msg.value || "").trim()) return; // não sobrescreve texto do operador
    });

    $("sendEmailBtn")?.addEventListener("click", async () => {
      if (!state.merchant) return;
      const templateKey = String($("emailTemplateSelect")?.value || "").trim();
      const subject = String($("emailSubject")?.value || "").trim();
      const message = String($("emailMessage")?.value || "").trim();

      try {
        await apiFetch(`/admin/merchants/${state.merchant.id}/email`, {
          method: "POST",
          body: JSON.stringify({
            templateKey: templateKey || undefined,
            subject: subject || undefined,
            message: message || undefined,
          }),
        });
        toast("E-mail enviado (ou enfileirado).", "details");
        $("emailMessage").value = "";
        await loadEmailLogs();
      } catch (err) {
        toast(normalizeApiError(err), "details");
      }
    });

    $("refreshEmailsBtn")?.addEventListener("click", async () => loadEmailLogs());
  }

  async function loadEmailLogs() {
    if (!state.merchant) return;
    const body = $("emailLogsBody");
    if (!body) return;

    try {
      const res = await apiFetch(`/admin/merchants/${state.merchant.id}/emails`, { method: "GET" });
      const logs = Array.isArray(res?.logs) ? res.logs : [];
      body.innerHTML = logs.length
        ? logs
            .map((l) => {
              return `
                <tr>
                  <td class="mono">${escapeHtml(formatDateTime(l.createdAt))}</td>
                  <td class="mono">${escapeHtml(String(l.status || "-"))}</td>
                  <td>${escapeHtml(l.subject || "-")}</td>
                  <td class="hint">${escapeHtml(l.errorMessage || "")}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="4" class="hint">Nenhum e-mail enviado.</td></tr>`;
    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="hint">${escapeHtml(normalizeApiError(err))}</td></tr>`;
    }
  }

  async function loadAuditLogs() {
    if (!state.merchant) return;
    const body = $("auditBody");
    if (!body) return;

    try {
      const res = await apiFetch(`/admin/merchants/${state.merchant.id}/audit`, { method: "GET" });
      const logs = Array.isArray(res?.logs) ? res.logs : [];
      body.innerHTML = logs.length
        ? logs
            .map((l) => {
              const actor = `${l.actorType}:${l.actorId}`;
              return `
                <tr>
                  <td class="mono">${escapeHtml(formatDateTime(l.createdAt))}</td>
                  <td class="mono">${escapeHtml(actor)}</td>
                  <td class="mono">${escapeHtml(String(l.action || "-"))}</td>
                  <td class="mono">${escapeHtml(String(l.ip || ""))}</td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="4" class="hint">Sem eventos.</td></tr>`;
    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="hint">${escapeHtml(normalizeApiError(err))}</td></tr>`;
    }
  }

  async function loadMaintenance() {
    const card = $("maintenanceCard");
    if (!card) return;

    try {
      const res = await apiFetch("/admin/system/maintenance", { method: "GET" });
      const m = res?.maintenance || null;

      card.style.display = "block";
      setText("maintenanceStatus", m?.enabled ? "ATIVO" : "DESLIGADO");
      $("maintenanceEnabled").value = String(Boolean(m?.enabled));
      $("maintenanceMessage").value = String(m?.message || "");
      $("maintenanceStartsAt").value = toLocalDatetimeInputValue(m?.startsAt);
      $("maintenanceEndsAt").value = toLocalDatetimeInputValue(m?.endsAt);
      toast("", "maintenance");
    } catch (err) {
      card.style.display = "block";
      toast(normalizeApiError(err), "maintenance");
    }
  }

  async function saveMaintenance() {
    const enabled = $("maintenanceEnabled")?.value === "true";
    const message = String($("maintenanceMessage")?.value || "").trim();
    const startsAt = String($("maintenanceStartsAt")?.value || "").trim();
    const endsAt = String($("maintenanceEndsAt")?.value || "").trim();

    try {
      await apiFetch("/admin/system/maintenance", {
        method: "POST",
        body: JSON.stringify({
          enabled,
          message: message || null,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
        }),
      });
      toast("Modo manutenção atualizado.", "maintenance");
      await loadMaintenance();
    } catch (err) {
      toast(normalizeApiError(err), "maintenance");
    }
  }

  async function doLogin() {
    setText("loginMsg", "");
    const email = String($("loginEmail")?.value || "").trim();
    const password = String($("loginPassword")?.value || "");

    try {
      const res = await apiFetch("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setToken(res?.token || "");
      showLogin(false);
      await loadHealth();
      await loadMerchants();
      await loadMaintenance();
    } catch (err) {
      setText("loginMsg", normalizeApiError(err));
    }
  }

  async function forgotPassword() {
    setText("loginMsg", "");
    const email = String($("loginEmail")?.value || "").trim();
    if (!email) return setText("loginMsg", "Informe o e-mail para reenviar o link.");

    try {
      const res = await apiFetch("/admin/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setText("loginMsg", res?.message || "Se existir uma conta admin com este e-mail, enviaremos um link de redefinição.");
    } catch (err) {
      setText("loginMsg", normalizeApiError(err));
    }
  }

  async function bootstrap() {
    $("logoutBtn")?.addEventListener("click", () => {
      setToken("");
      state.merchantId = null;
      state.merchant = null;
      setText("adminWho", "-");
      showLogin(true);
    });

    $("loginBtn")?.addEventListener("click", doLogin);
    $("forgotBtn")?.addEventListener("click", forgotPassword);
    $("refreshBtn")?.addEventListener("click", loadMerchants);
    $("queryInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadMerchants();
    });
    $("maintenanceSaveBtn")?.addEventListener("click", saveMaintenance);

    if (getToken()) {
      showLogin(false);
      try {
        await loadHealth();
        await loadMerchants();
        await loadMaintenance();
        return;
      } catch {
        setToken("");
      }
    }

    showLogin(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
