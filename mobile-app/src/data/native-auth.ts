import { deniedAccess, DomainError, type AccessContext } from "../domain";

/**
 * Deliberately disabled native-auth boundary.
 * The reviewed portal contract describes browser HttpOnly cookie sessions only.
 * Native authentication needs a separately approved provider and server contract.
 * No URL, shared bearer token, credential storage, cookie emulation or network
 * transport exists here. Demo membership can never activate this adapter.
 */
export interface DisabledNativeAuthAdapter {
  readonly enabled: false;
  readonly reason: "native_auth_not_configured";
  readSession(): Promise<AccessContext>;
  signIn(): Promise<never>;
}

export const nativeAuthAdapter: DisabledNativeAuthAdapter = Object.freeze({
  enabled: false as const,
  reason: "native_auth_not_configured" as const,
  async readSession(): Promise<AccessContext> {
    return deniedAccess;
  },
  async signIn(): Promise<never> {
    throw new DomainError("native_auth_not_configured");
  },
});
