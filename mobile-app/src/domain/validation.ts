import { invariant } from "./errors";
import {
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  STATUSES,
  type Inquiry,
  type Note,
} from "./model";

export const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

export const cleanText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

export const validDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function assertMutationBody(
  value: unknown,
  allowedKeys: readonly string[],
): asserts value is Record<string, unknown> {
  invariant(object(value), "invalid_body");
  const keys = Object.keys(value);
  invariant(
    !keys.some((key) =>
      key
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .includes("tenant"),
    ),
    "tenant_selector_forbidden",
  );
  invariant(
    keys.every((key) => allowedKeys.includes(key)),
    "unknown_field",
  );
  invariant(
    Number.isSafeInteger(value.version) && Number(value.version) > 0,
    "version_required",
  );
}

/** Validate and project field by field; unknown source metadata cannot leak. */
export function projectInquiry(value: unknown): Inquiry {
  invariant(object(value), "data_unavailable");
  invariant(validId(value.id), "data_unavailable");
  invariant(cleanText(value.customerName, 200), "data_unavailable");
  invariant(object(value.contact), "data_unavailable");
  invariant(
    cleanText(value.contact.email, 320) && cleanText(value.contact.phone, 80),
    "data_unavailable",
  );
  invariant(
    cleanText(value.subject, 300) &&
      cleanText(value.summary, 4000) &&
      cleanText(value.source, 80),
    "data_unavailable",
  );
  invariant(
    validDate(value.receivedAt) && validDate(value.updatedAt),
    "data_unavailable",
  );
  invariant(
    STATUSES.includes(value.status as Inquiry["status"]),
    "data_unavailable",
  );
  invariant(
    value.assigneeId === null || validId(value.assigneeId),
    "data_unavailable",
  );
  invariant(
    Number.isSafeInteger(value.version) && Number(value.version) > 0,
    "data_unavailable",
  );
  invariant(
    Array.isArray(value.notes) && value.notes.length <= MAX_NOTES,
    "data_unavailable",
  );
  const notes: Note[] = value.notes.map((note: unknown) => {
    invariant(
      object(note) && validId(note.id) && validId(note.authorId),
      "data_unavailable",
    );
    invariant(
      cleanText(note.text, MAX_NOTE_LENGTH) && validDate(note.createdAt),
      "data_unavailable",
    );
    return {
      id: note.id,
      text: note.text,
      authorId: note.authorId,
      createdAt: note.createdAt,
    };
  });
  return {
    id: value.id,
    customerName: value.customerName,
    contact: { email: value.contact.email, phone: value.contact.phone },
    subject: value.subject,
    summary: value.summary,
    source: value.source,
    receivedAt: value.receivedAt,
    updatedAt: value.updatedAt,
    status: value.status as Inquiry["status"],
    assigneeId: value.assigneeId,
    version: value.version as number,
    notes,
  };
}
