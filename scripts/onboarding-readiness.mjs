import { TenantRegistry } from "../src/recovery/tenant-registry.js";
import { tenantReadiness } from "../src/onboarding/readiness.js";

const dir = process.env.TENANT_CONFIG_DIR || "./config/tenants";
const registry = await TenantRegistry.loadDirectory(dir);
let blocked = 0;

for (const tenant of registry.list()) {
  const report = tenantReadiness(tenant);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) blocked += 1;
}

if (blocked) {
  console.error(`${blocked} tenant(s) blocked from pilot activation.`);
  process.exit(1);
}
console.log(`All ${registry.list().length} tenant(s) pass onboarding readiness gates.`);
