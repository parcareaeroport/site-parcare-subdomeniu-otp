import { buildSignedQrUrl } from "@/lib/qr-link"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { getDoc, doc, db } from "@/lib/server-firestore"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(
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

    const data = snap.data() || {}
    const isOwner =
      data.userId === auth.user.uid ||
      (auth.user.email && data.clientEmail === auth.user.email)

    if (!isOwner) {
      return mobileJsonResponse({ success: false, error: "Forbidden" }, 403)
    }

    const apiBookingNumber = data.apiBookingNumber
      ? String(data.apiBookingNumber)
      : undefined

    return mobileJsonResponse({
      success: true,
      booking: {
        id: snap.id,
        ...data,
        qrUrl: apiBookingNumber ? buildSignedQrUrl(apiBookingNumber) : undefined,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
