# First mobile slice: acceptance record

This is a fictional, sample-only React Native application. It has no live transport, production credentials, customer data or installable native binary.

## Implemented and checked

- Four Expo Router tabs and an inquiry-detail stack
- Compact actionable inquiry queue, unassigned-first next action, search and filters
- Exact workflow transitions, version-aware assignment and append-only notes
- Preserved in-session note drafts, reset, read-only and offline behavior
- Loading, empty, error, expired-session and larger-text previews
- Scalable text, labeled controls, priority/source/age in inquiry accessibility labels, and an inset-aware 48-point tab touch row
- Clear separation of fictional opportunity estimates from unavailable booking/payment outcomes
- Default-deny native sign-in and disabled outbound actions

## Source verification

The latest local source check passed TypeScript, lint, 27 domain/layout tests and 14 React Native component tests. The component suite uses mocked native modules and does not establish device correctness. Expo Doctor passed 21/21 checks after dependency and app-configuration validation.

Both iOS and Android Hermes JavaScript exports succeeded, as did the production browser export. These are JavaScript bundles, **not IPA/APK files**.

## Browser-rendered review

[Draft PR #109](https://github.com/allenrandy74-dev/Bookedradar-platform-/pull/109) contains the isolated source and bounded review workflow. At commit `c61f8f59f43bd21dffac8346c78d20fd039ecec6`, the [browser QA run](https://github.com/allenrandy74-dev/Bookedradar-platform-/actions/runs/38482784897) passed all four scenarios across 390px and 360px phone-width viewports:

- Priority navigation, status change, owner assignment, local note save and Results
- Search, empty results, larger-text toggle, page-width overflow and disabled live sign-in

Actual screenshot pixels of Today, inquiry details, Results and larger text were inspected. That review improved the Today layout and revealed a screenshot captured during drawer dismissal. The follow-up test explicitly waits for dismissal before continuing and scrolls the saved note into view before capture. Follow-up code also removes unsupported inherited fixture claims and preserves the native bottom safe area. Consult the exact current-head PR check for the final follow-up run status.

Local Chromium could not start because this executor denies the socket it requires; the approved GitHub runner supplied the actual browser environment. Browser-rendered React Native screens are **not native-device screenshots**.

## Remaining release gates

- Real iPhone and Android device/simulator testing, especially safe areas, keyboard interaction, back navigation, interruptions, VoiceOver/TalkBack and OS text scaling
- A reviewed native authentication/session exchange and authoritative server tenant binding
- Separately approved business data, source projection, retention and customer access
- Native platform identifiers, signing, test distribution and store approval

The draft remains isolated from main and the live lab. No merge, deployment, store submission, live data connection, account creation or payment has occurred. The workflow uses one standard `ubuntu-24.04` job, a ten-minute timeout, no deployment credentials and three-day screenshot retention. [GitHub's standard public-runner policy](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) applies; no larger or paid runners are used.
