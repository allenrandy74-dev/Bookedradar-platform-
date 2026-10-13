/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedTransitions,
  appendNote,
  assertReadAccess,
  assertWriteAccess,
  deniedAccess,
  deriveSummary,
  DomainError,
  filterInquiries,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  projectInquiry,
  STATUSES,
  updateWorkflow,
  type AccessContext,
  type DemoMember,
  type DemoRecord,
  type Inquiry,
  type NoteInput,
  type Status,
  type WorkflowPatch,
} from "../src/domain";
import {
  createDemoRecords,
  demoAccess,
  DEMO_NOW,
  members,
  nativeAuthAdapter,
} from "../src/data";

const inquiry = () => createDemoRecords()[0].inquiry;
const expectError = (code: string) => (error: unknown) =>
  error instanceof DomainError && error.errorCode === code;
const patch = (value: unknown) => value as WorkflowPatch;
const noteInput = (value: unknown) => value as NoteInput;
const update = (
  body: unknown,
  source = inquiry(),
  access: AccessContext = demoAccess,
  roster = members,
) => updateWorkflow(source, patch(body), access, roster);
const addNote = (
  body: unknown,
  source = inquiry(),
  access: AccessContext = demoAccess,
  roster = members,
) => appendNote(source, noteInput(body), access, roster);
const dtoKeys = [
  "id",
  "customerName",
  "contact",
  "subject",
  "summary",
  "source",
  "receivedAt",
  "updatedAt",
  "status",
  "assigneeId",
  "version",
  "notes",
].sort();

test("six fictional samples expose exact inquiry fields and isolated demo-only context", () => {
  const records = createDemoRecords();
  assert.equal(records.length, 6);
  assert.equal(new Set(records.map((record) => record.inquiry.id)).size, 6);
  for (const { inquiry: item, context } of records) {
    assert.deepEqual(Object.keys(item).sort(), dtoKeys);
    assert.deepEqual(Object.keys(item.contact).sort(), ["email", "phone"]);
    assert.match(item.contact.email, /@example\.com$/);
    assert.match(item.contact.phone, /^\+1 \(202\) 555-01\d{2}$/);
    assert.equal(context.demoOnly, true);
    assert.equal(context.currency, "USD");
    assert.equal("tenantId" in item, false);
    assert.equal("confirmedRevenue" in item, false);
    assert.equal("booking" in item, false);
    assert.equal("estimatedValue" in item, false);
    assert.deepEqual(projectInquiry(item), item);
  }
});

test("sample resets produce independent nested state", () => {
  const first = createDemoRecords();
  const second = createDemoRecords();
  assert.deepEqual(first, second);
  for (let i = 0; i < first.length; i += 1) {
    assert.notEqual(first[i], second[i]);
    assert.notEqual(first[i].inquiry, second[i].inquiry);
    assert.notEqual(first[i].inquiry.contact, second[i].inquiry.contact);
    assert.notEqual(first[i].inquiry.notes, second[i].inquiry.notes);
    assert.notEqual(first[i].context, second[i].context);
  }
  assert.notEqual(first[2].inquiry.notes[0], second[2].inquiry.notes[0]);
});

test("workflow mutation increments version once and leaves prior source unchanged", () => {
  const before = inquiry();
  const original = structuredClone(before);
  const next = update(
    { version: before.version, status: "in_progress", assigneeId: "alex" },
    before,
  );
  assert.equal(next.version, before.version + 1);
  assert.equal(next.status, "in_progress");
  assert.equal(next.assigneeId, "alex");
  assert.equal(next.updatedAt, DEMO_NOW);
  assert.deepEqual(before, original);
  assert.deepEqual(next.notes, before.notes);
  assert.deepEqual(next.contact, before.contact);
});

test("workflow and note writes require positive safe versions", () => {
  for (const version of [
    undefined,
    null,
    0,
    -1,
    1.5,
    "1",
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => update({ version, status: "in_progress" }),
      expectError("version_required"),
    );
    assert.throws(
      () => addNote({ version, text: "Internal note" }),
      expectError("version_required"),
    );
  }
});

test("stale versions reject workflow and notes without replay", () => {
  const original = inquiry();
  const newer = update({ version: 1, status: "in_progress" }, original);
  assert.throws(
    () => update({ version: 1, status: "closed" }, newer),
    expectError("version_conflict"),
  );
  assert.throws(
    () => addNote({ version: 1, text: "Stale note" }, newer),
    expectError("version_conflict"),
  );
  assert.equal(newer.version, 2);
  assert.equal(newer.notes.length, 0);
});

test("exhausted versions and invalid mutation clocks fail closed", () => {
  const maxed = { ...inquiry(), version: Number.MAX_SAFE_INTEGER };
  assert.throws(
    () => update({ version: maxed.version, status: "in_progress" }, maxed),
    expectError("version_exhausted"),
  );
  assert.throws(
    () => addNote({ version: maxed.version, text: "Note" }, maxed),
    expectError("version_exhausted"),
  );
  assert.throws(
    () =>
      updateWorkflow(
        inquiry(),
        { version: 1, status: "in_progress" },
        demoAccess,
        members,
        "not-a-date",
      ),
    expectError("data_unavailable"),
  );
});

test("every status transition matches the reviewed contract", () => {
  const expected: Record<Status, readonly Status[]> = {
    new: ["in_progress", "closed"],
    in_progress: ["waiting", "closed"],
    waiting: ["in_progress", "closed"],
    closed: ["in_progress"],
  };
  for (const current of STATUSES) {
    assert.deepEqual(allowedTransitions(current), expected[current]);
    for (const target of STATUSES) {
      const item = { ...inquiry(), status: current };
      if (current === target) {
        assert.throws(
          () => update({ version: 1, status: target }, item),
          expectError("no_change"),
        );
      } else if (expected[current].includes(target)) {
        assert.equal(
          update({ version: 1, status: target }, item).status,
          target,
        );
      } else {
        assert.throws(
          () => update({ version: 1, status: target }, item),
          expectError("invalid_status_transition"),
        );
      }
    }
  }
  assert.deepEqual(allowedTransitions("__proto__" as Status), []);
  assert.deepEqual(allowedTransitions("booked" as Status), []);
});

test("empty, invalid and no-op patches are rejected", () => {
  assert.throws(() => update({ version: 1 }), expectError("empty_patch"));
  for (const status of [null, undefined, "booked", "won", "paid", "", 1]) {
    assert.throws(
      () => update({ version: 1, status }),
      expectError("invalid_status"),
    );
  }
  assert.throws(
    () => update({ version: 1, assigneeId: null }),
    expectError("no_change"),
  );
  assert.throws(
    () => update({ version: 1, status: "new", assigneeId: null }),
    expectError("no_change"),
  );
});

test("assignment requires a known active operator; unassignment is explicit null", () => {
  const roster: DemoMember[] = [
    ...members,
    {
      id: "viewer",
      name: "Sample Viewer",
      initials: "SV",
      role: "viewer",
      active: true,
    },
    {
      id: "inactive",
      name: "Former Operator",
      initials: "FO",
      role: "operator",
      active: false,
    },
  ];
  for (const assigneeId of [
    "missing",
    "viewer",
    "inactive",
    "",
    "tenant/user",
    undefined,
    1,
  ]) {
    assert.throws(
      () => update({ version: 1, assigneeId }, inquiry(), demoAccess, roster),
      expectError("invalid_assignee"),
    );
  }
  const assigned = update({ version: 1, assigneeId: "morgan" });
  assert.equal(assigned.assigneeId, "morgan");
  assert.equal(
    update({ version: 2, assigneeId: null }, assigned).assigneeId,
    null,
  );
});

test("unknown fields and all client tenant selector spellings are forbidden", () => {
  for (const field of [
    "customerName",
    "contact",
    "notes",
    "confirmedRevenue",
    "booking",
    "role",
    "userId",
    "unexpected",
  ]) {
    assert.throws(
      () => update({ version: 1, status: "in_progress", [field]: "value" }),
      expectError("unknown_field"),
    );
    assert.throws(
      () => addNote({ version: 1, text: "Note", [field]: "value" }),
      expectError("unknown_field"),
    );
  }
  for (const field of [
    "tenant",
    "tenantId",
    "TENANT_ID",
    "x-tenant-id",
    "t.e.n.a.n.t",
    "selectedTenant",
  ]) {
    assert.throws(
      () => update({ version: 1, status: "in_progress", [field]: "other" }),
      expectError("tenant_selector_forbidden"),
    );
    assert.throws(
      () => addNote({ version: 1, text: "Note", [field]: "other" }),
      expectError("tenant_selector_forbidden"),
    );
  }
  for (const body of [null, [], "body", true, 1]) {
    assert.throws(() => update(body), expectError("invalid_body"));
    assert.throws(() => addNote(body), expectError("invalid_body"));
  }
});

test("notes are trimmed, attributed, append-only and versioned exactly once", () => {
  const before = createDemoRecords()[2].inquiry;
  const oldNotes = structuredClone(before.notes);
  const after = addNote(
    { version: before.version, text: "  Call back tomorrow.\n  " },
    before,
  );
  assert.equal(after.version, before.version + 1);
  assert.equal(after.notes.length, before.notes.length + 1);
  assert.deepEqual(after.notes.slice(0, -1), oldNotes);
  assert.deepEqual(before.notes, oldNotes);
  assert.equal(after.notes.at(-1)?.text, "Call back tomorrow.");
  assert.equal(after.notes.at(-1)?.authorId, "alex");
  assert.equal(after.notes.at(-1)?.createdAt, DEMO_NOW);
});

test("note text bounds include original pre-trim length and reject controls", () => {
  assert.equal(
    addNote({ version: 1, text: "x".repeat(MAX_NOTE_LENGTH) }).notes[0].text
      .length,
    MAX_NOTE_LENGTH,
  );
  for (const text of [
    "",
    " \n\t ",
    null,
    15,
    "x".repeat(MAX_NOTE_LENGTH + 1),
    ` ${"x".repeat(MAX_NOTE_LENGTH)} `,
    "bad\u0000text",
    "bad\u007ftext",
  ]) {
    assert.throws(
      () => addNote({ version: 1, text }),
      expectError("invalid_note"),
    );
  }
  assert.equal(
    addNote({ version: 1, text: "Line one\nLine two\tDetails" }).notes[0].text,
    "Line one\nLine two\tDetails",
  );
  assert.equal(
    addNote({ version: 1, text: "<script>never executed</script>" }).notes[0]
      .text,
    "<script>never executed</script>",
  );
});

test("note count is bounded and duplicate or invalid generated IDs fail closed", () => {
  const notes = Array.from({ length: MAX_NOTES }, (_, index) => ({
    id: `note-${index}`,
    text: "Note",
    authorId: "alex",
    createdAt: DEMO_NOW,
  }));
  assert.throws(
    () =>
      addNote({ version: 1, text: "One too many" }, { ...inquiry(), notes }),
    expectError("note_limit_reached"),
  );
  const below = { ...inquiry(), notes: notes.slice(0, MAX_NOTES - 1) };
  assert.equal(
    addNote({ version: 1, text: "Last allowed" }, below).notes.length,
    MAX_NOTES,
  );
  for (const id of ["", "note/invalid", "note-1"]) {
    assert.throws(
      () =>
        appendNote(
          below,
          { version: 1, text: "New note" },
          demoAccess,
          members,
          DEMO_NOW,
          id,
        ),
      expectError("data_unavailable"),
    );
  }
});

test("default access denies all live and unknown native identity states", () => {
  assert.equal(Object.isFrozen(deniedAccess), true);
  for (const access of [
    deniedAccess,
    { ...demoAccess, mode: "live" as const },
  ]) {
    assert.throws(
      () => assertReadAccess(access, members),
      expectError("native_auth_not_configured"),
    );
    assert.throws(
      () => update({ version: 1, status: "in_progress" }, inquiry(), access),
      expectError("native_auth_not_configured"),
    );
  }
  for (const sessionState of ["unknown", "signed_out"] as const) {
    assert.throws(
      () => assertReadAccess({ ...demoAccess, sessionState }, members),
      expectError("authentication_required"),
    );
  }
});

test("viewer can read but cannot mutate even with forged client role", () => {
  const roster: DemoMember[] = members.map((member) =>
    member.id === "alex" ? { ...member, role: "viewer" } : member,
  );
  const viewer: AccessContext = { ...demoAccess, role: "viewer" };
  assert.equal(assertReadAccess(viewer, roster).id, "alex");
  for (const access of [viewer, demoAccess]) {
    assert.throws(
      () =>
        update(
          { version: 1, status: "in_progress" },
          inquiry(),
          access,
          roster,
        ),
      expectError("read_only_membership"),
    );
    assert.throws(
      () =>
        addNote({ version: 1, text: "No write" }, inquiry(), access, roster),
      expectError("read_only_membership"),
    );
  }
  assert.throws(
    () => assertWriteAccess(viewer, members),
    expectError("read_only_membership"),
  );
});

test("unknown, missing and inactive memberships cannot read or write", () => {
  const inactive = members.map((member) =>
    member.id === "alex" ? { ...member, active: false } : member,
  );
  assert.throws(
    () => assertReadAccess(demoAccess, inactive),
    expectError("membership_required"),
  );
  assert.throws(
    () => assertReadAccess({ ...demoAccess, memberId: "missing" }, members),
    expectError("membership_required"),
  );
  assert.throws(
    () => assertReadAccess({ ...demoAccess, memberId: null }, members),
    expectError("membership_required"),
  );
  assert.throws(
    () => assertReadAccess({ ...demoAccess, role: "unknown" }, members),
    expectError("membership_required"),
  );
});

test("offline demo remains readable but never permits or queues a write", () => {
  const offline: AccessContext = { ...demoAccess, online: false };
  assert.equal(assertReadAccess(offline, members).id, "alex");
  assert.throws(
    () => update({ version: 1, status: "in_progress" }, inquiry(), offline),
    expectError("offline"),
  );
  assert.throws(
    () => addNote({ version: 1, text: "Do not queue" }, inquiry(), offline),
    expectError("offline"),
  );
});

test("expired sessions block reads and both mutation types", () => {
  const expired: AccessContext = { ...demoAccess, sessionState: "expired" };
  assert.throws(
    () => assertReadAccess(expired, members),
    expectError("session_expired"),
  );
  assert.throws(
    () => update({ version: 1, status: "in_progress" }, inquiry(), expired),
    expectError("session_expired"),
  );
  assert.throws(
    () => addNote({ version: 1, text: "Expired" }, inquiry(), expired),
    expectError("session_expired"),
  );
});

test("native auth adapter stays disabled and performs no network request", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected network request");
  };
  try {
    assert.equal(nativeAuthAdapter.enabled, false);
    assert.equal(nativeAuthAdapter.reason, "native_auth_not_configured");
    assert.equal(Object.isFrozen(nativeAuthAdapter), true);
    assert.deepEqual(await nativeAuthAdapter.readSession(), deniedAccess);
    await assert.rejects(
      nativeAuthAdapter.signIn(),
      expectError("native_auth_not_configured"),
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("projection drops unknown fields recursively without aliasing source data", () => {
  const base = createDemoRecords()[2].inquiry;
  const polluted = {
    ...base,
    tenantId: "other",
    rawProviderMetadata: { secret: "not-for-dto" },
    confirmedRevenue: { amount: 999 },
    contact: { ...base.contact, raw: "not-for-dto", credential: "not-for-dto" },
    notes: base.notes.map((note) => ({
      ...note,
      tenantId: "other",
      providerPayload: "not-for-dto",
    })),
  };
  const projected = projectInquiry(polluted);
  assert.deepEqual(projected, base);
  assert.deepEqual(Object.keys(projected).sort(), dtoKeys);
  assert.deepEqual(Object.keys(projected.notes[0]).sort(), [
    "authorId",
    "createdAt",
    "id",
    "text",
  ]);
  assert.notEqual(projected.contact, polluted.contact);
  assert.notEqual(projected.notes[0], polluted.notes[0]);
  assert.equal(JSON.stringify(projected).includes("not-for-dto"), false);
});

test("malformed DTOs fail closed rather than leaking partial records", () => {
  for (const value of [
    null,
    [],
    {},
    { ...inquiry(), status: "booked" },
    { ...inquiry(), version: 0 },
    { ...inquiry(), contact: null },
    { ...inquiry(), id: "../other" },
    { ...inquiry(), receivedAt: "bad-date" },
    { ...inquiry(), customerName: "bad\u0000text" },
    {
      ...inquiry(),
      notes: [
        {
          id: "n",
          authorId: "alex",
          text: "x".repeat(2001),
          createdAt: DEMO_NOW,
        },
      ],
    },
    {
      ...inquiry(),
      notes: new Array(MAX_NOTES + 1).fill({
        id: "n",
        authorId: "alex",
        text: "Note",
        createdAt: DEMO_NOW,
      }),
    },
  ]) {
    assert.throws(() => projectInquiry(value), expectError("data_unavailable"));
  }
});

test("mutations reject missing historical assignee and note author references", () => {
  const missingAssignee: Inquiry = {
    ...inquiry(),
    assigneeId: "unknown-member",
  };
  const missingAuthor: Inquiry = {
    ...inquiry(),
    notes: [
      {
        id: "n",
        text: "Historical note",
        authorId: "unknown-member",
        createdAt: DEMO_NOW,
      },
    ],
  };
  for (const source of [missingAssignee, missingAuthor]) {
    assert.throws(
      () => update({ version: 1, status: "in_progress" }, source),
      expectError("data_unavailable"),
    );
    assert.throws(
      () => addNote({ version: 1, text: "New note" }, source),
      expectError("data_unavailable"),
    );
  }
});

test("sample estimates never become bookings, confirmed revenue or conversion", () => {
  const records = createDemoRecords();
  const summary = deriveSummary(records);
  assert.deepEqual(summary, {
    total: 6,
    newCount: 2,
    inProgressCount: 1,
    waitingCount: 1,
    closedCount: 2,
    openCount: 4,
    unassignedCount: 1,
    sampleEstimatedPipeline: 7460,
    estimatedInquiryCount: 3,
    unknownEstimateCount: 1,
    confirmedRevenue: null,
    bookings: null,
    conversionRate: null,
  });
  const closed = records.map((record) => ({
    ...record,
    inquiry: { ...record.inquiry, status: "closed" as const },
  }));
  const closedSummary = deriveSummary(closed);
  assert.equal(closedSummary.sampleEstimatedPipeline, 0);
  assert.equal(closedSummary.confirmedRevenue, null);
  assert.equal(closedSummary.bookings, null);
  assert.equal(closedSummary.conversionRate, null);
});

test("invalid or unlabeled estimates are excluded, and empty summaries do not imply revenue", () => {
  const template = createDemoRecords()[0];
  const estimates = [null, -1, NaN, Infinity, 0, 100];
  const records: DemoRecord[] = estimates.map((estimatedValue, index) => ({
    inquiry: { ...template.inquiry, id: `estimate-${index}` },
    context: { ...template.context, estimatedValue },
  }));
  records.push({
    ...template,
    context: { ...template.context, demoOnly: false, estimatedValue: 9000 },
  } as unknown as DemoRecord);
  const summary = deriveSummary(records);
  assert.equal(summary.sampleEstimatedPipeline, 100);
  assert.equal(summary.estimatedInquiryCount, 2);
  assert.equal(summary.unknownEstimateCount, 5);
  assert.equal(deriveSummary([]).confirmedRevenue, null);
  assert.equal(deriveSummary([]).conversionRate, null);
});

test("filters compose across status, assignee, priority and case-insensitive search", () => {
  const records = createDemoRecords();
  assert.equal(filterInquiries(records).length, 6);
  assert.deepEqual(
    filterInquiries(records, {
      query: "  JAMIE  ",
      status: "new",
      assigneeId: "unassigned",
      priority: "high",
    }).map((record) => record.inquiry.id),
    ["inq-1042"],
  );
  assert.equal(
    filterInquiries(records, { status: "closed", assigneeId: "sam" }).length,
    1,
  );
  assert.equal(filterInquiries(records, { query: "northside" }).length, 1);
  assert.equal(filterInquiries(records, { query: "does-not-exist" }).length, 0);
  assert.equal(
    filterInquiries(records, {
      status: "all",
      assigneeId: "all",
      priority: "all",
    }).length,
    6,
  );
  assert.equal(records.length, 6);
});
