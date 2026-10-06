import { adminDb } from "@/lib/firebase-admin"
import { canAccessMobileBooking, type MobileAuthContext } from "@/lib/mobile-booking-ownership"
import { reservationInterval, intervalsOverlap } from "@/lib/reservation-conflict-interval"
import { normalizeLicensePlate } from "@/lib/utils"
import type { ReservationCheckRow } from "@/lib/reservation-availability-calculation"

export const CONFLICT_STATUSES = [
  "confirmed_paid", "confirmed_test", "confirmed", "paid", "confirmed_pay_on_site", "expired"
]
export const RESERVATION_CHECK_FIELDS = [
  "licensePlate", "status", "startDate", "startTime", "endDate", "endTime",
  "multiparkDurationMinutes", "source", "apiBookingNumber", "clientEmail",
  "lpr.isInside", "lpr.arrivedAt", "lpr.departedAt", "lpr.lastSeenAt", "lpr.lastEventType",
]

export const BOOKING_CHECK_UNAVAILABLE = "Nu putem verifica rezervarea momentan. Încearcă din nou"
export function conflictMessage(plate: string) {
  return `Ai deja o rezervare pentru ${normalizeLicensePlate(plate)} care intră în conflict cu perioada aleasă. Alege alte date sau deschide rezervarea existentă.`
}
export function findMobileReservationConflict(
  rows: ReservationCheckRow[],
  licensePlate: string, startDate: string, endDate: string, startTime: string, endTime: string,
  options: { auth: MobileAuthContext; paymentMethod?: string }
) {
  const plate = normalizeLicensePlate(licensePlate)
  if (!plate) throw new Error("Missing license plate")
  const incoming = reservationInterval({startDate, endDate, startTime, endTime}, options.paymentMethod !== "at_parking")
  // Include historical expired records: the Multipark interval may outlast the displayed end.
  for (const { id, booking } of rows) {
    if (!CONFLICT_STATUSES.includes(booking.status)) continue
    if (normalizeLicensePlate(String(booking.licensePlate || "")) !== plate) continue
    const existing = reservationInterval({
      startDate: booking.startDate, startTime: booking.startTime,
      endDate: booking.endDate, endTime: booking.endTime,
      multiparkDurationMinutes: booking.multiparkDurationMinutes,
    }, Boolean(booking.apiBookingNumber) && booking.source !== "pay_on_site" && booking.source !== "test_mode")
    if (!intervalsOverlap(incoming, existing)) continue
    return { exists: true, unavailable: false, existingBooking: canAccessMobileBooking(booking, options.auth) ? {
      id, licensePlate: plate, startDate: booking.startDate, endDate: booking.endDate,
      startTime: booking.startTime, endTime: booking.endTime, status: booking.status,
      apiBookingNumber: booking.apiBookingNumber || null,
    } : undefined }
  }
  return { exists: false, unavailable: false, existingBooking: undefined }
}

/** Standalone guard for payment/session creation; always reads fresh server data. */
export async function checkMobileReservationConflict(
  licensePlate: string, startDate: string, endDate: string, startTime: string, endTime: string,
  options: { auth: MobileAuthContext; paymentMethod?: string; authenticationMs?: number }
) {
  const started = performance.now()
  let readMs = 0
  let count = 0
  let result = "unavailable"
  let errorCode: string | number | undefined
  try {
    const snapshot = await adminDb.collection("bookings")
      .where("status", "in", CONFLICT_STATUSES).select(...RESERVATION_CHECK_FIELDS).get()
    readMs = performance.now() - started
    count = snapshot.size
    const conflict = findMobileReservationConflict(
      snapshot.docs.map(doc => ({ id: doc.id, booking: doc.data() })),
      licensePlate, startDate, endDate, startTime, endTime, options
    )
    result = conflict.exists ? "conflict" : "clear"
    return conflict
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    errorCode = typeof code === "string" || typeof code === "number" ? code : undefined
    if (!readMs) readMs = performance.now() - started
    return { exists: false, unavailable: true, existingBooking: undefined }
  } finally {
    const totalMs = performance.now() - started
    console.info("[mobile-reservation-conflict] summary", {
      readMs: Math.round(readMs), calculationMs: Math.round(totalMs - readMs),
      totalMs: Math.round(totalMs), authenticationMs: Math.round(options.authenticationMs || 0),
      documents: count, result, errorCode,
    })
  }
}
