function truthy(value) {
  return String(value ?? "").trim().toLowerCase() === "true";
}

export function dispatchGate(tenant = {}, env = process.env) {
  const globalEnabled = truthy(env?.DISPATCH_ENABLED ?? "false");
  const tenantMode = String(tenant?.commercial?.dispatchMode || "shadow").trim().toLowerCase();
  const tenantLive = tenantMode === "live";
  return {
    armed: globalEnabled && tenantLive,
    globalEnabled,
    tenantMode,
    reason: !globalEnabled
      ? "global_dispatch_disabled"
      : !tenantLive
        ? "tenant_dispatch_not_live"
        : null,
  };
}
