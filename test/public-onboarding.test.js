import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createPublicOnboardingRouter } from "../src/public-onboarding.js";

test("public onboarding serves the reviewed page and assets without exposing the source directory", async (t) => {
  const app = express();
  app.use("/onboarding", createPublicOnboardingRouter());
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/onboarding`;
  const response = await fetch(`${base}/quick-start.html`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<base href="https:\/\/www.bookedradar.com\/">/);
  assert.match(html, /https:\/\/bookedradar-platform.onrender.com\/onboarding\/quick-start.js/);
  assert.match(html, /https:\/\/bookedradar-platform.onrender.com\/onboarding\/styles.css/);
  assert.match(html, /Email only — no setup or sales calls/);
  assert.match(html, /name="urgent_contact"[^>]*required/);
  const script = await fetch(`${base}/quick-start.js`);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /contact_preference/);
  const css = await fetch(`${base}/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  const audit = await fetch(`${base}/audit.html`);
  const auditHtml = await audit.text();
  assert.equal(audit.status, 200);
  assert.match(auditHtml, /https:\/\/bookedradar-platform.onrender.com\/onboarding\/audit-capture.js/);
  assert.match(auditHtml, /https:\/\/bookedradar-platform.onrender.com\/onboarding\/audit.js/);
  assert.doesNotMatch(auditHtml, /oauth2\/token|form-submission-service/);
  for (const asset of ["audit.js", "audit-capture.js", "bookedradar-telemetry.js"]) {
    assert.equal((await fetch(`${base}/${asset}`)).status, 200);
  }
  for (const other of ["index.html", "wix.config.json", "demo-chat.html"]) {
    assert.equal((await fetch(`${base}/${other}`)).status, 404);
  }
});
