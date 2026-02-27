# Review Email Flow Setup

This document covers the delayed review email flow for bookings created via
`/api/wp-card-booking`.

## What it does

- Marks WP card bookings with `bookingOrigin: "wp-card-booking"`.
- On booking create, a Firebase Function schedules a review email task for `+1h`.
- A scheduled Firebase Function processes due tasks every 5 minutes.
- The email contains a direct link to `/recenzie?bookingId=<id>`.
- Review link is always accessible (no token, no open-limit validation).
- Review submit is handled by `POST /api/reviews` and saved in Firestore.

## Required environment variables

### Firebase Functions

- `GMAIL_USER`
- `GMAIL_APP_PASSWORD`
- `REVIEW_EMAIL_FROM` (optional; fallback is `GMAIL_USER`)

Note: review links are generated with the fixed site base
`https://rezervari.otp-parking.ro`.

## Firestore collections used

- `bookings` (audit fields)
- `review_email_tasks` (scheduler queue)
- `reviews` (final submitted review; doc id = booking id)

## Booking audit fields added

- `bookingOrigin`
- `reviewEmailStatus`
- `reviewEmailScheduledAt`
- `reviewEmailSentAt`
- `reviewEmailTaskId`
- `reviewEmailLastError`
- `reviewLinkConsumedAt`
- `reviewLinkUsedByEmail`
- `reviewSubmittedAt`
- `reviewRating`
- `reviewComment`

## Basic manual validation

1. Create a booking through `wp-card-booking`.
2. Check booking doc has `bookingOrigin = "wp-card-booking"`.
3. Check `review_email_tasks/{bookingId}` exists and is `pending`.
4. Temporarily reduce schedule delay for testing and run scheduler.
5. Open received link and submit review.
6. Verify `reviews/{bookingId}` exists and booking has `reviewStatus = "submitted"`.
