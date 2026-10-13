import React from "react";
import {
  ActivityIndicator,
  ColorValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useApp } from "../state/AppState";
import type { DemoRecord, Status } from "../domain";
import { members, DEMO_NOW } from "../data";
export const C = {
  bg: "#0A1323",
  surface: "#122239",
  surface2: "#192B43",
  text: "#F5F7FB",
  muted: "#ACBCD0",
  mint: "#8DE6C4",
  border: "#293D56",
  amber: "#F5C66B",
  red: "#FFABA5",
  blue: "#AED1FF",
};
export const STATUS: Record<Status, string> = {
  new: "New",
  in_progress: "In progress",
  waiting: "Waiting on customer",
  closed: "Closed",
};
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  color = C.muted,
  size = 22,
}: {
  name: IconName;
  color?: ColorValue;
  size?: number;
}) {
  return <Ionicons name={name} size={size} color={color} accessible={false} />;
}
export function T({ style, ...props }: TextProps) {
  const { largeText } = useApp();
  const flat = StyleSheet.flatten(style) || {};
  return (
    <Text
      {...props}
      allowFontScaling
      style={[
        { fontSize: 16, color: C.text, lineHeight: 24 },
        style,
        largeText && {
          fontSize: (flat.fontSize || 16) * 1.25,
          lineHeight: (flat.lineHeight || 24) * 1.25,
        },
      ]}
    />
  );
}
export function Card({ style, ...props }: ViewProps) {
  return <View {...props} style={[s.card, style]} />;
}
export function Label({ children }: React.PropsWithChildren) {
  return <T style={s.label}>{children}</T>;
}
export function Button({
  title,
  onPress,
  icon,
  secondary,
  disabled = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        disabled && s.disabled,
        pressed && !disabled && { opacity: 0.75 },
      ]}
    >
      {icon && <Icon name={icon} color={secondary ? C.text : C.bg} />}
      <T
        style={[
          s.buttonText,
          secondary && { color: C.text },
          disabled && { color: C.muted },
        ]}
      >
        {title}
      </T>
    </Pressable>
  );
}
export function Chip({
  title,
  selected = false,
  onPress,
}: {
  title: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ selected }}
      onPress={onPress}
      disabled={!onPress}
      style={[s.chip, selected && s.chipSelected]}
    >
      <T style={[s.chipText, selected && { color: C.bg }]}>{title}</T>
    </Pressable>
  );
}
export function Badge({ status }: { status: Status }) {
  return (
    <View
      style={[
        s.badge,
        {
          backgroundColor:
            status === "new"
              ? "#193D37"
              : status === "waiting"
                ? "#3A3021"
                : C.surface2,
        },
      ]}
    >
      <T
        style={{
          fontSize: 12,
          lineHeight: 18,
          fontWeight: "700",
          color:
            status === "new"
              ? C.mint
              : status === "waiting"
                ? C.amber
                : C.muted,
        }}
      >
        {STATUS[status]}
      </T>
    </View>
  );
}
export function Section({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={s.section}>
      <T accessibilityRole="header" style={s.sectionTitle}>
        {title}
      </T>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={s.textAction}
        >
          <T style={{ color: C.mint, fontSize: 14, fontWeight: "600" }}>
            {action}
          </T>
          <Icon name="arrow-forward" size={16} color={C.mint} />
        </Pressable>
      )}
    </View>
  );
}
export function Screen({
  children,
  title,
  subtitle,
  scroll = true,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
}) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={s.screen}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <Header title={title} subtitle={subtitle} />
          {children}
        </ScrollView>
      ) : (
        <View style={[s.content, { flex: 1 }]}>
          <Header title={title} subtitle={subtitle} />
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}
function Header({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <>
      <View style={s.brandRow}>
        <View style={s.brandIcon}>
          <Icon name="radio-outline" color={C.mint} size={23} />
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: "700", fontSize: 16, lineHeight: 20 }}>
            BookedRadar
          </T>
          <T style={{ fontSize: 12, lineHeight: 20, color: C.muted }}>
            Cedar & Pine · Fictional business
          </T>
        </View>
        <View style={s.samplePill}>
          <T
            style={{
              color: C.mint,
              fontSize: 10,
              lineHeight: 18,
              fontWeight: "800",
              letterSpacing: 1,
            }}
          >
            SAMPLE
          </T>
        </View>
      </View>
      {title && (
        <View style={s.heading}>
          <T accessibilityRole="header" style={s.title}>
            {title}
          </T>
          {subtitle && <T style={s.subtitle}>{subtitle}</T>}
        </View>
      )}
      <ConnectionBanner />
    </>
  );
}
export function ConnectionBanner() {
  const { mode, viewer } = useApp();
  if (mode === "offline")
    return (
      <Notice
        icon="cloud-offline-outline"
        tone="warning"
        text="Offline preview · Read-only sample. No changes are queued."
      />
    );
  if (viewer)
    return (
      <Notice
        icon="eye-outline"
        text="Viewer preview · You can read inquiries. Editing is disabled."
      />
    );
  return null;
}
export function Notice({
  text,
  icon = "information-circle-outline",
  tone = "info",
}: {
  text: string;
  icon?: IconName;
  tone?: "info" | "warning" | "error";
}) {
  return (
    <View
      accessibilityRole="text"
      style={[s.notice, tone === "error" && { borderColor: C.red }]}
    >
      <Icon
        name={icon}
        size={20}
        color={tone === "warning" ? C.amber : tone === "error" ? C.red : C.mint}
      />
      <T
        style={{
          fontSize: 13,
          lineHeight: 20,
          color: tone === "error" ? C.red : C.muted,
          flex: 1,
        }}
      >
        {text}
      </T>
    </View>
  );
}
export function StateGate({ children }: { children: React.ReactNode }) {
  const { mode, setMode } = useApp();
  if (mode === "loading")
    return (
      <Card style={s.empty}>
        <ActivityIndicator
          size="large"
          color={C.mint}
          accessibilityLabel="Loading sample inquiries"
        />
        <T style={s.sectionTitle}>Loading your view</T>
        <T style={s.subtitle}>
          A loading-state preview. No live request is being made.
        </T>
        <Button
          secondary
          title="Finish sample loading"
          onPress={() => setMode("ready")}
        />
      </Card>
    );
  if (mode === "error" || mode === "expired")
    return (
      <Card style={s.empty}>
        <Icon
          name={
            mode === "expired" ? "lock-closed-outline" : "cloud-offline-outline"
          }
          size={36}
          color={C.amber}
        />
        <T style={s.sectionTitle}>
          {mode === "expired" ? "Session ended" : "Unable to load inquiries"}
        </T>
        <T style={s.subtitle}>
          {mode === "expired"
            ? "Live sign-in is not connected. Return to the sample workspace to continue."
            : "Your work has not been changed. This is a connection-error preview."}
        </T>
        <Button
          title={
            mode === "expired"
              ? "Return to sample workspace"
              : "Retry sample view"
          }
          onPress={() => setMode("ready")}
        />
      </Card>
    );
  return <>{children}</>;
}
export function Empty({
  title = "Nothing here yet",
  detail = "New inquiries will appear here when a source is connected.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <Card style={s.empty}>
      <Icon name="checkmark-circle-outline" color={C.mint} size={36} />
      <T style={s.sectionTitle}>{title}</T>
      <T style={s.subtitle}>{detail}</T>
    </Card>
  );
}
export function relativeTime(iso: string) {
  const minutes = Math.max(
    0,
    Math.floor(
      (new Date(DEMO_NOW).getTime() - new Date(iso).getTime()) / 60000,
    ),
  );
  return minutes < 60
    ? `${minutes}m ago`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h ago`
      : `${Math.floor(minutes / 1440)}d ago`;
}
export function InquiryCard({
  record,
  compact = false,
}: {
  record: DemoRecord;
  compact?: boolean;
}) {
  const i = record.inquiry;
  const high = record.context.priority === "high";
  const assignee = members.find((m) => m.id === i.assigneeId);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open inquiry from ${i.customerName}. ${i.subject}. ${STATUS[i.status]}. ${assignee?.name || "Unassigned"}.`}
      onPress={() =>
        router.push({ pathname: "/inquiry/[id]", params: { id: i.id } })
      }
      style={({ pressed }) => [
        s.inquiryCard,
        pressed && { backgroundColor: C.surface2 },
      ]}
    >
      <View style={s.row}>
        <View style={[s.avatar, high && { backgroundColor: "#3A3021" }]}>
          <T
            style={{
              fontWeight: "700",
              fontSize: 15,
              color: high ? C.amber : C.mint,
            }}
          >
            {i.customerName
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </T>
        </View>
        <View style={{ flex: 1 }}>
          <T style={{ fontWeight: "700", fontSize: 16 }}>{i.customerName}</T>
          <T style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
            {i.source} · {relativeTime(i.receivedAt)}
          </T>
        </View>
        <Icon name="chevron-forward" size={20} />
      </View>
      <T style={{ fontWeight: "600", fontSize: 17, lineHeight: 24 }}>
        {i.subject}
      </T>
      {!compact && (
        <T
          numberOfLines={2}
          style={{ fontSize: 14, lineHeight: 21, color: C.muted }}
        >
          {i.summary}
        </T>
      )}
      <View
        style={[s.row, { justifyContent: "space-between", flexWrap: "wrap" }]}
      >
        <Badge status={i.status} />
        <T
          style={{
            fontSize: 12,
            lineHeight: 18,
            color: assignee ? C.muted : C.amber,
          }}
        >
          {assignee?.name || "Unassigned"}
        </T>
      </View>
      {high && (
        <View style={s.row}>
          <Icon name="flag-outline" size={13} color={C.amber} />
          <T style={{ color: C.amber, fontSize: 12, lineHeight: 18 }}>
            High priority · sample signal
          </T>
        </View>
      )}
    </Pressable>
  );
}
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: {
    padding: 20,
    paddingBottom: 32,
    gap: 16,
    width: "100%",
    maxWidth: 700,
    alignSelf: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 6,
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  samplePill: {
    backgroundColor: "#193D37",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  heading: { gap: 5, marginVertical: 5 },
  title: {
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "700",
    letterSpacing: -0.7,
  },
  subtitle: { color: C.muted, fontSize: 14, lineHeight: 22 },
  card: {
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  label: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  button: {
    minHeight: 52,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.mint,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "700",
    color: C.bg,
    textAlign: "center",
  },
  secondary: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  disabled: { opacity: 0.55, backgroundColor: C.surface2 },
  chip: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: C.mint, borderColor: C.mint },
  chipText: { fontSize: 13, lineHeight: 20, fontWeight: "600", color: C.muted },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 18, lineHeight: 26, fontWeight: "700" },
  textAction: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  notice: {
    padding: 14,
    gap: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  empty: { paddingVertical: 32, alignItems: "center" },
  inquiryCard: {
    backgroundColor: C.surface,
    padding: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#193D37",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7 },
  input: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
    color: C.text,
    fontSize: 16,
    minHeight: 52,
  },
  divider: { height: 1, backgroundColor: C.border },
  muted: { color: C.muted },
});
