# LPR association correction — local verification

Implemented locally on 25 October 2026. Not deployed. No production Firestore documents, payments, emails or camera commands were changed.

## Behavior

- Entry requires an eligible reservation for the normalized plate within its scheduled window, including the existing two-hour tolerance. A reservation from months ago is no longer selected just because it is the only match for the plate.
- Each camera-opened visit has a `lpr.visitId`. The server stores its booking/visit reference in `lpr_plate_state/{normalizedPlate}`. Exit uses that open visit, even when overdue. Existing unique open visits can be adopted without a historical migration.
- Multiple open rows, overlapping eligible reservations, conflicts between an open visit and another reservation, and unlinked old open rows outside their period are recorded for review. No arbitrary booking or occupancy update is made.
- No suitable reservation on entry creates an `unmatched_lpr` visit, with its own arrival and exit history. Exit without an open visit is recorded for review.
- Raw receipts remain in `lpr_events`. `associationStatus`, `associationReason`, and, where relevant, `candidateBookingIds` explain the result. A review dashboard was not added; these are audit fields.
- Camera updates to booking, plate pointer, gate audit and occupancy counter share a Firestore transaction. Manual events also update their booking, audit and counter atomically. Repeated and out-of-order notifications cannot repeatedly increment or decrement occupancy.
- A fresh reentry creates a new visit and clears the previous departure on that booking. The raw and gate event history remains available.
- “Ieșiri” and “Ieșiri întârziate” now use the same effective presence as Occupancy. A historical departure before a subsequent entry no longer hides a currently present vehicle. A last exit event is not treated as an active stay just because the boolean remained true.
- Camera timestamps without a timezone retain the existing deployed UTC-labelled convention, now independent of the host timezone. Explicit offsets are honored. This does not migrate historical timestamps or assert that camera clocks are configured correctly.

## Reproducible verification

Requires Node dependencies, Firebase CLI, Java 17+, and Chrome. The browser harness uses Playwright installed in the sibling `expo-mobile-app` project.

Start the isolated emulator from `next-js`:

```sh
FIREBASE_EMULATORS_PATH=/tmp/parking-lpr-emulator/cache firebase emulators:start --only firestore --project demo-parking-lpr --config scripts/fixtures/lpr-emulator/firebase.json
```

Then run these sequentially (each emulator script resets only the synthetic `demo-parking-lpr` database):

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-association-emulator.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-browser-emulator.cjs
node scripts/test-occupancy-lpr-display.cjs
node scripts/test-mobile-booking-persons.cjs
npx tsc --noEmit --pretty false
```

Both emulator scripts refuse non-local hosts. They initialize a demo project explicitly, never load production credentials, and create synthetic reservation documents. They do not exercise paid checkout or the parking provider's reservation-creation API. Emulator rules allow test access; production authentication/rules are not claimed as verified.

### Results

- 24 integration scenarios passed with the real Firestore Admin and browser SDKs against the emulator: camera endpoint, correct July association while the old May reservation remains unchanged, unmatched visits, overdue exits, concurrent duplicate arrivals/departures, replayed events, same-reservation reentry, ambiguous reservations, multiple old inside rows, legacy visit adoption, reservation/open-visit conflicts, manual/camera combinations and concurrent exits, whitelist, normalized plates, invalid timestamps/directions, two-hour/day-boundary behavior, timezone independence, transaction rollback, simultaneous different plates, and concurrent unmatched arrivals.
- Browser test passed on actual Next pages: prior-day and same-day late exits; exclude already-exited and inconsistent last-exit records; desktop and 390px mobile; save a manual exit through the dialog; verify Firestore and counter; verify disappearance from the occupancy page. No runtime errors or external production Firebase requests.
- 22 existing occupancy diagnostic/display checks passed (includes print formatting data and Bucharest timestamps).
- 6 existing mobile booking person-count checks passed.
- Typecheck still reports the pre-existing missing Jest globals in two test files and Stripe `payment_method_types` errors in two payment files. No diagnostics in the changed files. `git diff --check` passed.

## Before production rollout

1. Confirm deployment Firestore indexes/permissions support the existing queries and atomic manual writes. The new plate-state collection is server-written through Admin SDK; no browser permission for it is required.
2. Run a controlled real-camera entry/exit against a dedicated reservation after deployment approval: plate, direction, timestamp/timezone, retransmission behavior, and exit after the scheduled end. Confirm device clock conventions before changing timezone semantics.
3. Assess transaction latency/read volume using production-sized data. Legacy compatibility still scans active reservations and open rows to normalize older plates; this was not a production load test.
4. Review affected historical rows individually against operator evidence. This change does not automatically close or reassign old visits; ambiguous cases remain for review. Do not mark a car departed solely because its planned end date passed.
5. Confirm normal reservation creation/checkout and any external Firebase Functions in staging. The tests seeded synthetic bookings and exercised the LPR/admin flow; they did not charge cards, send emails or invoke production parking hardware.

The separate maximum-simultaneous-occupancy availability algorithm is unchanged by this work.
