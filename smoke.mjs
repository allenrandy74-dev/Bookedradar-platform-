const base = process.env.BOOKEDRADAR_SMOKE_BASE_URL || process.env.PUBLIC_BASE_URL;
const tenant = process.env.BOOKEDRADAR_SMOKE_TENANT || "demo-hvac";
const ingest = process.env.BOOKEDRADAR_INGEST_TOKEN;
const admin = process.env.BOOKEDRADAR_ADMIN_TOKEN;
if (!base || !ingest || !admin) {
  console.error("Set BOOKEDRADAR_SMOKE_BASE_URL/PUBLIC_BASE_URL, BOOKEDRADAR_INGEST_TOKEN, and BOOKEDRADAR_ADMIN_TOKEN.");
  process.exit(2);
}
async function call(path, { method = "GET", token = admin, body } = {}) {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-bookedradar-tenant": tenant,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${method} ${path} failed ${response.status}: ${text}`);
  return data;
}
console.log(await call("/health"));
const externalId = `smoke-${Date.now()}`;
const intake = await call("/api/v1/intake/web-lead", {
  method: "POST",
  token: ingest,
  body: {
    externalId,
    name: "BookedRadar Smoke Test",
    email: "smoke@example.com",
    serviceType: "repair",
    source: "deployment_smoke_test",
  },
});
console.log("intake ok", intake.result?.opportunity?.id);
const proof = await call(`/api/v1/radarproof?tenant=${encodeURIComponent(tenant)}`, { token: admin });
console.log("RadarProof opportunities:", proof.report?.opportunitiesCaptured);
console.log("Smoke PASS");
