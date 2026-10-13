import {beforeEach, expect, jest, test} from "@jest/globals";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { AppProvider, useApp } from "../src/state/AppState";
import Today from "../src/app/(tabs)/index";
import Inquiries from "../src/app/(tabs)/inquiries";
import Results from "../src/app/(tabs)/results";
import Settings from "../src/app/(tabs)/settings";
import Detail from "../src/app/inquiry/[id]";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => ({ id: "inq-1042" }),
}));
jest.mock("@expo/vector-icons/Ionicons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return () => React.createElement(View);
});
jest.mock("react-native-safe-area-context", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    SafeAreaView: ({ children, ...props }: any) =>
      React.createElement(View, props, children),
  };
});
function renderApp(children: React.ReactNode) {
  return render(<AppProvider>{children}</AppProvider>);
}
beforeEach(() => { jest.clearAllMocks(); });
test("Today identifies sample data and routes the priority action to an inquiry", async () => {
  await renderApp(<Today />);
  expect(screen.getByText("SAMPLE")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Review next inquiry" }));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/inquiry/[id]",
    params: { id: "inq-1042" },
  });
});
test("Search finds subject and empty results without fabricating inquiries", async () => {
  await renderApp(<Inquiries />);
  await fireEvent.changeText(screen.getByLabelText("Search inquiries"), "heat pump");
  expect(screen.getByText("Taylor Reed")).toBeTruthy();
  expect(screen.queryByText("Jamie Brooks")).toBeNull();
  await fireEvent.changeText(
    screen.getByLabelText("Search inquiries"),
    "no-such-request",
  );
  expect(screen.getByText("No matching inquiries")).toBeTruthy();
});
test("Filter separates closed workflow from active inquiries", async () => {
  await renderApp(<Inquiries />);
  await fireEvent.press(screen.getByRole("button", { name: "Closed" }));
  expect(screen.getByText("Avery Lane")).toBeTruthy();
  expect(screen.queryByText("Jamie Brooks")).toBeNull();
});
test("Detail changes status through permitted transition and keeps source intact", async () => {
  await renderApp(<Detail />);
  await fireEvent.press(screen.getByRole("button", { name: "Change status" }));
  await fireEvent.press(screen.getByRole("button", { name: "Start / resume work" }));
  expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
  expect(screen.getByText("Jamie Brooks")).toBeTruthy();
  expect(screen.getByText("Saved in this sample session.")).toBeTruthy();
});
test("Owner picker assigns a teammate; cancelling makes no change", async () => {
  await renderApp(<Detail />);
  await fireEvent.press(screen.getByRole("button", { name: "Assign owner" }));
  await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Unassigned")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Assign owner" }));
  await fireEvent.press(screen.getByRole("button", { name: "Morgan Chen" }));
  expect(screen.getByText("Morgan Chen")).toBeTruthy();
});
test("Internal note is saved locally, appears once and clears draft", async () => {
  await renderApp(<Detail />);
  await fireEvent.changeText(
    screen.getByLabelText("Internal note"),
    "Check the upstairs unit first.",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Save sample note" }));
  expect(screen.getAllByText("Check the upstairs unit first.")).toHaveLength(1);
  expect(screen.getByLabelText("Internal note").props.value).toBe("");
  expect(
    screen.getByRole("button", { name: "Call" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Message" }).props.accessibilityState
      .disabled,
  ).toBe(true);
});
test("Overlong note remains in draft and cannot be submitted", async () => {
  await renderApp(<Detail />);
  await fireEvent.changeText(
    screen.getByLabelText("Internal note"),
    "x".repeat(2001),
  );
  expect(
    screen.getByRole("button", { name: "Save sample note" }).props
      .accessibilityState.disabled,
  ).toBe(true);
});
function DetailMode({ mode }: { mode: "offline" | "expired" | "viewer" }) {
  const {setViewer,setMode} = useApp();
  React.useEffect(() => {
    if (mode === "viewer") setViewer(true);
    else setMode(mode);
  }, [mode,setViewer,setMode]);
  return <Detail />;
}
test("Offline sample disables writes and explains no queued actions", async () => {
  await renderApp(<DetailMode mode="offline" />);
  expect(
    screen.getByRole("button", { name: "Change status" }).props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(
    screen.getByText("Offline sample is read-only. No edits are queued."),
  ).toBeTruthy();
});
test("Viewer sample disables assignment and note editing", async () => {
  await renderApp(<DetailMode mode="viewer" />);
  expect(
    screen.getByRole("button", { name: "Assign owner" }).props
      .accessibilityState.disabled,
  ).toBe(true);
  expect(screen.getByLabelText("Internal note").props.editable).toBe(false);
});
test("Expired session hides customer content and offers sample return", async () => {
  await renderApp(<DetailMode mode="expired" />);
  expect(screen.getByText("Session ended")).toBeTruthy();
  expect(screen.queryByText("Jamie Brooks")).toBeNull();
  await fireEvent.press(
    screen.getByRole("button", { name: "Return to sample workspace" }),
  );
  expect(screen.getByText("Jamie Brooks")).toBeTruthy();
});
test("Results keeps unknown financial outcomes separate from estimates", async () => {
  await renderApp(<Results />);
  expect(screen.getByText("SAMPLE ESTIMATED PIPELINE")).toBeTruthy();
  expect(screen.getAllByText("Not connected")).toHaveLength(3);
  expect(screen.getByText(/Closed is a workflow status/)).toBeTruthy();
});
test("Settings safely previews text size, roles and unavailable sign-in", async () => {
  await renderApp(<Settings />);
  expect(
    screen.getByRole("button", { name: "Live sign-in · Not connected" }).props
      .accessibilityState.disabled,
  ).toBe(true);
  await fireEvent(screen.getByLabelText("Larger text preview"), "valueChange", true);
  expect(screen.getByLabelText("Larger text preview").props.value).toBe(true);
});
