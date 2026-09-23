import { fetchWithTimeout, HttpError, withRetry } from "./retry.js";

function splitName(fullName = "") {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
function wixHeaders(apiKey, siteId) { return { Authorization: apiKey, "wix-site-id": siteId, "Content-Type": "application/json" }; }
async function readJson(response) { const text = await response.text(); if (!text) return null; try { return JSON.parse(text); } catch { return { raw: text }; } }
async function wixFetch(url, options, { timeoutMs = 8000, retries = 3 } = {}) {
  return withRetry(async () => {
    const response = await fetchWithTimeout(url, options, timeoutMs);
    const data = await readJson(response);
    if (!response.ok) throw new HttpError(`Wix request failed (${response.status})`, { status: response.status, body: data });
    return data;
  }, { retries });
}
export async function findWixContact({
  apiKey,
  siteId,
  phone = "",
  email = "",
  timeoutMs = 8000,
  retries = 3,
}) {
  if (!apiKey || !siteId || (!phone && !email)) return null;

  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (phone) params.set("phone", phone);

  const url =
    "https://www.wixapis.com/contacts/v5/contacts/find-matching?" +
    params.toString();

  const data = await wixFetch(
    url,
    { headers: wixHeaders(apiKey, siteId) },
    { timeoutMs, retries }
  );

  return data?.contacts?.[0] || null;
}

export async function createWixContact({ apiKey, siteId, lead, previousContactId, previousName, timeoutMs = 8000, retries = 3 }) {
  if (!apiKey || !siteId) return { ok: false, skipped: true, reason: "wix_credentials_not_configured" };
  if (lead.callback_number || lead.email) {
    const existing = await findWixContact({ apiKey, siteId, phone: lead.callback_number || "", email: lead.email || "", timeoutMs, retries });
    if (existing?.id) {
      const supplied = splitName(lead.name);
      const current = existing.name || {};
      const comparable = (name) => [name.first, name.last].filter(Boolean).join(" ").trim().toLowerCase();
      const sameCallName = previousContactId === existing.id && previousName &&
        comparable(current) === comparable(splitName(previousName));
      const emptyName = !current.first && !current.last;
      const addingSurname = !current.last && current.first && supplied.last &&
        current.first.toLowerCase() === supplied.first?.toLowerCase();
      // A phone match alone does not authorize renaming an unrelated person.
      // Keep an existing surname when this save contains only a first name.
      const name = { ...current, ...supplied };
      const shouldUpdate = supplied.first && (sameCallName || emptyName || addingSurname) &&
        comparable(name) !== comparable(current);
      if (shouldUpdate) {
        if (existing.revision == null) throw new Error("Wix contact revision missing for name update");
        const data = await wixFetch(`https://www.wixapis.com/contacts/v5/contacts/${encodeURIComponent(existing.id)}`, {
          method: "PATCH", headers: wixHeaders(apiKey, siteId),
          body: JSON.stringify({ contact: { id: existing.id, revision: existing.revision, name }, allowDuplicates: false }),
        }, { timeoutMs, retries });
        if (data?.contact?.id !== existing.id) throw new Error("Wix name update did not return the expected contact");
        return { ok: true, reused: true, updated: true, contactId: existing.id, contact: data.contact };
      }
      return { ok: true, reused: true, contactId: existing.id, contact: existing };
    }
  }
  const contact = {};
  const name = splitName(lead.name);
  if (name.first || name.last) contact.name = name;
  if (lead.callback_number) contact.phone = { phone: lead.callback_number };
  if (lead.email) contact.email = { email: lead.email };
  if (!contact.name && !contact.phone && !contact.email) return { ok: false, skipped: true, reason: "insufficient_contact_identity" };
  const data = await wixFetch("https://www.wixapis.com/contacts/v5/contacts", { method: "POST", headers: wixHeaders(apiKey, siteId), body: JSON.stringify({ contact }) }, { timeoutMs, retries });
  return { ok: true, reused: false, contactId: data?.contact?.id || null, contact: data?.contact || null };
}
export async function createWixFollowupTask({ apiKey, siteId, contactId, lead, dueInMinutes = 15, timeoutMs = 8000, retries = 3 }) {
  if (!apiKey || !siteId || !contactId) return { ok: false, skipped: true, reason: "missing_task_prerequisite" };
  const due = new Date(Date.now() + dueInMinutes * 60000).toISOString();
  const service = lead.service_type || "service request";
  const details = [lead.name ? `Caller: ${lead.name}` : "", lead.callback_number ? `Callback: ${lead.callback_number}` : "", lead.service_type ? `Service: ${lead.service_type}` : "", lead.urgency ? `Urgency: ${lead.urgency}` : "", lead.preferred_window ? `Preferred window: ${lead.preferred_window}` : "", lead.service_address ? `Address: ${lead.service_address}` : "", lead.city ? `City: ${lead.city}` : "", lead.notes ? `Notes: ${lead.notes}` : "", lead.call_id ? `Call ID: ${lead.call_id}` : ""].filter(Boolean).join("\n");
  const data = await wixFetch("https://www.wixapis.com/crm/tasks/v2/tasks", { method: "POST", headers: wixHeaders(apiKey, siteId), body: JSON.stringify({ task: { title: `AI phone lead — ${service}`.slice(0, 200), description: details, dueDate: due, status: "ACTION_NEEDED", contact: { id: contactId } } }) }, { timeoutMs, retries });
  return { ok: true, taskId: data?.task?.id || null, task: data?.task || null };
}
export async function syncWixVoiceLead(opts) {
  const contact = await createWixContact(opts);
  if (!contact.ok) return { ok: false, contact, task: null };
  const task = await createWixFollowupTask({ ...opts, contactId: contact.contactId });
  return { ok: true, contact, task };
}
