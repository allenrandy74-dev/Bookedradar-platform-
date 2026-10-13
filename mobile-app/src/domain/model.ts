/** Exact minimal inquiry DTO from customer-portal/SERVER_CONTRACT.md. */
export const STATUSES = ["new", "in_progress", "waiting", "closed"] as const;
export type Status = (typeof STATUSES)[number];
export type Role = "viewer" | "operator";

export interface Note {
  readonly id: string;
  readonly text: string;
  readonly authorId: string;
  readonly createdAt: string;
}

export interface Inquiry {
  readonly id: string;
  readonly customerName: string;
  readonly contact: { readonly email: string; readonly phone: string };
  readonly subject: string;
  readonly summary: string;
  readonly source: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
  readonly status: Status;
  readonly assigneeId: string | null;
  readonly version: number;
  readonly notes: readonly Note[];
}

/** The production /members response contains only id and name. */
export interface Member {
  readonly id: string;
  readonly name: string;
}

/** Local fixture metadata only. Never use client roles as server authorization. */
export interface DemoMember extends Member {
  readonly initials: string;
  readonly role: Role;
  readonly active: boolean;
}

/** Proposed display metadata for this demo, NOT fields in the server DTO. */
export interface DemoContext {
  readonly demoOnly: true;
  readonly priority: "high" | "normal";
  readonly service: string;
  readonly preferredTime: string;
  readonly location: string;
  /** Synthetic opportunity estimate. Not a quote, booking, payment or revenue. */
  readonly estimatedValue: number | null;
  readonly currency: "USD";
}

export interface DemoRecord {
  readonly inquiry: Inquiry;
  readonly context: DemoContext;
}

/** Simulation flags only. They never establish a native/live login. */
export interface AccessContext {
  readonly mode: "demo" | "live";
  readonly role: Role | "unknown";
  readonly online: boolean;
  readonly sessionState: "active" | "expired" | "signed_out" | "unknown";
  readonly memberId: string | null;
}

export interface WorkflowPatch {
  readonly version: number;
  readonly status?: Status;
  readonly assigneeId?: string | null;
}

export interface NoteInput {
  readonly version: number;
  readonly text: string;
}

export const MAX_NOTE_LENGTH = 2_000;
export const MAX_NOTES = 1_000;
export const MAX_INQUIRIES = 100;
/** Fixed clock for deterministic sample ages and local-only mutations. */
export const DEMO_NOW = "2026-10-12T15:30:00.000Z";
