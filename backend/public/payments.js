/* =====================================================
 * PDV - Fluxo de pagamento (maquininha) com PaymentIntent
 * - Não altera o app.js (compatibilidade)
 * - Intercepta "Finalizar venda" para CREDIT/DEBIT/PIX
 * - Cria intent PENDING e faz polling até APPROVED/DECLINED/CANCELED/ERROR/EXPIRED
 * ===================================================== */

(function paymentsIntentUiBootstrap() {
  const IS_DEV =
    (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")) ||
    String(window?.__APP_CONFIG__?.ENV || "").toLowerCase() === "development" ||
    String(window?.__APP_CONFIG__?.NODE_ENV || "").toLowerCase() === "development";

  function $(id) {
    return document.getElementById(id);
  }

  function getCartArray() {
    if (Array.isArray(window.cart)) return window.cart;
    try {
      const v = window.eval('typeof cart !== "undefined" ? cart : null');
      if (Array.isArray(v)) return v;
    } catch {}
    return [];
  }

  function clearCartKeepMessage() {
    try {
      if (Array.isArray(window.cart)) window.cart = [];
      else window.eval('if (typeof cart !== "undefined") cart = [];');
    } catch {}

    if (typeof window.renderCart === "function") window.renderCart();
  }

  function setCartMsg(msg) {
    if (typeof window.setCartMessage === "function") return window.setCartMessage(msg);
    const el = $("cartMessage");
    if (el) el.textContent = String(msg || "");
  }

  function safeLoading(v) {
    if (typeof window.safeSetLoading === "function") return window.safeSetLoading(!!v);
    return undefined;
  }

  function money(v) {
    if (typeof window.moneyBR === "function") return window.moneyBR(v);
    try {
      return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    } catch {
      return `R$ ${Number(v || 0).toFixed(2)}`;
    }
  }

  function ensureModal() {
    if ($("paymentIntentModal")) return;

    const style = document.createElement("style");
    style.id = "paymentIntentStyle";
    style.textContent = `
      .pi-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:9999}
      .pi-card{width:min(520px,92vw);background:#0f172a;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px;box-shadow:0 20px 80px rgba(0,0,0,.45)}
      .pi-title{font-size:18px;font-weight:700;margin:0 0 6px 0}
      .pi-sub{margin:0 0 10px 0;color:#cbd5e1}
      .pi-row{display:flex;gap:10px;align-items:center}
      .pi-pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);font-size:12px}
      .pi-spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.25);border-top-color:#22c55e;border-radius:50%;animation:pi-spin 1s linear infinite}
      @keyframes pi-spin{to{transform:rotate(360deg)}}
      .pi-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}
      .pi-btn{appearance:none;border:none;border-radius:10px;padding:10px 12px;font-weight:700;cursor:pointer}
      .pi-btn-primary{background:#22c55e;color:#052e16}
      .pi-btn-ghost{background:rgba(255,255,255,.06);color:#e5e7eb;border:1px solid rgba(255,255,255,.10)}
      .pi-hidden{display:none !important}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement("div");
    overlay.id = "paymentIntentModal";
    overlay.className = "pi-overlay";
    overlay.innerHTML = `
      <div class="pi-card" role="dialog" aria-modal="true" aria-labelledby="piTitle" aria-describedby="piSub">
        <h3 class="pi-title" id="piTitle">Aguardando pagamento na maquininha…</h3>
        <p class="pi-sub" id="piSub">Não feche esta tela até o pagamento ser confirmado.</p>
        <div class="pi-row" style="margin-top:10px;flex-wrap:wrap">
          <span class="pi-pill"><span class="pi-spin" aria-hidden="true"></span><span id="piStatusText">PENDING</span></span>
          <span class="pi-pill">Intent: <strong id="piIntentId">-</strong></span>
          <span class="pi-pill">Venda: <strong id="piSaleId">-</strong></span>
          <span class="pi-pill">Total: <strong id="piTotal">-</strong></span>
        </div>
        <div class="pi-actions">
          <button id="piCloseBtn" class="pi-btn pi-btn-ghost pi-hidden" type="button">Fechar</button>
          <button id="piOkBtn" class="pi-btn pi-btn-primary pi-hidden" type="button">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function showModal({ intentId, saleId, totalAmount, statusText }) {
    ensureModal();
    const overlay = $("paymentIntentModal");
    if (!overlay) return;
    overlay.style.display = "flex";

    const piIntentId = $("piIntentId");
    const piSaleId = $("piSaleId");
    const piTotal = $("piTotal");
    const piStatusText = $("piStatusText");

    if (piIntentId) piIntentId.textContent = intentId != null ? String(intentId) : "-";
    if (piSaleId) piSaleId.textContent = saleId != null ? String(saleId) : "-";
    if (piTotal) piTotal.textContent = totalAmount != null ? money(totalAmount) : "-";
    if (piStatusText) piStatusText.textContent = String(statusText || "PENDING");

    const closeBtn = $("piCloseBtn");
    const okBtn = $("piOkBtn");
    if (closeBtn) closeBtn.classList.add("pi-hidden");
    if (okBtn) okBtn.classList.add("pi-hidden");
  }

  function setModalFinal({ title, subtitle, statusText }) {
    const titleEl = $("piTitle");
    const subEl = $("piSub");
    const stEl = $("piStatusText");
    const spinner = document.querySelector("#paymentIntentModal .pi-spin");

    if (titleEl) titleEl.textContent = String(title || "");
    if (subEl) subEl.textContent = String(subtitle || "");
    if (stEl) stEl.textContent = String(statusText || "");
    if (spinner) spinner.style.display = "none";

    const okBtn = $("piOkBtn");
    if (okBtn) okBtn.classList.remove("pi-hidden");
  }

  function hideModal() {
    const overlay = $("paymentIntentModal");
    if (overlay) overlay.style.display = "none";
  }

  let pollingTimer = null;

  function stopPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = null;
  }

  async function pollIntentUntilDone(intentId, { timeoutMs = 120000 } = {}) {
    const startedAt = Date.now();

    const tick = async () => {
      const elapsed = Date.now() - startedAt;
      if (elapsed > timeoutMs) {
        stopPolling();
        setModalFinal({
          title: "Pagamento pendente",
          subtitle: "Tempo excedido. Você pode tentar novamente ou confirmar mais tarde.",
          statusText: "TIMEOUT",
        });
        setCartMsg("Pagamento ainda pendente. Tente novamente ou aguarde a confirmação.");
        return;
      }

      try {
        const intent = await window.apiFetch(`/payments/intents/${encodeURIComponent(intentId)}`, {
          method: "GET",
        });

        const status = String(intent?.status || "PENDING").toUpperCase();
        const stEl = $("piStatusText");
        if (stEl) stEl.textContent = status;

        if (status === "APPROVED") {
          stopPolling();
          setModalFinal({
            title: "Venda aprovada",
            subtitle: "Pagamento confirmado. Estoque baixado e venda finalizada.",
            statusText: "APPROVED",
          });

          const approvedSaleId = intent?.saleId ?? intent?.sale?.id ?? "-";
          const approvedTotal = intent?.sale?.totalAmount ?? intent?.amount ?? 0;
          const printJobId = intent?.printJobId ?? intent?.sale?.printJobId ?? null;
          const printMsg = printJobId ? ` Comprovante na fila (#${printJobId}).` : " Comprovante enviado para impressão.";
          setCartMsg(`Venda #${approvedSaleId} aprovada com sucesso. Total: ${money(approvedTotal)}.${printMsg}`);

          clearCartKeepMessage();

          // Atualiza telas como no fluxo atual
          try {
            if (typeof window.loadProducts === "function") await window.loadProducts();
            if (typeof window.loadProductsPanel === "function") await window.loadProductsPanel();
            if (typeof window.setDefaultReportDates === "function") window.setDefaultReportDates();
            if (typeof window.loadReports === "function") await window.loadReports();
          } catch {}

          safeLoading(false);
          return;
        }

        if (status === "DECLINED" || status === "CANCELED" || status === "ERROR" || status === "EXPIRED") {
          stopPolling();
          setModalFinal({
            title: "Pagamento não aprovado",
            subtitle: "Você pode tentar novamente (carrinho foi mantido).",
            statusText: status,
          });
          setCartMsg(`Pagamento ${status}. Carrinho mantido para tentar novamente.`);
          safeLoading(false);
        }
      } catch (err) {
        // Falha temporária: mantém polling.
      }
    };

    await tick();
    pollingTimer = setInterval(tick, 2000);
  }

  async function finishSaleViaPaymentIntent() {
    const cartArr = getCartArray();
    if (IS_DEV) {
      try {
        console.debug("[payments] finishSale click", {
          cartSize: Array.isArray(cartArr) ? cartArr.length : 0,
          itemsSample: (cartArr || []).slice(0, 5).map((it) => ({
            productId: it?.productId,
            quantity: it?.quantity,
          })),
        });
      } catch {}
    }

    if (!Array.isArray(cartArr) || cartArr.length === 0) {
      setCartMsg("Carrinho vazio.");
      return;
    }

    if (typeof window.applyPaymentOptionsFromSettings === "function") {
      window.applyPaymentOptionsFromSettings();
    }

    const paymentType = String($("paymentType")?.value || "PIX").toUpperCase();

    if (typeof window.ensurePaymentAllowed === "function") {
      if (!window.ensurePaymentAllowed(paymentType)) {
        setCartMsg("Forma de pagamento desabilitada nas configurações do estabelecimento.");
        return;
      }
    }

    const items = cartArr.map((item) => ({
      productId: Number(item?.productId),
      quantity: Number(item?.quantity),
      unitPrice: item?.unitPrice,
    }));

    if (IS_DEV) {
      try {
        console.debug("[payments] create intent payload", {
          paymentType,
          itemsCount: items.length,
          itemsSample: items.slice(0, 5).map((it) => ({ productId: it.productId, quantity: it.quantity })),
        });
      } catch {}
    }

    safeLoading(true);
    setCartMsg("");

    try {
      const intent = await window.apiFetch(`/payments/intents`, {
        method: "POST",
        body: JSON.stringify({ paymentType, items }),
      });

      showModal({
        intentId: intent?.id,
        saleId: intent?.saleId ?? null,
        totalAmount:
          intent?.amount ??
          (typeof intent?.amountCents === "number" ? Number(intent.amountCents) / 100 : null),
        statusText: intent?.status || "PENDING",
      });

      const okBtn = $("piOkBtn");
      if (okBtn) {
        okBtn.onclick = () => {
          hideModal();
        };
      }

      await pollIntentUntilDone(intent?.id);
    } catch (err) {
      safeLoading(false);
      setCartMsg((typeof window.normalizeApiError === "function" && window.normalizeApiError(err)) || "Erro ao iniciar pagamento.");
    }
  }

  function interceptFinishSale() {
    const btn = $("finishSaleBtn");
    if (!btn) return;

    btn.addEventListener(
      "click",
      (e) => {
        try {
          const paymentType = String($("paymentType")?.value || "PIX").toUpperCase();
          if (paymentType === "CASH") return; // deixa o fluxo atual rodar

          // Intercepta e substitui o handler do app.js
          e.preventDefault();
          e.stopImmediatePropagation();

          finishSaleViaPaymentIntent();
        } catch {
          // fallback: deixa o fluxo atual
        }
      },
      true // capture
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", interceptFinishSale);
  } else {
    interceptFinishSale();
  }
})();

// Carrega UI de Terminais (pareamento) sem mexer no index.html
(() => {
  try {
    if (document.getElementById('terminalsUiScript')) return;
    const s = document.createElement('script');
    s.id = 'terminalsUiScript';
    s.src = 'terminals.js';
    s.defer = true;
    document.body.appendChild(s);
  } catch {}
})();
