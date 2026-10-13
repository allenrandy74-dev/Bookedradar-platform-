# BookedRadar mobile · 0.1

A real Expo / React Native source project for iPhone and Android. This first slice is a **fictional, in-memory sample workspace**. It is not an installable App Store/Play Store release and has not yet been tested on a device or simulator.

## What you can try

- **Today:** prioritize inquiries needing an owner or team attention
- **Inquiries:** search and filter six sample requests
- **Inquiry details:** review customer need/contact; change workflow status; assign an eligible sample teammate; append internal notes
- **Results:** loaded inquiry counts, explicitly fictional opportunity estimates, and unknown booking/revenue results
- **Settings:** large text, read-only role, loading/empty/error/offline/expired-session previews and sample reset

Changes and note drafts stay only in this process's memory. They reset on reload. Calls, customer messages, push, scheduling, recordings, payments and live sign-in are visibly disabled or unavailable. No permission requests, analytics, live API requests, credentials or production data are included.

## Run

Node 22.13+ is required by Expo 57; this project was checked using Node 24.19.0.

```sh
npm ci
npm start
# Choose an available Expo Go / development build on a compatible device.
# A matching SDK runtime is required; a native development build needs platform tooling.
```

```sh
npm run ios      # starts Expo for an available iOS simulator; macOS/Xcode required
npm run android  # starts Expo for an available Android emulator or device
npm run web      # browser rendering for layout review, not native-device acceptance
```

No Expo account or EAS project has been created. A source checkout is not an installable application binary. Signing, developer accounts, native builds, distribution and stores are separate approval/testing stages.

## Checks

```sh
npm run check
npx expo-doctor
npx expo export --platform ios --platform android --output-dir build/native
npm run export:web
# In an environment that supports Chromium:
npx playwright install chromium
npm run test:browser
```

The native exports are Hermes JavaScript bundles, **not IPA/APK binaries**. React Native component tests use mocked native modules and do not establish device correctness. Browser screenshot tests are explicitly named browser-rendered previews.

See [ACCEPTANCE.md](ACCEPTANCE.md) for verified results and outstanding gates.

## Structure

- `src/app/`: Expo Router native tabs and inquiry stack
- `src/components/ui.tsx`: consistent scalable text, labels, states, cards and controls
- `src/state/AppState.tsx`: in-memory sample workspace and preserved drafts
- `src/domain/`: exact inquiry contract, versioned writes, access guards and safe projection
- `src/data/`: fictional fixtures and a disabled native auth adapter
- `tests/domain.test.ts`: workflow/security/data tests
- `tests/screens.test.tsx`: actual React Native screen interactions under Jest
- `tests/browser/`: prepared phone-viewport browser QA and screenshots

## Data and authentication boundary

Inquiry DTO fields match the reviewed customer portal: id, customerName, contact, subject, summary, source, receivedAt, updatedAt, status, assigneeId, version and notes. All priority/service/time/location/estimated-value extras are isolated under `DemoRecord.context.demoOnly`; they are not assumed server fields.

The existing Wix PKCE integration is web-only. It relies on server-bound tenant membership, HttpOnly cookies and exact-origin/session-bound protections. **No native exchange, bearer endpoint or deep-link callback is implemented or assumed.** The native adapter denies live reads/sign-in. Never spoof the web Origin, copy browser cookies, expose admin credentials, or trust client-selected tenancy.

Workflow transitions are exact: new → in_progress/closed; in_progress → waiting/closed; waiting → in_progress/closed; closed → in_progress. Successful sample writes increment versions; stale versions reject. Notes are append-only and limited to 2,000 characters. Closing an inquiry does not establish a booking or payment. Revenue and conversion remain unknown.

## Before real customers

1. Review actual screen renders and run VoiceOver/TalkBack, large-font, keyboard, back-navigation and interrupted-flow tests on real iPhone/Android devices.
2. Review and authorize native identity registration, secure token/session exchange, storage/revocation and authoritative server tenant binding.
3. Approve the business, viewer, minimal data projection and retention; establish real backend access and read-only pilot gates.
4. Add production error/retry/conflict reconciliation, privacy-safe telemetry only if approved, retention controls and secure cache policy.
5. Decide platform identifiers, signing, test distribution and store submission, with explicit account/payment/publication approval.

Official references checked: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Router installation](https://docs.expo.dev/router/installation/), [Jest testing](https://docs.expo.dev/develop/unit-testing/).
