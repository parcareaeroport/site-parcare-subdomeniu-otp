# Review Email Flow Setup

This document covers the delayed review email flow for bookings created via
`/api/wp-card-booking` and `/api/wp-booking` (pay on site).

## What it does

- Marks eligible bookings:
  - `bookingOrigin: "wp-card-booking"` with `paymentStatus: "paid"`
  - `source: "pay_on_site"` with `status: "confirmed_pay_on_site"`
- On booking create, a Firebase Function schedules a review email task for
  `startDate + startTime + 1h`.
- A scheduled Firebase Function processes due tasks every 5 minutes.
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

## Booking audit fields added

- `bookingOrigin`
- `reviewEmailStatus`
- `reviewEmailScheduledAt`
- `reviewEmailScheduleMode`
- `reviewEmailSentAt`
- `reviewEmailTaskId`
- `reviewEmailLastError`

## Basic manual validation

1. Create a booking through `wp-card-booking` or `wp-booking` (pay on site).
2. Check booking doc is eligible for review scheduling.
3. Check `review_email_tasks/{bookingId}` exists and is `pending`.
4. Verify `scheduledFor` equals booking `startDate/startTime + 1h`.
5. Run scheduler and confirm email is sent after `scheduledFor`.
6. Confirm email contains only Google Reviews link.

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
