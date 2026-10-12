# Connected staging UI checks

The separate `/portal` entrypoint uses `staging-index.html`, `staging-app.mjs`, `staging-styles.css`, the unchanged `styles.css`, and the shared same-origin `client.mjs`. It is served only by the explicitly enabled staging runtime. The five static preview files remain byte-for-byte identical to the frozen PR #105 candidate.

## Run

```sh
npm ci --prefix qa/reporting-browser
(cd qa/reporting-browser && npx playwright install --with-deps chromium)
node --test customer-portal/qa/staging-client.test.mjs
node customer-portal/qa/staging-browser.mjs
```

The browser suite starts its own synthetic loopback harness. There is deliberately no remote URL option. It calls the real `createCustomerPortalService` against a test-only in-memory store, with synthetic sessions and fictional inquiries in two workspaces. It checks anonymous/session-loading gates; saved assignments, status and notes; server versions and audit effects; note escaping and duplicate-click suppression; draft isolation; history/focus; slow-response fencing; conflicts; uncertain-save reconciliation; stale snapshots; expiry clearing; viewer restrictions; loading/error/empty snapshots; cross-workspace rejection; account-switch isolation, focus revalidation and cross-tab auth-change clearing; CSRF logout and logout races; responsive layouts; and absence of external requests or browser-stored credentials.

The seven additional transport checks cover exact logout method/CSRF/body, read fencing even on failed logout, mutation/logout serialization, strict provider logout redirect validation, session-marker binding on authenticated reads, an account A to B same-inquiry-ID regression against the real API service, and focus revalidation of identity plus session marker. Run the existing client tests as well when changing transport behavior.

## Evidence and limits

Browser screenshots and machine-readable results are written to `qa/staging-evidence/`. These generated artifacts should be uploaded by CI, not committed. Passing this suite verifies the connected UI and service contract with synthetic data. It does not verify real Wix login, a durable PostgreSQL store, staging deployment, or any provider/customer integration.

The authoring environment prohibits Chromium startup at the operating-system socket boundary. Browser execution is therefore deferred to the dedicated CI job; syntax checks and transport unit tests can run locally. Do not substitute a mocked DOM run for real-browser evidence or call a never-run browser stage a pass.
