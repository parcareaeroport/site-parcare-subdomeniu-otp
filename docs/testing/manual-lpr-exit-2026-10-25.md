# Protected manual LPR exit — 25 October 2026

Implemented locally; not deployed. No production Firestore data, camera commands or historical bookings were changed.

## Behavior and interface

All supported manual exits from Entries/Exits, Bookings and Occupancy use the same `ManualLprExitDialog` and authenticated `POST /api/admin/manual-lpr-exit` route (originally admin-only; see the 29 October access update below).

- `action: prepare`, `bookingId`: returns a sanitized booking, current arrival/departure/presence, Romania server clock, open duplicate rows and an optimistic context version.
- `action: save`: requires bookingId, version, requestId, either date/time or useServerNow, and explicit confirmations where applicable. Actor identity comes from the verified token, never from the request body.
- Context version covers the selected Firestore document update version, all normalized-plate open documents and the plate pointer. The transaction rereads them; a changed context returns 409/CONTEXT_CHANGED with no mutation. Legacy rows without visitId are covered by document versions and LPR values.
- Valid calendar/time input is required, with second precision. Reject a future civil time or an exit before the current visit's arrival. Camera arrival milliseconds are compared at second precision, matching the input.
- Missing/invalid arrival requires explicit confirmation; another present document for the normalized plate requires explicit selection confirmation; correcting an existing closed departure requires overwrite confirmation. These decisions and reviewed document IDs are audited.
- Raw receipt, booking, gate audit, matching pointer and occupancy counter update atomically. Request ID + canonical request identity prevents retry double writes; a different stale save fails with a context conflict. Closing one duplicate never closes the other documents.
- New exits start with blank actual-departure fields. Scheduled exit and actual arrival are shown separately. “A plecat acum” uses the server clock at save time. Failed saves retain form values; context reload resets confirmations.

## Clock compatibility

Manual input represents Europe/Bucharest civil time, independent of the browser/host timezone. Existing camera-local-clock-with-Z storage is retained for new manual exits; timestamps are not migrated. The server compares future times using the same convention, not the host timezone. Legacy timestamps cannot distinguish the two occurrences of the repeated daylight-saving hour; no automatic disambiguation is claimed.

Manual entries retain the existing client flow. The historical SDK helper still exists for those entries; the three pages no longer call its exit branch.

## Local verification

Start the isolated demo emulator:

```sh
FIREBASE_EMULATORS_PATH=/tmp/parking-lpr-emulator/cache firebase emulators:start --only firestore --project demo-parking-lpr --config scripts/fixtures/lpr-emulator/firebase.json
```

Run the emulator suites sequentially; each resets only the local synthetic demo database:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-manual-lpr-exit-emulator.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-manual-lpr-exit-browser.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-association-emulator.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-browser-emulator.cjs
```

Results:

- 24 protected manual-exit scenarios: normal exit and pointer/audit, chronology/future/calendar validation, invalid/missing arrival, stale visit and legacy state, normalized duplicates appearing/disappearing, retries and concurrent saves, departure correction, reopened legacy arrival, Romania clock/DST/host timezones, route authorization and verified actor, rollback, real camera/manual race, replay and next reservation.
- Existing 24 camera/LPR integration scenarios passed.
- Actual Next pages in browser: all three exit entrypoints; desktop/mobile; duplicate selection, empty default fields, before-entry/future errors, changed-context reload and reset confirmations, missing-arrival confirmation, foreign browser timezone, historical departure correction without a second decrement, temporary save error/retry. Real server route and Firestore emulator are used; auth and unrelated server actions are fixture stubs. No external production Firebase traffic or runtime errors.
- Existing display/review checks (22 + 10) and 27 forecast tests passed. Typecheck retains known baseline Jest-global/Stripe errors; no changed-file diagnostics. Diff whitespace check passed.

Evidence logs are `/tmp/manual-exit-new-tests.log`, `/tmp/manual-exit-all-pages-browser.log`, `/tmp/manual-exit-camera-regression.log`, `/tmp/manual-exit-implementation-tsc.log`. Screenshot: `/tmp/protected-manual-exit-mobile.png`.

## Remaining production checks

After a separately approved deployment: verify real admin/employee access, one dedicated controlled manual exit with the production pages, and its agreement with the real camera clock/payload convention. Emulator authentication is stubbed and rules are permissive; it is not proof of production auth behavior or production-size transaction latency. Existing inconsistent historical rows still need operator reconciliation. This change does not infer missed physical camera events or prevent duplicates created through manual entry.

## Employee access update — 29 October 2026

The existing endpoint now permits `admin`, `employee` and `entriesOperator` for both `prepare` and `save`. Page permissions, other actions, token verification, role normalization, payloads and transaction protections are unchanged. In particular, employee accounts created by the user-management route use `entriesOperator`.

Verification:

- 27 protected manual-exit scenarios passed against the local demo Firestore emulator. The route tests now use the actual authorization helper, stubbing only token verification. All three roles can prepare/save; missing and invalid tokens are rejected for both actions without writes. Audit identity comes from the verified actor despite forged body fields, and retries produce one event and one occupancy decrement.
- Browser suite passed on all three existing admin entrypoints. Additional `entriesOperator` journeys passed on desktop (1440px) and mobile (390px) through Entries/Exits, including the actual mobile navigation, dialog preparation, save, audit identity and occupancy. Browser auth context and token verification are fixtures; the API authorization helper is real. No production Firebase requests or browser runtime errors occurred.
- All 24 existing camera/LPR association emulator scenarios passed (`/tmp/manual-exit-roles-camera.log`).
- TypeScript diagnostics compared with the original route from HEAD: identical 34 existing Jest-global and Stripe errors; no new diagnostics. `git diff --check` passed.

Evidence: `/tmp/manual-exit-roles-emulator.log`, `/tmp/manual-exit-roles-browser.log`, `/tmp/manual-exit-roles-tsc.log`; screenshots `/tmp/manual-exit-operator-1440.png` and `/tmp/manual-exit-operator-390.png`.

Local change only. No deployment, account-role mutation or production booking mutation was performed. Real account verification remains a post-deployment check.
