import { View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  C,
  Card,
  Empty,
  Icon,
  InquiryCard,
  Label,
  Notice,
  Screen,
  Section,
  StateGate,
  T,
  s,
} from "../../components/ui";
import { useApp } from "../../state/AppState";
import { deriveSummary } from "../../domain";
export default function Today() {
  const { records } = useApp();
  const summary = deriveSummary(records);
  const attention = records.filter(
    (x) => x.inquiry.status === "new" || x.inquiry.status === "in_progress",
  );
  const unassigned = attention.filter((x) => !x.inquiry.assigneeId);
  const assigned = attention.filter((x) => x.inquiry.assigneeId);
  const first = unassigned[0] ?? assigned[0];
  return (
    <Screen
      title="A clear next step."
      subtitle={`${summary.total} sample inquiries. Your team's next steps.`}
    >
      <StateGate>
        <Card
          style={{
            backgroundColor: "#17332F",
            borderColor: "#2F594B",
            gap: 10,
            padding: 18,
          }}
        >
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <Label>NEEDS ATTENTION</Label>
            <Icon name="sparkles-outline" color={C.mint} />
          </View>
          <View style={[s.row, { alignItems: "baseline", gap: 10 }]}>
            <T
              style={{
                fontSize: 42,
                lineHeight: 50,
                fontWeight: "600",
                letterSpacing: -2,
                color: C.mint,
              }}
            >
              {attention.length}
            </T>
            <T
              style={{
                fontSize: 18,
                lineHeight: 25,
                color: "#D2E9DF",
                flex: 1,
              }}
            >
              inquiries need attention
            </T>
          </View>
          <T style={{ fontSize: 14, lineHeight: 22, color: "#B5CEC3" }}>
            {unassigned.length
              ? `${unassigned.length} unassigned · ${assigned.length} with your team`
              : "Every inquiry needing attention has an owner."}
          </T>
          {first && (
            <Button
              title="Review next inquiry"
              icon="arrow-forward"
              onPress={() =>
                router.push({
                  pathname: "/inquiry/[id]",
                  params: { id: first.inquiry.id },
                })
              }
            />
          )}
        </Card>
        <Section
          title="Needs an owner"
          action="View all"
          onPress={() => router.push("/inquiries")}
        />
        {unassigned.length ? (
          unassigned.map((r) => (
            <InquiryCard compact key={r.inquiry.id} record={r} />
          ))
        ) : (
          <Empty
            title="All assigned"
            detail="Every inquiry needing attention has an owner."
          />
        )}
        {assigned.length > 0 && (
          <>
            <Section title="Keep things moving" />
            {assigned.map((r) => (
              <InquiryCard compact key={r.inquiry.id} record={r} />
            ))}
          </>
        )}
        <View style={[s.row, { alignItems: "stretch" }]}>
          <Card style={{ flex: 1, padding: 16, gap: 3 }}>
            <T style={{ fontSize: 26, lineHeight: 34, fontWeight: "700" }}>
              {summary.total}
            </T>
            <T style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
              Inquiries in this view
            </T>
          </Card>
          <Card style={{ flex: 1, padding: 16, gap: 3 }}>
            <T style={{ fontSize: 26, lineHeight: 34, fontWeight: "700" }}>
              {summary.waitingCount}
            </T>
            <T style={{ fontSize: 12, lineHeight: 18, color: C.muted }}>
              Waiting on customer
            </T>
          </Card>
        </View>
        <Notice text="Sample workspace. All people, requests and changes are fictional. No calls or messages will be sent." />
        <Section title="Follow-ups" />
        <Card>
          <View style={s.row}>
            <Icon name="time-outline" color={C.mint} />
            <T style={s.sectionTitle}>Timing without guesswork</T>
          </View>
          <T style={s.subtitle}>
            Due dates and automated follow-ups aren't connected. Review each
            customer's stated preference before arranging a next step.
          </T>
        </Card>
      </StateGate>
    </Screen>
  );
}
