export type ErrorCode =
  | "native_auth_not_configured"
  | "authentication_required"
  | "session_expired"
  | "membership_required"
  | "read_only_membership"
  | "offline"
  | "invalid_body"
  | "tenant_selector_forbidden"
  | "unknown_field"
  | "version_required"
  | "version_conflict"
  | "version_exhausted"
  | "empty_patch"
  | "invalid_status"
  | "invalid_status_transition"
  | "invalid_assignee"
  | "no_change"
  | "invalid_note"
  | "note_limit_reached"
  | "data_unavailable"
  | "not_found"
  | "invalid_limit";

export class DomainError extends Error {
  readonly errorCode: ErrorCode;
  constructor(errorCode: ErrorCode) {
    super(errorCode);
    this.name = "DomainError";
    this.errorCode = errorCode;
  }
}

export function invariant(
  condition: unknown,
  errorCode: ErrorCode,
): asserts condition {
  if (!condition) throw new DomainError(errorCode);
}
