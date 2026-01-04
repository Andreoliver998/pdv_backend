/* =====================================================
 * PDV - UI de Terminais/Maquininhas (pareamento)
 * - Injeta uma aba "Terminais" no painel sem alterar o app.js
 * - Usa /api/terminals (JWT) para listar/criar/revogar/gerar pairing code
 * - QR via qrcodejs (CDN) com fallback
 * ===================================================== */

(function terminalsUiBootstrap() {
  const IS_DEV =
    (typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) ||
    String(window?.__APP_CONFIG__?.ENV || '').toLowerCase() === 'development' ||
    String(window?.__APP_CONFIG__?.NODE_ENV || '').toLowerCase() === 'development';

  const QR_FALLBACK_TEXT = 'QR indispon\u00edvel \u2014 use o c\u00f3digo.';

  function isLoggedIn() {
    try {
      return typeof window.getToken === 'function' ? !!window.getToken() : false;
    } catch {
      return false;
    }
  }

  function ensureStyle() {
    if (document.getElementById('terminalsUiStyle')) return;
    const style = document.createElement('style');
    style.id = 'terminalsUiStyle';
    style.textContent = `
      .terminals-wrap{display:flex;flex-direction:column;gap:12px}
      .terminals-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .terminals-actions{display:flex;gap:8px;flex-wrap:wrap}
      .t-badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 10px;font-weight:800;font-size:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.06)}
      .t-badge.online{border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.12);color:#bbf7d0}
      .t-badge.offline{border-color:rgba(148,163,184,.35);background:rgba(148,163,184,.10);color:#e2e8f0}
      .t-badge.disabled{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.10);color:#fecaca}
      .t-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04)}
      .t-meta{display:flex;flex-direction:column;gap:2px}
      .t-name{font-weight:900}
      .t-sub{opacity:.85;font-size:12px}
      .t-btn{appearance:none;border:none;border-radius:10px;padding:9px 11px;font-weight:900;cursor:pointer}
      .t-btn-primary{background:#22c55e;color:#052e16}
      .t-btn-ghost{background:rgba(255,255,255,.06);color:#e5e7eb;border:1px solid rgba(255,255,255,.10)}
      .t-btn-danger{background:rgba(239,68,68,.15);color:#fecaca;border:1px solid rgba(239,68,68,.25)}
      .t-modal-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);z-index:9999}
      .t-modal{width:min(640px,92vw);background:#0f172a;color:#e5e7eb;border-radius:14px;padding:18px;border:1px solid rgba(255,255,255,.10);box-shadow:0 20px 80px rgba(0,0,0,.45)}
      .t-code{font-size:42px;letter-spacing:8px;font-weight:1000;text-align:center;margin:8px 0}
      .t-grid{display:grid;grid-template-columns:1fr 220px;gap:16px;align-items:start}
      @media (max-width:720px){.t-grid{grid-template-columns:1fr}}
      .t-qr{width:220px;height:220px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;overflow:hidden}
      .t-qr-box{min-height:180px;min-width:180px;display:flex;align-items:center;justify-content:center;text-align:center;padding:10px}
      .t-qr-box img,.t-qr-box canvas{width:180px;height:180px}
      .t-hint{opacity:.85;font-size:12px}
      .t-kv{display:flex;gap:10px;flex-wrap:wrap}
      .t-kv .t-pill{font-size:12px;border-radius:999px;padding:6px 10px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.06)}
    `;
    document.head.appendChild(style);
  }

  function ensureQrLib() {
    if (typeof window.QRCode === 'function') return Promise.resolve(true);
    if (ensureQrLib._promise) return ensureQrLib._promise;

    const existing = document.getElementById('qrcodejs');
    if (existing) {
      ensureQrLib._promise = new Promise((resolve) => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
          if (typeof window.QRCode === 'function') {
            clearInterval(timer);
            resolve(true);
            return;
          }
          if (Date.now() - startedAt > 1500) {
            clearInterval(timer);
            resolve(false);
          }
        }, 50);
      });
      return ensureQrLib._promise;
    }

    ensureQrLib._promise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.id = 'qrcodejs';
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.async = true;
      s.onload = () => resolve(typeof window.QRCode === 'function');
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });

    return ensureQrLib._promise;
  }

  function renderQr({ payload }) {
    const box = document.getElementById('tQrBox');
    if (!box) return;

    box.innerHTML = '';

    const text = String(payload || '').trim();
    if (!text) {
      box.textContent = QR_FALLBACK_TEXT;
      return;
    }

    if (IS_DEV) {
      try {
        console.debug('[TERMINAL PAIR] payload length:', text.length);
      } catch {}
    }

    if (typeof window.QRCode !== 'function') {
      box.textContent = QR_FALLBACK_TEXT;
      return;
    }

    try {
      // eslint-disable-next-line no-new
      new window.QRCode(box, {
        text,
        width: 180,
        height: 180,
        correctLevel: window.QRCode?.CorrectLevel?.M,
      });

      if (IS_DEV) {
        try {
          console.debug('[TERMINAL PAIR] render ok');
        } catch {}
      }
    } catch {
      box.textContent = QR_FALLBACK_TEXT;
    }
  }

  function ensureTab() {
    const nav = document.querySelector('.sidebar .nav');
    const main = document.querySelector('main');
    if (!nav || !main) return false;

    if (!document.getElementById('tab-terminals')) {
      const section = document.createElement('section');
      section.id = 'tab-terminals';
      section.className = 'tab-page';
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-label', 'Terminais');
      section.innerHTML = `
        <div class="page">
          <div class="terminals-wrap">
            <div class="terminals-head">
              <div>
                <h2 class="page-title">Terminais / Maquininhas</h2>
                <p class="page-sub">Conecte a maquininha pelo painel usando codigo de pareamento (6 digitos) ou QR.</p>
              </div>
              <div class="terminals-actions">
                <button id="tAddBtn" class="t-btn t-btn-primary" type="button">Adicionar maquininha</button>
                <button id="tRefreshBtn" class="t-btn t-btn-ghost" type="button">Atualizar</button>
              </div>
            </div>
            <div id="tMsg" class="hint" role="status" aria-live="polite"></div>
            <div id="tList"></div>
          </div>
        </div>
      `;
      main.appendChild(section);
    }

    if (!nav.querySelector('[data-tab="terminals"]')) {
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.setAttribute('data-tab', 'terminals');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.setAttribute('aria-controls', 'tab-terminals');
      btn.type = 'button';
      btn.innerHTML = '<span class="nav-dot" aria-hidden="true"></span><span>Terminais</span>';
      nav.appendChild(btn);

      // Quando outra aba for ativada (handler do app.js), garante que "Terminais" perca o estado ativo.
      // O app.js registra listeners apenas nos itens existentes no load, então precisamos manter consistência aqui.
      if (!nav.dataset.terminalsUiWired) {
        nav.dataset.terminalsUiWired = '1';
        nav.addEventListener(
          'click',
          (e) => {
            const clicked = e.target?.closest?.('.nav-item');
            if (!clicked) return;
            const tab = clicked.getAttribute('data-tab');
            if (tab === 'terminals') return;
            const terminalsBtn = nav.querySelector('[data-tab="terminals"]');
            terminalsBtn?.classList?.remove('active');
            document.getElementById('tab-terminals')?.classList?.remove('active');
          },
          true
        );
      }

      btn.addEventListener('click', async () => {
        document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-page').forEach((p) => p.classList.remove('active'));
        document.getElementById('tab-terminals')?.classList.add('active');
        await loadTerminals();
      });
    }

    return true;
  }

  function setMsg(text) {
    const el = document.getElementById('tMsg');
    if (el) el.textContent = text || '';
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR');
    } catch {
      return String(iso);
    }
  }

  function statusBadge(statusRaw) {
    const s = String(statusRaw || 'OFFLINE').toUpperCase();
    const cls = s === 'ONLINE' ? 'online' : s === 'DISABLED' ? 'disabled' : 'offline';
    return `<span class="t-badge ${cls}">${s}</span>`;
  }

  async function api(path, opts) {
    if (typeof window.apiFetch !== 'function') throw new Error('apiFetch not available');
    return window.apiFetch(path, opts);
  }

  async function loadTerminals() {
    if (!isLoggedIn()) return;
    setMsg('');
    const listEl = document.getElementById('tList');
    if (listEl) listEl.innerHTML = '';

    try {
      const data = await api('/terminals', { method: 'GET' });
      const terminals = data?.terminals || [];
      if (!Array.isArray(terminals) || terminals.length === 0) {
        if (listEl) listEl.innerHTML = `<div class="hint">Nenhuma maquininha cadastrada ainda.</div>`;
        return;
      }

      if (listEl) {
        listEl.innerHTML = terminals
          .map((t) => {
            const name = t?.name || `Terminal #${t?.id}`;
            const lastSeen = t?.lastSeenAt ? fmtDate(t.lastSeenAt) : 'Nunca';
            return `
              <div class="t-row" data-terminal-id="${t.id}">
                <div class="t-meta">
                  <div class="t-name">${name} ${statusBadge(t.status)}</div>
                  <div class="t-sub">Ultimo contato: ${lastSeen} • ID: ${t.id} • Identificador: ${t.identifier || '-'}</div>
                </div>
                <div class="terminals-actions">
                  <button class="t-btn t-btn-ghost" data-action="pair" type="button">Gerar codigo</button>
                  <button class="t-btn t-btn-danger" data-action="revoke" type="button">Revogar</button>
                </div>
              </div>
            `;
          })
          .join('');

        listEl.querySelectorAll('button[data-action="pair"]').forEach((b) =>
          b.addEventListener('click', async () => {
            const id = b.closest('[data-terminal-id]')?.getAttribute('data-terminal-id');
            if (!id) return;
            await openPairingModal(Number(id));
          })
        );

        listEl.querySelectorAll('button[data-action="revoke"]').forEach((b) =>
          b.addEventListener('click', async () => {
            const id = b.closest('[data-terminal-id]')?.getAttribute('data-terminal-id');
            if (!id) return;
            const ok = confirm('Revogar este terminal? A maquininha sera desconectada imediatamente.');
            if (!ok) return;
            await api(`/terminals/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: '{}' });
            await loadTerminals();
          })
        );
      }
    } catch (err) {
      setMsg((typeof window.normalizeApiError === 'function' && window.normalizeApiError(err)) || 'Erro ao carregar terminais.');
    }
  }

  function ensurePairingModal() {
    ensureStyle();
    if (document.getElementById('tPairingModal')) return;

    const overlay = document.createElement('div');
    overlay.className = 't-modal-overlay';
    overlay.id = 'tPairingModal';
    overlay.innerHTML = `
      <div class="t-modal" role="dialog" aria-modal="true" aria-labelledby="tPairTitle">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <h3 id="tPairTitle" class="page-title" style="margin:0">Conectar maquininha</h3>
            <div class="t-hint">No app da maquininha, escaneie o QR ou digite o codigo abaixo.</div>
          </div>
          <button id="tPairClose" class="t-btn t-btn-ghost" type="button">Fechar</button>
        </div>

        <div class="t-grid" style="margin-top:12px">
          <div>
            <div id="tPairCode" class="t-code">------</div>
            <div class="t-kv">
              <span class="t-pill">Expira em: <strong id="tPairExpires">-</strong></span>
              <span class="t-pill">API Base: <strong id="tPairApiBase">-</strong></span>
            </div>
            <div class="t-hint" style="margin-top:10px">
              Se o QR nao carregar, use o codigo manualmente.
            </div>
            <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
              <button id="tCopyCode" class="t-btn t-btn-primary" type="button">Copiar codigo</button>
              <button id="tCopyPayload" class="t-btn t-btn-ghost" type="button">Copiar QR payload</button>
            </div>
            <div id="tPairMsg" class="hint" style="margin-top:10px"></div>
          </div>
          <div class="t-qr">
            <div id="tQrBox" class="t-qr-box" aria-label="QR Code"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Garante que a caixa do QR nunca fique vazia (fallback visível).
    const qrBox = document.getElementById('tQrBox');
    if (qrBox && !String(qrBox.textContent || '').trim()) qrBox.textContent = QR_FALLBACK_TEXT;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
    document.getElementById('tPairClose')?.addEventListener('click', () => (overlay.style.display = 'none'));
  }

  let pairingTimer = null;

  function stopPairingTimer() {
    if (pairingTimer) clearInterval(pairingTimer);
    pairingTimer = null;
  }

  async function openProvisioningModal(deviceName) {
    ensurePairingModal();
    stopPairingTimer();

    const overlay = document.getElementById('tPairingModal');
    if (!overlay) return;

    const msgEl = document.getElementById('tPairMsg');
    if (msgEl) msgEl.textContent = '';

    overlay.style.display = 'flex';

    try {
      const trimmedName = String(deviceName || '').trim();
      const body = trimmedName ? JSON.stringify({ name: trimmedName }) : '{}';
      const data = await api('/terminals/pairing-codes', {
        method: 'POST',
        body,
      });

      const code = String(data?.code || '').trim();
      const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : null;
      const apiBase = String(data?.apiBase || '').trim();
      const qrPayload = JSON.stringify({
        apiBase,
        code,
        ...(String(deviceName || '').trim() ? { deviceName: String(deviceName).trim() } : {}),
      });

      const codeEl = document.getElementById('tPairCode');
      const expEl = document.getElementById('tPairExpires');
      const baseEl = document.getElementById('tPairApiBase');

      if (codeEl) codeEl.textContent = code || '------';
      if (baseEl) baseEl.textContent = apiBase || '-';

      const hasQr = await ensureQrLib();
      if (!hasQr && msgEl) msgEl.textContent = QR_FALLBACK_TEXT;
      renderQr({ payload: qrPayload });

      if (IS_DEV) {
        console.log('[TERMINAL PAIR] payload length:', String(qrPayload || '').length);
        console.log('[TERMINAL PAIR] render ok');
      }

      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(String(text || ''));
          if (msgEl) msgEl.textContent = 'Copiado.';
        } catch {
          if (msgEl) msgEl.textContent = 'Nao foi possivel copiar automaticamente.';
        }
      };

      document.getElementById('tCopyCode')?.addEventListener('click', () => copy(code), { once: true });
      document.getElementById('tCopyPayload')?.addEventListener('click', () => copy(qrPayload), { once: true });

      const tick = () => {
        if (!expiresAt) {
          if (expEl) expEl.textContent = '-';
          return;
        }
        const ms = expiresAt.getTime() - Date.now();
        if (ms <= 0) {
          if (expEl) expEl.textContent = 'Expirado';
          stopPairingTimer();
          return;
        }
        const sec = Math.floor(ms / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        if (expEl) expEl.textContent = `${m}:${s}`;
      };

      tick();
      pairingTimer = setInterval(tick, 1000);
    } catch (err) {
      if (msgEl) msgEl.textContent = (typeof window.normalizeApiError === 'function' && window.normalizeApiError(err)) || 'Erro ao gerar codigo.';
      renderQr({ payload: '' });
    }
  }

  async function openPairingModal(terminalId) {
    ensurePairingModal();
    stopPairingTimer();

    const overlay = document.getElementById('tPairingModal');
    if (!overlay) return;

    const msgEl = document.getElementById('tPairMsg');
    if (msgEl) msgEl.textContent = '';

    overlay.style.display = 'flex';

    try {
      const data = await api(`/terminals/${encodeURIComponent(terminalId)}/pairing-code`, {
        method: 'POST',
        body: '{}',
      });

      const code = String(data?.pairingCode || '').trim();
      const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : null;
      const apiBase = String(data?.apiBase || '').trim();
      const qrPayload = String(data?.qrPayload || '').trim();

      const codeEl = document.getElementById('tPairCode');
      const expEl = document.getElementById('tPairExpires');
      const baseEl = document.getElementById('tPairApiBase');

      if (codeEl) codeEl.textContent = code || '------';
      if (baseEl) baseEl.textContent = apiBase || '-';

      const hasQr = await ensureQrLib();
      if (!hasQr && msgEl) msgEl.textContent = QR_FALLBACK_TEXT;
      renderQr({ payload: qrPayload });

      const copy = async (text) => {
        try {
          await navigator.clipboard.writeText(String(text || ''));
          if (msgEl) msgEl.textContent = 'Copiado.';
        } catch {
          if (msgEl) msgEl.textContent = 'Nao foi possivel copiar automaticamente.';
        }
      };

      document.getElementById('tCopyCode')?.addEventListener('click', () => copy(code), { once: true });
      document.getElementById('tCopyPayload')?.addEventListener('click', () => copy(qrPayload), { once: true });

      const tick = () => {
        if (!expiresAt) {
          if (expEl) expEl.textContent = '-';
          return;
        }
        const ms = expiresAt.getTime() - Date.now();
        if (ms <= 0) {
          if (expEl) expEl.textContent = 'Expirado';
          stopPairingTimer();
          return;
        }
        const sec = Math.floor(ms / 1000);
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        if (expEl) expEl.textContent = `${m}:${s}`;
      };

      tick();
      pairingTimer = setInterval(tick, 1000);
    } catch (err) {
      if (msgEl) msgEl.textContent = (typeof window.normalizeApiError === 'function' && window.normalizeApiError(err)) || 'Erro ao gerar codigo.';
      renderQr({ payload: '' });
    }
  }

  function wireButtons() {
    document.getElementById('tAddBtn')?.addEventListener('click', async () => {
      const name = prompt('Nome da maquininha (opcional):', 'Maquininha');
      if (name === null) return; // Cancelado: nao chama endpoint.
      try {
        // Fase 2: gera apenas um c\u00f3digo 6 d\u00edgitos + QR (sem criar terminal no banco).
        // O terminal ser\u00e1 criado quando a maquininha/app chamar /api/terminals/claim.
        await openProvisioningModal(name);
      } catch (err) {
        setMsg((typeof window.normalizeApiError === 'function' && window.normalizeApiError(err)) || 'Erro ao gerar codigo.');
      }
    });

    document.getElementById('tRefreshBtn')?.addEventListener('click', loadTerminals);
  }

  function init() {
    ensureStyle();
    if (!ensureTab()) return;
    wireButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
