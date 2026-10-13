import { Stack, ThemeProvider, DarkTheme } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider } from "../state/AppState";
import { C } from "../components/ui";
export default function Layout() {
  return (
    <AppProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            contentStyle: { backgroundColor: C.bg },
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.text,
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="inquiry/[id]"
            options={{ title: "Inquiry", headerBackTitle: "Back" }}
          />
        </Stack>
      </ThemeProvider>
    </AppProvider>
  );
}
