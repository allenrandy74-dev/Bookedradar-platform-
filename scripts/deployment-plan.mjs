import { TenantRegistry } from "../src/recovery/tenant-registry.js";
import { deploymentPlan } from "../src/onboarding/deployment-plan.js";

const dir = process.env.TENANT_CONFIG_DIR || "./config/tenants";
const tenantId = process.argv[2] || "";
const foundingPartner = process.argv.includes("--standard") ? false : true;
const registry = await TenantRegistry.loadDirectory(dir);

const tenants = tenantId
  ? [registry.get(tenantId)].filter(Boolean)
  : registry.list();

if (!tenants.length) {
  console.error("No matching tenant found.");
  process.exit(2);
}

let blocked = 0;
for (const tenant of tenants) {
  const plan = deploymentPlan(tenant, { foundingPartner });
  console.log(JSON.stringify(plan, null, 2));
  if (plan.deploymentDecision === "BLOCKED") blocked += 1;
}

if (blocked) process.exit(1);
