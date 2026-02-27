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
