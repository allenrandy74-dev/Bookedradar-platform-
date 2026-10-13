import { assertWriteAccess } from "./access";
import { invariant } from "./errors";
import {
  DEMO_NOW,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  STATUSES,
  type AccessContext,
  type DemoMember,
  type Inquiry,
  type NoteInput,
  type Status,
  type WorkflowPatch,
} from "./model";
import {
  assertMutationBody,
  cleanText,
  projectInquiry,
  validDate,
  validId,
} from "./validation";

const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = Object.freeze({
  new: Object.freeze(["in_progress", "closed"] as Status[]),
  in_progress: Object.freeze(["waiting", "closed"] as Status[]),
  waiting: Object.freeze(["in_progress", "closed"] as Status[]),
  closed: Object.freeze(["in_progress"] as Status[]),
});

export function allowedTransitions(status: Status): readonly Status[] {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, status)
    ? TRANSITIONS[status]
    : [];
}

function assertVersion(inquiry: Inquiry, version: number, now: string) {
  invariant(inquiry.version === version, "version_conflict");
  invariant(inquiry.version < Number.MAX_SAFE_INTEGER, "version_exhausted");
  invariant(validDate(now), "data_unavailable");
}

function assertLinks(inquiry: Inquiry, members: readonly DemoMember[]) {
  invariant(
    inquiry.assigneeId === null ||
      members.some((member) => member.id === inquiry.assigneeId),
    "data_unavailable",
  );
  invariant(
    inquiry.notes.every((note) =>
      members.some((member) => member.id === note.authorId),
    ),
    "data_unavailable",
  );
}

export function updateWorkflow(
  inquiry: Inquiry,
  patch: WorkflowPatch,
  access: AccessContext,
  members: readonly DemoMember[],
  now = DEMO_NOW,
): Inquiry {
  assertWriteAccess(access, members);
  assertMutationBody(patch, ["version", "status", "assigneeId"]);
  const hasStatus = Object.prototype.hasOwnProperty.call(patch, "status");
  const hasAssignee = Object.prototype.hasOwnProperty.call(patch, "assigneeId");
  invariant(hasStatus || hasAssignee, "empty_patch");
  invariant(
    !hasStatus || STATUSES.includes(patch.status as Status),
    "invalid_status",
  );
  invariant(
    !hasAssignee || patch.assigneeId === null || validId(patch.assigneeId),
    "invalid_assignee",
  );
  const current = projectInquiry(inquiry);
  assertLinks(current, members);
  assertVersion(current, patch.version, now);
  if (hasStatus && patch.status !== current.status) {
    invariant(
      allowedTransitions(current.status).includes(patch.status as Status),
      "invalid_status_transition",
    );
  }
  if (hasAssignee && patch.assigneeId !== null) {
    invariant(
      members.some(
        (member) =>
          member.id === patch.assigneeId &&
          member.active === true &&
          member.role === "operator",
      ),
      "invalid_assignee",
    );
  }
  const status = hasStatus ? (patch.status as Status) : current.status;
  const assigneeId = hasAssignee
    ? (patch.assigneeId as string | null)
    : current.assigneeId;
  invariant(
    status !== current.status || assigneeId !== current.assigneeId,
    "no_change",
  );
  return {
    ...current,
    status,
    assigneeId,
    version: current.version + 1,
    updatedAt: now,
  };
}

/** Append-only. No edit, delete, reply, send, booking or payment operation exists. */
export function appendNote(
  inquiry: Inquiry,
  input: NoteInput,
  access: AccessContext,
  members: readonly DemoMember[],
  now = DEMO_NOW,
  noteId = `demo-note-${inquiry.id}-${inquiry.version + 1}`,
): Inquiry {
  const actor = assertWriteAccess(access, members);
  assertMutationBody(input, ["version", "text"]);
  // Match the server: validate the original length, then trim before storage.
  invariant(
    cleanText(input.text, MAX_NOTE_LENGTH) && input.text.trim().length > 0,
    "invalid_note",
  );
  const current = projectInquiry(inquiry);
  assertLinks(current, members);
  assertVersion(current, input.version, now);
  invariant(current.notes.length < MAX_NOTES, "note_limit_reached");
  invariant(
    validId(noteId) && !current.notes.some((note) => note.id === noteId),
    "data_unavailable",
  );
  return {
    ...current,
    version: current.version + 1,
    updatedAt: now,
    notes: [
      ...current.notes,
      {
        id: noteId,
        text: input.text.trim(),
        authorId: actor.id,
        createdAt: now,
      },
    ],
  };
}
