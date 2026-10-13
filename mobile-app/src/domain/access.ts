import { invariant } from "./errors";
import type { AccessContext, DemoMember } from "./model";

/** Safe default for an unconfigured client. Callers opt into demo explicitly. */
export const deniedAccess: AccessContext = Object.freeze({
  mode: "live",
  role: "unknown",
  online: false,
  sessionState: "unknown",
  memberId: null,
});

export const demoAccess: AccessContext = Object.freeze({
  mode: "demo",
  role: "operator",
  online: true,
  sessionState: "active",
  memberId: "alex",
});

/** Offline read-only demo snapshots are permitted; no mutation is queued. */
export function assertReadAccess(
  access: AccessContext,
  members: readonly DemoMember[],
): DemoMember {
  invariant(access?.mode === "demo", "native_auth_not_configured");
  invariant(access.sessionState !== "expired", "session_expired");
  invariant(access.sessionState === "active", "authentication_required");
  invariant(
    access.role === "viewer" || access.role === "operator",
    "membership_required",
  );
  const actor = members.find((member) => member.id === access.memberId);
  invariant(actor?.active === true, "membership_required");
  invariant(
    actor.role === "operator" || actor.role === "viewer",
    "membership_required",
  );
  return actor;
}

export function assertWriteAccess(
  access: AccessContext,
  members: readonly DemoMember[],
): DemoMember {
  const actor = assertReadAccess(access, members);
  invariant(access.online === true, "offline");
  invariant(
    access.role === "operator" && actor.role === "operator",
    "read_only_membership",
  );
  return actor;
}
