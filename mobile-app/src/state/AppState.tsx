import React, { createContext, useContext, useRef, useState } from "react";
import {
  appendNote,
  updateWorkflow,
  type Status,
  type DemoRecord,
} from "../domain";
import { createDemoRecords, members, demoAccess, DEMO_NOW } from "../data";
export type DemoState =
  "ready" | "loading" | "empty" | "error" | "offline" | "expired";
function useAppValue() {
  const [records, setRecords] = useState<DemoRecord[]>(createDemoRecords);
  const current = useRef(records);
  const [mode, setMode] = useState<DemoState>("ready");
  const [viewer, setViewer] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const access = {
    ...demoAccess,
    role: viewer ? ("viewer" as const) : ("operator" as const),
    online: mode !== "offline",
    sessionState:
      mode === "expired" ? ("expired" as const) : ("active" as const),
  };
  const canEdit = !viewer && mode === "ready";
  function commit(id: string, operation: (record: DemoRecord) => DemoRecord) {
    if (!canEdit) throw new Error("Sample view is read-only.");
    const record = current.current.find((item) => item.inquiry.id === id);
    if (!record) throw new Error("This sample inquiry is no longer available.");
    const updated = operation(record);
    current.current = current.current.map((item) =>
      item.inquiry.id === id ? updated : item,
    );
    setRecords(current.current);
    setAnnouncement("Saved in this sample session.");
  }
  function workflow(
    id: string,
    version: number,
    patch: { status?: Status; assigneeId?: string | null },
  ) {
    commit(id, (record) => ({
      ...record,
      inquiry: updateWorkflow(
        record.inquiry,
        { version, ...patch },
        access,
        members,
        DEMO_NOW,
      ),
    }));
  }
  function note(id: string, version: number, text: string) {
    commit(id, (record) => ({
      ...record,
      inquiry: appendNote(
        record.inquiry,
        { version, text },
        access,
        members,
        DEMO_NOW,
      ),
    }));
    setDrafts((previous) => ({ ...previous, [id]: "" }));
  }
  function reset() {
    current.current = createDemoRecords();
    setRecords(current.current);
    setMode("ready");
    setViewer(false);
    setDrafts({});
    setAnnouncement("Sample workspace reset.");
  }
  return {
    records: mode === "empty" ? [] : records,
    mode,
    setMode,
    viewer,
    setViewer,
    largeText,
    setLargeText,
    drafts,
    setDraft: (id: string, value: string) =>
      setDrafts((old) => ({ ...old, [id]: value })),
    workflow,
    note,
    reset,
    canEdit,
    announcement,
    setAnnouncement,
  };
}
const Context = createContext<ReturnType<typeof useAppValue> | null>(null);
export function AppProvider({ children }: React.PropsWithChildren) {
  return <Context.Provider value={useAppValue()}>{children}</Context.Provider>;
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("AppProvider required");
  return value;
}
