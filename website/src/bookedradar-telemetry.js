(() => {
  const script = document.currentScript;
  const rawEndpoint = String(script?.dataset?.endpoint || "").trim().replace(/\/$/, "");

  function safeEndpoint(value) {
    if (!value || value.includes("__")) return "";
    try {
      const url = new URL(value, window.location.href);
      const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
      if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
      return url.origin;
    } catch {
      return "";
    }
  }

  const endpoint = safeEndpoint(rawEndpoint);
  if (!endpoint || !window.crypto?.randomUUID) return;

  function track(type, path = window.location.pathname) {
    if (!["page_view", "cta_click", "audit_start", "audit_complete", "audit_submit"].includes(type)) return;
    const payload = JSON.stringify({
      eventId: crypto.randomUUID(),
      type,
      path,
    });
    fetch(`${endpoint}/api/v1/telemetry/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  }

  window.BookedRadarTelemetry = Object.freeze({ track });
  track("page_view");

  document.addEventListener("click", (event) => {
    const el = event.target?.closest?.("[data-br-event]");
    if (!el) return;
    const type = el.getAttribute("data-br-event");
    if (["cta_click", "audit_start"].includes(type)) track(type);
  }, { passive: true });
})();
