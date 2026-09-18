export function maskPhone(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 4) return "***";
  return `***${digits.slice(-4)}`;
}

export function leadLogSummary(lead = {}) {
  return {
    call_id: lead.call_id || null,
    callback: maskPhone(lead.callback_number),
    has_name: Boolean(lead.name),
    has_address: Boolean(lead.service_address || lead.city),
    service_type: lead.service_type || "",
    urgency: lead.urgency || "",
    preferred_window: lead.preferred_window || "",
  };
}
