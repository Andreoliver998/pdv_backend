(() => {
  function initPasswordToggles(root = document) {
    const buttons = root.querySelectorAll("[data-toggle-password]");
    buttons.forEach((btn) => {
      const selector = btn.getAttribute("data-toggle-password");
      const input = selector ? root.querySelector(selector) : null;
      if (!input) return;

      if (input.type !== "password" && input.type !== "text") return;

      const setState = (isOn) => {
        btn.classList.toggle("is-on", isOn);
        btn.setAttribute("aria-pressed", String(isOn));
        btn.setAttribute("aria-label", isOn ? "Ocultar senha" : "Mostrar senha");
        btn.title = isOn ? "Ocultar senha" : "Mostrar senha";
      };

      setState(input.type === "text");

      btn.addEventListener("click", () => {
        const isOn = input.type === "password";
        input.type = isOn ? "text" : "password";
        setState(isOn);

        input.focus();
        try {
          const len = String(input.value || "").length;
          input.setSelectionRange(len, len);
        } catch {}
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initPasswordToggles());
  } else {
    initPasswordToggles();
  }
})();

