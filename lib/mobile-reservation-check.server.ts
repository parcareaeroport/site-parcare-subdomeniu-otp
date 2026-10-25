import "server-only"

import { readReservationCheckSnapshot } from "@/lib/reservation-check-snapshot.server"
import type { MobileAuthContext } from "@/lib/mobile-booking-ownership"
import { findMobileReservationConflict } from "@/lib/mobile-reservation-conflicts"
import { calculateReservationAvailability } from "@/lib/reservation-availability-calculation"

export type ReservationCheckMetrics = { readMs: number; calculationMs: number; documents: number }

export async function checkMobileReservation(
  input: { licensePlate?: string; startDate: string; startTime: string; endDate: string; endTime: string; paymentMethod?: string },
  auth: MobileAuthContext,
  metrics: ReservationCheckMetrics
) {
  const readStarted = performance.now()
  let snapshot
  try {
    snapshot = await readReservationCheckSnapshot()
  } finally {
    metrics.readMs = performance.now() - readStarted
  }
  metrics.documents = snapshot.rows.length
  const calculationStarted = performance.now()
  try {
    const { rows, limit, now } = snapshot
    const availability = calculateReservationAvailability(rows,
      input.startDate, input.startTime, input.endDate, input.endTime, limit, now)
    const conflict = input.licensePlate ? findMobileReservationConflict(rows,
      input.licensePlate, input.startDate, input.endDate, input.startTime, input.endTime,
      { auth, paymentMethod: input.paymentMethod }) : { exists: false, unavailable: false, existingBooking: undefined }
    return { availability, conflict }
  } finally {
    metrics.calculationMs = performance.now() - calculationStarted
  }
}
