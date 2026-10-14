const form = document.getElementById("pilot-request");
const preference = document.getElementById("contact-preference");
const phoneField = document.getElementById("phone-field");
const phone = document.getElementById("phone");
const submit = document.getElementById("submit-request");
const status = document.getElementById("status");
const success = document.getElementById("success");
const confirmation = document.getElementById("confirmation");
let sending = false;
let receiptUncertain = false;
const REQUEST_TIMEOUT_MS = 20000;

// A timeout only means receipt is unknown. It does not undo a server-side write.
async function sendRequest(body) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch("/api/v1/public/proof-pilot", {
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
preference.addEventListener("change", updateContactChoice);
updateContactChoice();
// Keep personal details out of a default GET submission if JavaScript fails.
form.hidden = false;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || receiptUncertain || !form.reportValidity()) return;
  sending = true;
  submit.disabled = true;
  submit.textContent = "Sending your request…";
  status.textContent = "";
  const body = Object.fromEntries(new FormData(form).entries());
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
    // Never offer another write while receipt of this request is unknown.
    receiptUncertain = true;
    status.textContent = "We couldn’t confirm your request. Your request may have been received. Your details are still here. Online resubmission is paused. Please email randy@bookedradar.com for help; don’t submit repeatedly.";
  } finally {
    sending = false;
    submit.disabled = receiptUncertain;
    submit.textContent = receiptUncertain ? "Contact us to confirm" : "Request my pilot";
  }
});
