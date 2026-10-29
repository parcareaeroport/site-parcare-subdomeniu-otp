# Parking-full banner aligned with forecast — 29 October 2026

Local implementation only; no deployment or production data changes.

## Behavior

- `GET /api/admin/parking-full-summary` uses the same `readReservationCheckSnapshot(true)` and `calculateOccupancyForecast` as the forecast page. Every daily result shares the snapshot's capacity and calculation time. Only `from`, `to`, `calculatedAt` and the dates with `available === false` are returned. No booking details are exposed.
- The 30-day inclusive window starts tomorrow using the Europe/Bucharest calendar date. Daily availability semantics remain exactly those of the existing forecast; no timezone or reservation-rule migration is included.
- Real API authorization permits admin, employee and entriesOperator. All responses use `Cache-Control: no-store`; calculation failures return 503 instead of an empty success result.
- The banner mounts inside the authenticated admin layout, below AuthProvider. Public pages and login do not fetch it. It refreshes every five minutes, shows up to five dates and the remaining count, and links to forecast only for admin/employee.
- Errors replace the result with an explicit unavailable warning. Unmount/logout aborts requests and clears the timer; cancelled or superseded requests cannot update the UI. Results are scoped to the current user and role.
- Different reads can legitimately differ when bookings or the calculation time change between requests.

## Verification

- `TZ=UTC node --test scripts/test-parking-full-summary.cjs scripts/test-occupancy-forecast.cjs`: 39 passed.
- Same command under `TZ=Europe/Bucharest`: 39 passed.
- Summary tests cover exact parity, capacity reached/exceeded, delayed/unmatched vehicles, excluded statuses, touching intervals, Romania midnight, month/year boundaries, 30-day windows, real authorization with token verification stubbed, missing/invalid tokens, minimal payload and server failure.
- `node scripts/test-parking-full-banner-browser.cjs`: passed with actual component, API, authorization, snapshot loader and calculation; in-memory auth/Firestore fixtures. Desktop 1440px and mobile 390px, roles/link visibility, five-minute update, empty-result hiding, failure/recovery, logout during pending request, no login/public requests and no browser runtime errors or external Firebase requests.
- `node scripts/test-occupancy-forecast-browser.cjs`: existing desktop/mobile forecast suite passed.
- `tsc --noEmit --incremental false`: same 34 baseline Jest/Stripe diagnostics as the earlier verification, compared byte-for-byte with `/tmp/manual-exit-roles-tsc.log`; no new errors.
- React review: server-only calculation dependencies are not imported at runtime by the client banner; effects clean up timers/requests; result ownership prevents account-switch leakage; status/error messages use accessible roles. `git diff --check` passed.

Logs: `/tmp/banner-unit-utc.log`, `/tmp/banner-unit-ro.log`, `/tmp/banner-browser.log`, `/tmp/banner-forecast-browser.log`, `/tmp/banner-tsc.log`.
Screenshots: `/tmp/banner-desktop.png`, `/tmp/banner-mobile.png` (isolated UI harness, not production layout/account verification).
