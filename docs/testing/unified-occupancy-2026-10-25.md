# Unified current occupancy — 25 October 2026

## Changes

Current occupancy displays now count effectively present booking documents using the same `getLprPresenceState` predicate as GET `/api/admin/occupancy`. No deduplication or booking-status/period exclusion was added; the intended result is equality with that page's plate list.

- Shared client reads/subscriptions replace `parkingLive.occupiedCount` reads in current-occupancy cards, Dashboard statistics/chart and Statistics chart.
- A stale cache is never used as a fallback or combined through `Math.max(cache, rawInsideCount)`.
- Explicit table count overrides remain supported. The forecast/active-range mode is unchanged.
- Daily free-space statistics use the actual count rather than reverse-calculating a count from a rounded percentage.
- Admin `action: recalculate` rebuilds only the derived counter, transactionally against the current documents and counter. It ignores contradictory raw-inside documents without editing them. The existing response keeps `repairedStaleInside: 0`; `ignoredStaleInside` and `previousCount` explain the recalculation.

## Production data action explicitly requested by the user

Executed at 25 October 2026 17:38 Europe/Bucharest:

- Previous cached counter: 643.
- Rebuilt cached counter: 283.
- Independently verified effective document count immediately afterward: 283.
- One raw `isInside=true` document was excluded by effective-presence rules.
- No booking, LPR timestamp or gate event was written by the recalculation.

Backup/evidence: `/tmp/occupancy-counter-recalculation-2026-10-25/before.json` and `result.json`. These are time-specific values, not assertions about future occupancy or physically verified inventory.

Code changes are local, not deployed by the agent. The counter correction itself was applied to production as authorized. The cached counter may still drift due to legacy writers; deployed UI changes will make the booking/LPR evidence authoritative for the affected current-occupancy displays.

## Verification

Use the local demo emulator and run reset-based suites sequentially:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-unified-occupancy-emulator.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-unified-occupancy-browser.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-association-emulator.cjs
```

- Seven new SDK/API scenarios passed: shared predicate; cache645 ignored by API/client/Dashboard/chart; exact daily free-space count; zero/zero-capacity; no booking or history mutation during recalculation; concurrent atomic entry; realtime updates; existing admin recalculate endpoint.
- Real Next pages in browser passed for Occupancy, Dashboard and Statistics, with actual Firestore emulator and API; counts 2→1→0 while cache645 remained unchanged; desktop and 390px mobile; no runtime errors or production Firebase requests.
- Existing 24 LPR/camera integration scenarios, 22 occupancy display checks and 27 forecast scenarios passed.
- Typecheck retains pre-existing Jest-global and Stripe errors; no diagnostics in modified/new files. Diff whitespace check passed.

Logs: `/tmp/unified-occupancy-tests.log`, `/tmp/unified-occupancy-browser.log`, `/tmp/unified-occupancy-lpr-regression.log`, `/tmp/unified-occupancy-tsc.log`.

Production role/rules behavior and the new UI require a separately approved deployment and real-admin smoke check. Emulator auth is stubbed; production-size subscription cost/latency was not load-tested. Historical reconciliation and physical inventory remain separate from this count unification.
