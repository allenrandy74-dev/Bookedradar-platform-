import fs from "node:fs/promises";
import path from "node:path";
import { validateTenant } from "./tenant.js";

function normPhone(value = "") {
  const raw = String(value).trim();
  if (!raw) return "";
  if (raw.startsWith("+")) return "+" + raw.slice(1).replace(/\D/g, "");
  const digits = raw.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

export class TenantRegistry {
  constructor(tenants = []) {
    this.byId = new Map();
    this.byPhone = new Map();

    for (const tenant of tenants) {
      const validation = validateTenant(tenant);
      if (!validation.valid) {
        throw new Error(
          `Invalid tenant ${tenant?.tenantId || "(unknown)"}: ${validation.errors.join("; ")}`
        );
      }

      if (this.byId.has(tenant.tenantId)) {
        throw new Error(`Duplicate tenantId: ${tenant.tenantId}`);
      }

      this.byId.set(tenant.tenantId, tenant);

      const numbers = tenant?.integrations?.phone?.inboundNumbers || [];
      for (const value of numbers) {
        const phone = normPhone(value);
        if (!phone) continue;
        if (this.byPhone.has(phone)) {
          throw new Error(`Inbound phone number is assigned to multiple tenants: ${phone}`);
        }
        this.byPhone.set(phone, tenant);
      }
    }
  }

  static async loadDirectory(directory) {
    const dir = path.resolve(directory);
    const names = (await fs.readdir(dir))
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort();

    const tenants = [];
    for (const name of names) {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"));
      tenants.push(parsed);
    }

    if (!tenants.length) {
      throw new Error(`No tenant JSON files found in ${dir}`);
    }
    return new TenantRegistry(tenants);
  }

  get(tenantId) {
    return this.byId.get(tenantId) || null;
  }

  resolveByPhone(phone) {
    return this.byPhone.get(normPhone(phone)) || null;
  }

  resolve({ tenantId = "", phone = "" } = {}) {
    if (tenantId) return this.get(tenantId);
    if (phone) {
      const byPhone = this.resolveByPhone(phone);
      if (byPhone) return byPhone;
    }
    return this.byId.size === 1 ? [...this.byId.values()][0] : null;
  }

  list() {
    return [...this.byId.values()];
  }
}

export function tenantSecret(tenant, suffix, env = process.env) {
  const prefix = tenant?.secretsPrefix;
  if (!prefix) return "";
  return env[`${prefix}_${suffix}`] || "";
}

export { normPhone };

// No global fallback: a missing customer target must never route to another business.
export function humanTransferTarget(tenant, env = process.env) {
  const target = String(tenantSecret(tenant, "HUMAN_TRANSFER_NUMBER", env) || tenant?.escalation?.humanPhone || "").trim();
  return /^\+[1-9]\d{7,14}$/.test(target) ? target : "";
}
