const ROLES = [
  ["plumbing", "BookedRadar Demo - Plumbing"],
  ["electrical", "BookedRadar Demo - Electrical"],
  ["roofing", "BookedRadar Demo - Roofing"],
  ["home-services", "BookedRadar Demo - Home Services"],
];

function authHeader(accountSid, authToken) {
  return "Basic " + Buffer.from(accountSid + ":" + authToken).toString("base64");
}
async function request(url, { accountSid, authToken, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader(accountSid, authToken),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const error = new Error("twilio_demo_number_request_failed");
    error.status = response.status;
    error.detail = data?.message || data?.code || "provider_error";
    throw error;
  }
  return data;
}
export async function provisionDemoNumbers({
  accountSid, authToken, existingDemoNumber, mode = "off", areaCode = "409", log = console.log,
} = {}) {
  if (mode === "off") return { ok: true, skipped: true };
  if (!/^AC[0-9a-f]{32}$/i.test(accountSid || "") || !authToken) throw new Error("twilio_credentials_missing");
  if (!/^\+[1-9]\d{7,14}$/.test(existingDemoNumber || "")) throw new Error("existing_demo_number_missing");

  const trunksData = await request("https://trunking.twilio.com/v1/Trunks?PageSize=50", { accountSid, authToken });
  const trunks = trunksData?.trunks || [];
  let trunkSid = "";
  for (const trunk of trunks) {
    const numbers = await request(`https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunk.sid)}/PhoneNumbers?PageSize=100`, { accountSid, authToken });
    if ((numbers?.phone_numbers || []).some(n => n.phone_number === existingDemoNumber)) {
      trunkSid = trunk.sid;
      break;
    }
  }
  if (!trunkSid) throw new Error("demo_sip_trunk_not_found");

  const availableData = await request(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/AvailablePhoneNumbers/US/Local.json?AreaCode=${encodeURIComponent(areaCode)}&VoiceEnabled=true&PageSize=20`,
    { accountSid, authToken }
  );
  const available = (availableData?.available_phone_numbers || []).filter(n => n.capabilities?.voice !== false);
  log(JSON.stringify({ event: "demo.number.discovery", mode, area_code: areaCode, trunk_found: true, available_count: available.length }));

  if (mode === "discover") return { ok: true, trunkSid, available: available.map(n => n.phone_number) };
  if (mode !== "provision") throw new Error("invalid_demo_number_provision_mode");

  const incoming = await request(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=1000`,
    { accountSid, authToken }
  );
  const existing = incoming?.incoming_phone_numbers || [];
  const used = new Set();
  const results = [];

  for (const [role, friendlyName] of ROLES) {
    let number = existing.find(n => n.friendly_name === friendlyName);
    if (!number) {
      const candidate = available.find(n => !used.has(n.phone_number));
      if (!candidate) throw new Error("insufficient_409_demo_numbers");
      used.add(candidate.phone_number);
      number = await request(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json`,
        { accountSid, authToken, method: "POST", body: { PhoneNumber: candidate.phone_number, FriendlyName: friendlyName } }
      );
    }

    const associated = await request(
      `https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunkSid)}/PhoneNumbers?PageSize=100`,
      { accountSid, authToken }
    );
    const already = (associated?.phone_numbers || []).some(n => n.sid === number.sid || n.phone_number === number.phone_number);
    if (!already) {
      await request(
        `https://trunking.twilio.com/v1/Trunks/${encodeURIComponent(trunkSid)}/PhoneNumbers`,
        { accountSid, authToken, method: "POST", body: { PhoneNumberSid: number.sid } }
      );
    }
    const row = { role, phone_number: number.phone_number, friendly_name: friendlyName, trunk_associated: true };
    results.push(row);
    log(JSON.stringify({ event: "demo.number.provisioned", ...row }));
  }
  return { ok: true, results };
}
