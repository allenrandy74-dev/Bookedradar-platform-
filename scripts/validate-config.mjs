import { TenantRegistry } from "../src/recovery/tenant-registry.js";
import { buildTenantAdapters, bookingAdapterForTenant } from "../src/integrations/tenant-adapters.js";

const dir = process.env.TENANT_CONFIG_DIR || "./config/tenants";
const registry = await TenantRegistry.loadDirectory(dir);
let failures = 0;
for (const tenant of registry.list()) {
  const adapters = buildTenantAdapters(tenant);
  const booking = bookingAdapterForTenant(tenant);
  const phone = tenant.integrations?.phone || {};
  if (phone.enabled && !(phone.inboundNumbers || []).length) {
    console.error(`${tenant.tenantId}: phone enabled but no inboundNumbers configured`);
    failures += 1;
  }
  if (tenant.policies?.bookingMode === "live_booking" && booking.constructor.name === "ConfirmOnlyBookingAdapter") {
    console.error(`${tenant.tenantId}: live_booking requested but no live booking adapter is configured`);
    failures += 1;
  }
  console.log(`${tenant.tenantId}: dispatch=[${Object.keys(adapters).join(",") || "none"}] booking=${booking.constructor.name}`);
}
if (failures) process.exit(1);
console.log(`Validated ${registry.list().length} tenant configuration(s).`);
