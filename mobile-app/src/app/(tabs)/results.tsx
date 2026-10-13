import { View } from "react-native";
import {
  C,
  Card,
  Icon,
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
export default function Results() {
  const { records } = useApp();
  const summary = deriveSummary(records);
  const bars: [string, number, string][] = [
    ["New", summary.newCount, C.mint],
    ["In progress", summary.inProgressCount, C.blue],
    ["Waiting on customer", summary.waitingCount, C.amber],
    ["Closed", summary.closedCount, C.muted],
  ];
  return (
    <Screen
      title="Know where you stand."
      subtitle="Clear numbers. Honest context."
    >
      <StateGate>
        <Card>
          <Label>SAMPLE INQUIRIES IN THIS VIEW</Label>
          <T
            style={{
              fontSize: 52,
              lineHeight: 60,
              fontWeight: "600",
              letterSpacing: -2,
            }}
          >
            {summary.total}
          </T>
          <View style={{ gap: 18 }}>
            {bars.map(([label, count, color]) => (
              <View key={label} style={{ gap: 7 }}>
                <View style={[s.row, { justifyContent: "space-between" }]}>
                  <T style={{ fontSize: 14 }}>{label}</T>
                  <T style={{ fontWeight: "700" }}>{count}</T>
                </View>
                <View
                  accessibilityLabel={`${label}: ${count}`}
                  style={{
                    height: 6,
                    borderRadius: 4,
                    backgroundColor: C.bg,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 6,
                      width: `${summary.total ? (count / summary.total) * 100 : 0}%`,
                      backgroundColor: color,
                      borderRadius: 4,
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
          <T style={{ fontSize: 12, lineHeight: 19, color: C.muted }}>
            These are loaded sample records, not all-time business totals. The
            current server view is capped at 100 inquiries.
          </T>
        </Card>
        <Section title="Opportunity, clearly labeled" />
        <Card>
          <View style={s.row}>
            <Icon name="trending-up-outline" color={C.mint} />
            <Label>SAMPLE ESTIMATED PIPELINE</Label>
          </View>
          <T style={{ fontSize: 36, lineHeight: 44, fontWeight: "600" }}>
            ${summary.sampleEstimatedPipeline.toLocaleString("en-US")}
          </T>
          <T style={s.subtitle}>
            Fictional estimates across {summary.estimatedInquiryCount} open
            inquiries. {summary.unknownEstimateCount} open inquiry has no
            estimate. This is neither collected revenue nor a promise of work.
          </T>
        </Card>
        <Section title="Outcomes need evidence" />
        {[
          ["Confirmed revenue", "Payments are not connected."],
          ["Bookings", "Scheduling is not connected."],
          ["Conversion rate", "Requires verified inquiry-to-booking evidence."],
        ].map(([title, description]) => (
          <Card key={title} style={{ gap: 8 }}>
            <View
              style={[
                s.row,
                { justifyContent: "space-between", flexWrap: "wrap" },
              ]}
            >
              <T style={{ fontWeight: "600" }}>{title}</T>
              <T style={{ color: C.muted, fontSize: 13 }}>Not connected</T>
            </View>
            <T style={s.subtitle}>{description}</T>
          </Card>
        ))}
        <Notice text="Closed is a workflow status. It doesn't mean a job was booked, completed or paid." />
      </StateGate>
    </Screen>
  );
}
