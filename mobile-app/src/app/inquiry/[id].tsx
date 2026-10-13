import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Badge,
  Button,
  C,
  Card,
  Empty,
  Icon,
  Label,
  Notice,
  Section,
  StateGate,
  T,
  STATUS,
  s,
} from "../../components/ui";
import { allowedTransitions, type Status } from "../../domain";
import { members } from "../../data";
import { useApp } from "../../state/AppState";
export default function Detail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const record = app.records.find((r) => r.inquiry.id === id);
  const [sheet, setSheet] = useState<{
    kind: "status" | "assignment";
    version: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  if (!record)
    return (
      <SafeAreaView style={s.screen}>
        <View style={s.content}>
          <Empty
            title="Inquiry not available"
            detail="This record isn't in the current sample view."
          />
          <Button
            title="Back to inquiries"
            onPress={() => router.replace("/inquiries")}
          />
        </View>
      </SafeAreaView>
    );
  const { inquiry: i, context } = record;
  const assignee = members.find((m) => m.id === i.assigneeId);
  const draft = app.drafts[id] || "";
  const save = (fn: () => void) => {
    try {
      fn();
      setError("");
      setSaved("Saved in this sample session.");
      setSheet(null);
    } catch (e) {
      const code = (e as { errorCode?: string }).errorCode;
      setError(
        code === "version_conflict"
          ? "This inquiry changed. Review the latest details before trying again. Your draft is still here."
          : code === "invalid_note"
            ? "Add a note with 1–2,000 characters."
            : code === "offline"
              ? "You’re offline. Your draft is still here; nothing was queued."
              : "Unable to save this change. Your draft is still here.",
      );
      setSheet(null);
    }
  };
  const disabledReason =
    app.mode === "offline"
      ? "Offline sample is read-only. No edits are queued."
      : app.viewer
        ? "Your preview role is read-only."
        : "Editing is available only in the ready sample state.";
  return (
    <SafeAreaView edges={["bottom", "left", "right"]} style={s.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          <StateGate>
            <View
              style={[
                s.row,
                { justifyContent: "space-between", flexWrap: "wrap" },
              ]}
            >
              <Label>SAMPLE INQUIRY · {i.id.replace("inq-", "#")}</Label>
              <Badge status={i.status} />
            </View>
            <View style={{ gap: 8 }}>
              <T
                accessibilityRole="header"
                style={{
                  fontSize: 30,
                  lineHeight: 38,
                  fontWeight: "700",
                  letterSpacing: -0.5,
                }}
              >
                {i.customerName}
              </T>
              <T style={{ fontSize: 19, lineHeight: 28, color: C.muted }}>
                {i.subject}
              </T>
              <T style={{ fontSize: 12, lineHeight: 20, color: C.muted }}>
                Received Oct 12 ·{" "}
                {new Date(i.receivedAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: "UTC",
                })}{" "}
                UTC · {i.source}
              </T>
            </View>
            {context.priority === "high" && (
              <Notice
                tone="warning"
                icon="flag-outline"
                text="High priority · Fictional signal for this preview. Review the request before promising a response time."
              />
            )}
            <Card>
              <Label>WHAT THE CUSTOMER NEEDS</Label>
              <T style={{ fontSize: 16, lineHeight: 26 }}>{i.summary}</T>
            </Card>
            <Card>
              <Label>CUSTOMER CONTACT</Label>
              <View style={s.row}>
                <Icon name="call-outline" />
                <T selectable style={{ flex: 1 }}>
                  {i.contact.phone || "Phone not available"}
                </T>
              </View>
              <View style={s.row}>
                <Icon name="mail-outline" />
                <T selectable style={{ flex: 1 }}>
                  {i.contact.email || "Email not available"}
                </T>
              </View>
              <View style={[s.row, { alignItems: "stretch" }]}>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    disabled
                    title="Call"
                    icon="call-outline"
                    onPress={() => {}}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    secondary
                    disabled
                    title="Message"
                    icon="chatbubble-outline"
                    onPress={() => {}}
                  />
                </View>
              </View>
              <T style={{ fontSize: 12, lineHeight: 19, color: C.muted }}>
                Calls and messages aren't connected. These are reserved sample
                contact details.
              </T>
            </Card>
            <Section title="Move the inquiry forward" />
            <Card>
              <View
                style={[
                  s.row,
                  { justifyContent: "space-between", flexWrap: "wrap" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Label>STATUS</Label>
                  <T style={{ fontWeight: "600" }}>{STATUS[i.status]}</T>
                </View>
                <Button
                  secondary
                  disabled={!app.canEdit}
                  title="Change status"
                  onPress={() =>
                    setSheet({ kind: "status", version: i.version })
                  }
                />
              </View>
              <View style={s.divider} />
              <View
                style={[
                  s.row,
                  { justifyContent: "space-between", flexWrap: "wrap" },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Label>OWNER</Label>
                  <T
                    style={{
                      fontWeight: "600",
                      color: assignee ? C.text : C.amber,
                    }}
                  >
                    {assignee?.name || "Unassigned"}
                  </T>
                </View>
                <Button
                  secondary
                  disabled={!app.canEdit}
                  title="Assign owner"
                  onPress={() =>
                    setSheet({ kind: "assignment", version: i.version })
                  }
                />
              </View>
              <T style={{ fontSize: 12, lineHeight: 19, color: C.muted }}>
                Workflow only. Changing status won't book a job or contact the
                customer.
              </T>
            </Card>
            {!app.canEdit && <Notice text={disabledReason} tone="warning" />}
            {saved && (
              <View accessibilityLiveRegion="polite">
                <Notice text={saved} icon="checkmark-circle-outline" />
              </View>
            )}
            {error && (
              <View accessibilityLiveRegion="assertive">
                <Notice text={error} tone="error" />
              </View>
            )}
            <Section title="Request context" />
            <Card>
              <Label>PROPOSED FIELDS · SAMPLE ONLY</Label>
              {[
                ["Service", context.service],
                ["Customer preference", context.preferredTime],
                ["Service area", context.location],
              ].map(([label, value]) => (
                <View key={label} style={{ gap: 4 }}>
                  <T style={{ fontSize: 12, color: C.muted }}>{label}</T>
                  <T>{value}</T>
                </View>
              ))}
              <Notice text="A requested time isn't an appointment. Team availability and scheduling are not connected." />
            </Card>
            <Section title="Internal notes" />
            <Card>
              <Label>ADD CONTEXT FOR YOUR TEAM</Label>
              <TextInput
                testID="note-input"
                accessibilityLabel="Internal note"
                placeholder="What should the next teammate know?"
                placeholderTextColor={C.muted}
                value={draft}
                onChangeText={(text) => {
                  app.setDraft(id, text);
                  setSaved("");
                }}
                multiline
                textAlignVertical="top"
                editable={app.canEdit}
                style={[
                  s.input,
                  {
                    minHeight: 120,
                    fontSize: app.largeText ? 20 : 16,
                    lineHeight: app.largeText ? 30 : 24,
                  },
                ]}
                maxLength={2100}
              />
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <T
                  style={{
                    fontSize: 12,
                    color: draft.length > 2000 ? C.red : C.muted,
                  }}
                >
                  {draft.length} / 2,000
                </T>
                <T style={{ fontSize: 12, color: C.muted }}>
                  Not sent to the customer
                </T>
              </View>
              <Button
                title="Save sample note"
                icon="add-outline"
                disabled={!app.canEdit || !draft.trim() || draft.length > 2000}
                onPress={() => save(() => app.note(id, i.version, draft))}
              />
              <T style={{ fontSize: 12, lineHeight: 19, color: C.muted }}>
                Notes are append-only. Unsaved drafts stay in this session when
                you navigate away.
              </T>
            </Card>
            {i.notes.length ? (
              i.notes.map((note) => (
                <Card key={note.id} style={{ gap: 8 }}>
                  <View
                    style={[
                      s.row,
                      { justifyContent: "space-between", flexWrap: "wrap" },
                    ]}
                  >
                    <T style={{ fontWeight: "700", fontSize: 14 }}>
                      {members.find((m) => m.id === note.authorId)?.name ||
                        "Team member"}
                    </T>
                    <T style={{ fontSize: 12, color: C.muted }}>
                      {new Date(note.createdAt).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </T>
                  </View>
                  <T style={{ fontSize: 15, lineHeight: 24 }}>{note.text}</T>
                </Card>
              ))
            ) : (
              <T style={{ fontSize: 14, color: C.muted }}>
                No internal notes yet. Add the first useful detail.
              </T>
            )}
            <Notice text="No recording or transcript is connected. The summary above is fictional sample content." />
          </StateGate>
        </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={!!sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(null)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,.7)",
          }}
        >
          <SafeAreaView
            edges={["bottom"]}
            style={{
              backgroundColor: C.surface,
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              maxHeight: "85%",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 24, gap: 14 }}>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <T accessibilityRole="header" style={s.sectionTitle}>
                  {sheet?.kind === "status"
                    ? "Change status"
                    : "Assign an owner"}
                </T>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close sheet"
                  onPress={() => setSheet(null)}
                  style={{
                    minWidth: 48,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="close" />
                </Pressable>
              </View>
              <T style={s.subtitle}>
                {sheet?.kind === "status"
                  ? "Choose the next workflow step. This only changes the sample inquiry."
                  : "Choose a teammate in this fictional business."}
              </T>
              {sheet?.kind === "status"
                ? allowedTransitions(i.status).map((status: Status) => (
                    <Button
                      secondary
                      key={status}
                      title={
                        status === "closed"
                          ? "Close inquiry"
                          : status === "in_progress"
                            ? "Start / resume work"
                            : "Wait for customer"
                      }
                      onPress={() =>
                        save(() => app.workflow(id, sheet.version, { status }))
                      }
                    />
                  ))
                : [
                    ...members
                      .filter((m) => m.active && m.role === "operator")
                      .map((m) => ({
                        id: m.id as string | null,
                        name: m.name,
                      })),
                    { id: null, name: "Unassigned" },
                  ].map((m) => (
                    <Button
                      secondary
                      key={m.id || "none"}
                      disabled={m.id === i.assigneeId}
                      title={`${m.name}${m.id === i.assigneeId ? " · Current" : ""}`}
                      onPress={() =>
                        sheet &&
                        save(() =>
                          app.workflow(id, sheet.version, { assigneeId: m.id }),
                        )
                      }
                    />
                  ))}
              <Button secondary title="Cancel" onPress={() => setSheet(null)} />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
