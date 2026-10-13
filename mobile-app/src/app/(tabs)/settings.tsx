import { Switch, View } from "react-native";
import {
  Button,
  C,
  Card,
  Chip,
  Icon,
  Notice,
  Screen,
  Section,
  T,
  s,
} from "../../components/ui";
import { type DemoState, useApp } from "../../state/AppState";
export default function Settings() {
  const app = useApp();
  const modes: [DemoState, string][] = [
    ["ready", "Ready"],
    ["loading", "Loading"],
    ["empty", "Empty"],
    ["error", "Error"],
    ["offline", "Offline"],
    ["expired", "Session ended"],
  ];
  return (
    <Screen title="Your workspace" subtitle="Built for a focused day.">
      <Card>
        <View style={s.row}>
          <View style={[s.avatar, { width: 50, height: 50 }]}>
            <Icon name="leaf-outline" color={C.mint} size={26} />
          </View>
          <View style={{ flex: 1 }}>
            <T style={s.sectionTitle}>Cedar & Pine</T>
            <T style={s.subtitle}>Fictional service business</T>
          </View>
        </View>
        <Notice text="Sample workspace · Changes stay in memory and reset when you restart. No real business data is connected." />
      </Card>
      <Section title="Connection" />
      <Card>
        <View style={s.row}>
          <Icon name="shield-checkmark-outline" color={C.mint} />
          <T style={s.sectionTitle}>A safe start</T>
        </View>
        <T style={s.subtitle}>
          Live sign-in is not configured for the phone app. Your business
          identity and access must be verified by the server before real
          inquiries can appear.
        </T>
        <Button
          title="Live sign-in · Not connected"
          icon="lock-closed-outline"
          disabled
          onPress={() => {}}
        />
      </Card>
      <Section title="Comfort & access" />
      <Card>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: "600" }}>Larger text preview</T>
            <T style={s.subtitle}>Device text scaling is also supported.</T>
          </View>
          <Switch
            accessibilityLabel="Larger text preview"
            value={app.largeText}
            onValueChange={app.setLargeText}
            trackColor={{ true: C.mint, false: C.border }}
          />
        </View>
        <View style={s.divider} />
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: "600" }}>Read-only role preview</T>
            <T style={s.subtitle}>Experience a viewer's workspace.</T>
          </View>
          <Switch
            accessibilityLabel="Read-only role preview"
            value={app.viewer}
            onValueChange={app.setViewer}
            trackColor={{ true: C.mint, false: C.border }}
          />
        </View>
      </Card>
      <Section title="Preview reliability states" />
      <T style={s.subtitle}>
        Choose a sample state, then open Today or Inquiries. These controls
        simulate conditions; they don't change a connection.
      </T>
      <View style={[s.row, { flexWrap: "wrap" }]}>
        {modes.map(([mode, title]) => (
          <Chip
            key={mode}
            title={title}
            selected={mode === app.mode}
            onPress={() => app.setMode(mode)}
          />
        ))}
      </View>
      <Button
        secondary
        title="Reset sample workspace"
        icon="refresh-outline"
        onPress={app.reset}
      />
      <Notice text="Phone calls, messages, push notifications, payments, recordings and calendar availability are not connected. This app requests none of those permissions." />
      <T
        style={{
          fontSize: 12,
          lineHeight: 20,
          color: C.muted,
          textAlign: "center",
        }}
      >
        BOOKEDRADAR · MOBILE FOUNDATION 0.1{"\n"}Built for iPhone and Android.
        Device validation pending.
      </T>
    </Screen>
  );
}
