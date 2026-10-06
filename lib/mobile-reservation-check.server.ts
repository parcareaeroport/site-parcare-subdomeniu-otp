import "server-only"

import { adminDb } from "@/lib/firebase-admin"
import type { MobileAuthContext } from "@/lib/mobile-booking-ownership"
import { CONFLICT_STATUSES, RESERVATION_CHECK_FIELDS, findMobileReservationConflict } from "@/lib/mobile-reservation-conflicts"
import { calculateReservationAvailability } from "@/lib/reservation-availability-calculation"

export type ReservationCheckMetrics = { readMs: number; calculationMs: number; documents: number }

export async function checkMobileReservation(
  input: { licensePlate?: string; startDate: string; startTime: string; endDate: string; endTime: string; paymentMethod?: string },
  auth: MobileAuthContext,
  metrics: ReservationCheckMetrics
) {
  const readStarted = performance.now()
  let snapshots
  try {
    snapshots = await Promise.all([
      adminDb.collection("config").doc("reservationSettings").get(),
      adminDb.collection("bookings").where("status", "in", [...CONFLICT_STATUSES, "unmatched_lpr"])
        .select(...RESERVATION_CHECK_FIELDS).get(),
    ])
  } finally {
    metrics.readMs = performance.now() - readStarted
  }
  const [settings, bookings] = snapshots
  metrics.documents = bookings.size
  const calculationStarted = performance.now()
  try {
    const rows = bookings.docs.map(doc => ({ id: doc.id, booking: doc.data() }))
    // Match the existing default for an absent configuration or an unset/zero limit.
    const limit = settings.data()?.maxTotalReservations || 100
    const availability = calculateReservationAvailability(rows,
      input.startDate, input.startTime, input.endDate, input.endTime, limit)
    const conflict = input.licensePlate ? findMobileReservationConflict(rows,
      input.licensePlate, input.startDate, input.endDate, input.startTime, input.endTime,
      { auth, paymentMethod: input.paymentMethod }) : { exists: false, unavailable: false, existingBooking: undefined }
    return { availability, conflict }
  } finally {
    metrics.calculationMs = performance.now() - calculationStarted
  }
}
