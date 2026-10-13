import { Tabs } from "expo-router";
import { C, Icon } from "../../components/ui";
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.mint,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: {
          backgroundColor: C.bg,
          borderTopColor: C.border,
          minHeight: 70,
          paddingTop: 9,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color }) => (
            <Icon name="radio-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inquiries"
        options={{
          title: "Inquiries",
          tabBarIcon: ({ color }) => (
            <Icon name="file-tray-full-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="results"
        options={{
          title: "Results",
          tabBarIcon: ({ color }) => (
            <Icon name="bar-chart-outline" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <Icon name="options-outline" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
