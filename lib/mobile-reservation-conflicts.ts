import { adminDb } from "@/lib/firebase-admin"
import { canAccessMobileBooking, type MobileAuthContext } from "@/lib/mobile-booking-ownership"
import { reservationInterval, intervalsOverlap } from "@/lib/reservation-conflict-interval"
import { normalizeLicensePlate } from "@/lib/utils"

export const BOOKING_CHECK_UNAVAILABLE = "Nu putem verifica rezervarea momentan. Încearcă din nou"
export function conflictMessage(plate: string) {
  return `Ai deja o rezervare pentru ${normalizeLicensePlate(plate)} care intră în conflict cu perioada aleasă. Alege alte date sau deschide rezervarea existentă.`
}
export async function checkMobileReservationConflict(
  licensePlate: string, startDate: string, endDate: string, startTime: string, endTime: string,
  options: { auth: MobileAuthContext; paymentMethod?: string }
) {
  try {
    const plate = normalizeLicensePlate(licensePlate)
    if (!plate) throw new Error("Missing license plate")
    const incoming = reservationInterval({startDate, endDate, startTime, endTime}, options.paymentMethod !== "at_parking")
    // Include historical expired records: the Multipark interval may outlast the displayed end.
    const snapshot = await adminDb.collection("bookings").where("status", "in", [
      "confirmed_paid", "confirmed_test", "confirmed", "paid", "confirmed_pay_on_site", "expired"
    ]).get()
    for (const doc of snapshot.docs) {
      const booking = doc.data()
      if (normalizeLicensePlate(String(booking.licensePlate || "")) !== plate) continue
      const existing = reservationInterval({
        startDate: booking.startDate, startTime: booking.startTime,
        endDate: booking.endDate, endTime: booking.endTime,
        multiparkDurationMinutes: booking.multiparkDurationMinutes,
      }, Boolean(booking.apiBookingNumber) && booking.source !== "pay_on_site" && booking.source !== "test_mode")
      if (!intervalsOverlap(incoming, existing)) continue
      return { exists: true, unavailable: false, existingBooking: canAccessMobileBooking(booking, options.auth) ? {
        id: doc.id, licensePlate: plate, startDate: booking.startDate, endDate: booking.endDate,
        startTime: booking.startTime, endTime: booking.endTime, status: booking.status,
        apiBookingNumber: booking.apiBookingNumber || null,
      } : undefined }
    }
    return { exists: false, unavailable: false, existingBooking: undefined }
  } catch (error) {
    console.error("[mobile-reservation-conflict] Verification failed", error)
    return { exists: false, unavailable: true, existingBooking: undefined }
  }
}
