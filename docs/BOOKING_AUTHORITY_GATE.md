# Automatic booking is gated, not delivered

The phase-two safety change deliberately disables direct Google Calendar and
booking-webhook creation. Their `supportsLiveBooking` capability is false.
`createBooking` returns `confirmed: false`, no booking ID, and
`booking_authority_unavailable`; it performs no provider operation. Supplying
credentials, a local attempt map, an alleged authority object, a scheduling
agreement, or a different process does not unlock writes. No deployment or
customer configuration is changed by this code change.

This is a removed unsafe capability, not a durable booking implementation. Existing
confirm-only intake remains the operating path. Read-only availability may be
queried but is advisory, never a reservation. A webhook must implement its declared
`find_availability` contract without writes; BookedRadar cannot guarantee behavior
inside an arbitrary remote endpoint. It no longer sends `create_booking` actions.

Live-booking configurations now fail readiness/self-check even with complete
calendar credentials. The voice instructions collect the preferred window through
normal intake and require team confirmation. A failed booking call itself does not
save a lead, queue a human task, or prove anyone was notified. Any previous unknown
provider outcome must be manually reconciled; disabling writes does not erase,
cancel, confirm, or determine the absence of those events.

## Acceptance path before re-enabling

Implement and independently verify a supported authoritative reservation and
reconciliation protocol before changing the capability flag or exposing writes:

- Resolve a canonical shared scheduling resource across tenants, credential
  changes and aliases such as Google Calendar `primary`. A tenant ID or credential
  hash alone is not shared-resource identity.
- Atomically exclude overlaps in durable storage across multiple processes and
  restarts, including partial overlaps and pending/unknown reservations.
- Assign deterministic intent identities; repeated intent submission must not
  create a second event, while different intents must still conflict by interval.
- Persist the write intent before contacting a provider, then reconcile lost,
  malformed and ambiguous responses against provider state. Never blindly retry
  an unknown insertion, expire its hold, or forget it on restart.
- Define how outside writers participate. An application database lock does not
  lock Google Calendar UI users or other integrations. If outside writers cannot
  be excluded by the actual authority, do not promise conflict-free booking.
- Verify actual authority transactions, provider reconciliation, crash/restart
  recovery and outside-writer behavior in an authorized nonproduction environment.
  Pure mocks, in-memory locks and synthetic no-write tests cannot establish that
  protocol's correctness.
- Preserve tenant feature gates and separately approved scheduling scope, confirm
  receipts conservatively, and only then authorize activation in a separate step.

The synthetic tests establish unconditional refusal across same-process adapters,
multiple processes, restarts, tenants, credential rotations and calendar aliases,
plus preserved availability/date/buffer validation. They do not claim an actual
booking succeeded or an external calendar was locked.
