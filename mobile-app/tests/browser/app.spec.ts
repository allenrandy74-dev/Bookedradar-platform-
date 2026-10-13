import { test, expect } from "@playwright/test";
// Browser-rendered React Native QA only. This is not iOS or Android acceptance.
test("today, inquiry workflow, notes and truthful results", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("A clear next step.")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByText("Jamie Brooks", { exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("today-browser-render.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Review next inquiry" }).click();
  await expect(
    page.getByRole("heading", { name: "Jamie Brooks", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("inquiry-top-browser-render.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Call", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Change status" }).click();
  await page.getByRole("button", { name: "Start / resume work" }).click();
  await expect(page.getByText("Saved in this sample session.")).toBeVisible();
  await page.getByRole("button", { name: "Assign owner" }).click();
  await page.getByRole("button", { name: "Morgan Chen", exact: true }).click();
  await page
    .getByLabel("Internal note", { exact: true })
    .fill("Browser review: check the upstairs unit.");
  await page.getByRole("button", { name: "Save sample note" }).click();
  await expect(
    page.getByText("Browser review: check the upstairs unit.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("inquiry-browser-render.png"),
    fullPage: true,
  });
  await page.goto("/results");
  await expect(page.getByText("SAMPLE ESTIMATED PIPELINE")).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath("results-browser-render.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("search, empty state, text preview and no horizontal page overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/inquiries");
  await page.getByLabel("Search inquiries").fill("not-a-person");
  await expect(page.getByText("No matching inquiries")).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("switch", { name: "Larger text preview" }).click();
  await expect(
    page.getByRole("switch", { name: "Larger text preview" }),
  ).toBeChecked();
  await page.screenshot({
    path: testInfo.outputPath("settings-large-text-browser.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Live sign-in · Not connected" }),
  ).toBeDisabled();
});
