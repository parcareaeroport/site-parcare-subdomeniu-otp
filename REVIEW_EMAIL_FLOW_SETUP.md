# Review Email Flow Setup

This document covers the delayed review email flow for bookings created via
`/api/wp-card-booking` and `/api/wp-booking` (pay on site).

## What it does

- Marks eligible bookings:
  - `bookingOrigin: "wp-card-booking"` with `paymentStatus: "paid"`
  - `source: "pay_on_site"` with `status: "confirmed_pay_on_site"`
- On booking create, a Firebase Function marks the task as `awaiting_entry`.
- The first automatic LPR `entry` event schedules the review email for
  `lpr.arrivedAt + 1h`. Manual admin events do not schedule review emails.
- A scheduled Firebase Function processes due tasks every 5 minutes.
- Repeated entry events are idempotent and cannot schedule a second email.
- A normalized email address can receive the review request only once across
  all bookings. Later tasks are marked `skipped_repeat`.
- Legacy pending tasks are never sent. The processor marks them
  `skipped_legacy`; only tasks carrying the new LPR event marker are trusted.
- Before sending is enabled, completed historical tasks are migrated in
  batches to `review_email_recipients`, keyed by a SHA-256 email hash.
- The email contains only the Google Reviews link.
- Legacy `/recenzie` links are redirected to Google Reviews.

## Required environment variables

### Firebase Functions

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `REVIEW_EMAIL_FROM` (optional; fallback is `GMAIL_USER`)
- `REVIEW_LINK_SECRET` (required for manual test endpoint)

## Firestore collections used

- `bookings` (audit fields)
- `review_email_tasks` (scheduler queue)
- `review_email_recipients` (permanent one-request-per-email registry)
- `review_email_system/recipient_deduplication` (migration state)

## Booking audit fields added

- `bookingOrigin`
- `reviewEmailStatus`
- `reviewEmailEntryAt`
- `reviewEmailScheduledAt`
- `reviewEmailScheduleMode`
- `reviewEmailSentAt`
- `reviewEmailTaskId`
- `reviewEmailLastError`

## Basic manual validation

1. Create a booking through `wp-card-booking` or `wp-booking` (pay on site).
2. Check booking doc is eligible and the review task is `awaiting_entry`.
3. Record an automatic LPR entry and check the task becomes `pending`.
4. Verify `lprEntryAt` matches the first real entry and `scheduledFor` equals
   `lprEntryAt + 1h` with schedule mode `lpr_entry_plus_1h`.
5. Confirm a manual entry and repeated automatic entries do not reschedule it.
6. Run the scheduler and confirm the email is sent after `scheduledFor`
   (within the five-minute processing interval).
7. Confirm the email contains only the Google Reviews link.
8. Create another eligible booking with the same email and confirm its task is
   marked `skipped_repeat` without another email being sent.

## Test manual din terminal

Deploy the test function once:

```bash
cd next-js
firebase deploy --only functions:testReviewEmail
```

Send a test review email (same SMTP path as production):

```bash
curl "https://europe-west1-parcare-aeroport-ebe28.cloudfunctions.net/testReviewEmail?secret=YOUR_REVIEW_LINK_SECRET&email=you@example.com"
```

Optional name parameter:

```bash
curl "https://europe-west1-parcare-aeroport-ebe28.cloudfunctions.net/testReviewEmail?secret=YOUR_REVIEW_LINK_SECRET&email=you@example.com&name=Ion"
```

From `functions/` with env loaded from `.env`:

```bash
cd next-js/functions
export $(grep -v '^#' .env | xargs)
npm run test-review-email -- you@example.com
```

Responses:

- `200` + `{ "ok": true, "to": "...", "messageId": "..." }` — sent
- `401` — wrong or missing `secret`
- `400` — missing or invalid `email`
- `500` + `{ "ok": false, "error": "..." }` — SMTP failure (e.g. invalid Gmail app password)
