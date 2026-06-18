import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { sendCancellationRequestEmail } from "@/lib/cancellation-email"
import { getMobileUserProfile } from "@/lib/mobile-user-service"
import { getDoc, doc, db } from "@/lib/server-firestore"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

function formatReservationPeriod(booking: Record<string, unknown>) {
  const startDate = booking.startDate || ""
  const endDate = booking.endDate || ""
  const startTime = booking.startTime || ""
  const endTime = booking.endTime || ""
  return `${startDate} ${startTime} – ${endDate} ${endTime}`.trim()
}

function isBookingOwner(
  booking: Record<string, unknown>,
  uid: string,
  email: string | null | undefined
) {
  if (booking.userId === uid) return true
  if (
    email &&
    booking.clientEmail === email &&
    (booking.bookingOrigin === "mobile-app" || booking.userId === uid)
  ) {
    return true
  }
  return false
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    const snap = await getDoc(doc(db, "bookings", id))

    if (!snap.exists()) {
      return mobileJsonResponse({ success: false, error: "Booking not found" }, 404)
    }

    const booking = snap.data() || {}

    if (!isBookingOwner(booking, auth.user.uid, auth.user.email)) {
      return mobileJsonResponse({ success: false, error: "Forbidden" }, 403)
    }

    const profile = await getMobileUserProfile(auth.user.uid)
    const firstName = profile?.firstName || "Client"
    const lastName = profile?.lastName || "OTP Parking"
    const phone = profile?.phone || "—"
    const email = auth.user.email || profile?.email || ""
    const bookingNumber = String(
      booking.apiBookingNumber || booking.bookingNumber || snap.id
    )
    const licensePlate = String(booking.licensePlate || "—")

    if (!email) {
      return mobileJsonResponse(
        { success: false, error: "Email utilizator lipsă" },
        400
      )
    }

    const result = await sendCancellationRequestEmail({
      firstName,
      lastName,
      phone,
      email,
      bookingNumber,
      licensePlate,
      reservationPeriod: formatReservationPeriod(booking),
    })

    return mobileJsonResponse({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const status = message.includes("obligatorii") ? 400 : 500
    return mobileJsonResponse({ success: false, error: message }, status)
  }
}
