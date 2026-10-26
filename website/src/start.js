(() => {
  const API = "https://bookedradar-platform.onrender.com";
  const form = document.getElementById("pilot-request");
  const preference = document.getElementById("contact-preference");
  const phoneField = document.getElementById("phone-field");
  const phone = document.getElementById("phone");
  const submit = document.getElementById("submit-request");
  const status = document.getElementById("status");
  const success = document.getElementById("success");
  const confirmation = document.getElementById("confirmation");
  const params = new URLSearchParams(location.search);
  const clean = (value, max) => String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, max);
  const source = clean(params.get("source") || params.get("utm_source"), 80) || "direct";
  const variant = clean(params.get("variant"), 40) || "branded_start";
  let sending = false;
  let receiptUncertain = false;
  let started = false;
  const REQUEST_TIMEOUT_MS = 20000;

  function metric(event) {
    try {
      const body = JSON.stringify({ event, trade: "unknown", source, variant });
      navigator.sendBeacon(`${API}/api/v1/public/growth-event`, new Blob([body], { type: "text/plain" }));
    } catch {}
  }

  async function sendRequest(body) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(`${API}/api/v1/public/proof-pilot`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error("submission_not_confirmed");
          return result;
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("submission_timeout"));
            controller.abort();
          }, REQUEST_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function updateContactChoice() {
    const wantsCall = preference.value === "phone";
    phoneField.hidden = !wantsCall;
    phone.disabled = !wantsCall;
    phone.required = wantsCall;
  }

  function markStarted() {
    if (started) return;
    started = true;
    metric("proof_pilot_start");
  }

  preference.addEventListener("change", updateContactChoice);
  form.addEventListener("focusin", markStarted, { once: true });
  updateContactChoice();
  form.hidden = false;
  metric("page_view");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending || receiptUncertain || !form.reportValidity()) return;
    markStarted();
    sending = true;
    submit.disabled = true;
    submit.textContent = "Sending your request…";
    status.textContent = "";
    const body = Object.fromEntries(new FormData(form).entries());
    body.source = source;
    body.variant = variant;
    try {
      const result = await sendRequest(body);
      success.querySelector("h2").textContent = result.duplicate ? "A request is already recorded." : "Request received.";
      confirmation.textContent = result.duplicate
        ? "A request using these contact details has already been submitted. Email randy@bookedradar.com to confirm its status or change your contact preference."
        : body.contactPreference === "phone"
        ? "You asked for a phone call. We’ll follow up at the number you provided."
        : "You chose email only. We’ll follow up by email, with no sales call.";
      form.hidden = true;
      success.hidden = false;
      success.focus();
    } catch {
      receiptUncertain = true;
      status.textContent = "We couldn’t confirm your request. It may have been received. Your details are still here. Online resubmission is paused. Please email randy@bookedradar.com for help; don’t submit repeatedly.";
    } finally {
      sending = false;
      submit.disabled = receiptUncertain;
      submit.textContent = receiptUncertain ? "Contact us to confirm" : "Request my pilot";
    }
  });
})();
