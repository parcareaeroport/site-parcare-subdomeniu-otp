import "server-only"

import { adminDb } from "@/lib/firebase-admin"
import { CONFLICT_STATUSES, RESERVATION_CHECK_FIELDS } from "@/lib/mobile-reservation-conflicts"

/** One fresh, projected read per collection; admin also needs excluded statuses for explanations. */
export async function readReservationCheckSnapshot(includeExcludedStatuses = false) {
  const bookings = adminDb.collection("bookings")
  const query = includeExcludedStatuses ? bookings : bookings.where("status", "in", [...CONFLICT_STATUSES, "unmatched_lpr"])
  const [settings, snapshot] = await Promise.all([
    adminDb.collection("config").doc("reservationSettings").get(),
    query.select(...RESERVATION_CHECK_FIELDS).get(),
  ])
  return {
    rows: snapshot.docs.map(doc => ({ id: doc.id, booking: doc.data() })),
    limit: settings.data()?.maxTotalReservations || 100,
    now: Date.now(),
  }
}
