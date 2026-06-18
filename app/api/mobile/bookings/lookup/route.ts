import { buildSignedQrUrl } from "@/lib/qr-link"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { queryBookingsByContact } from "@/lib/mobile-user-service"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(request.url)
    const email = (searchParams.get("email") || "").trim().toLowerCase() || null
    const phone = (searchParams.get("phone") || "").trim().replace(/\s+/g, "") || null

    if (!email && !phone) {
      return mobileJsonResponse(
        { success: false, error: "Provide at least one of: email, phone" },
        400
      )
    }

    const bookings = await queryBookingsByContact(email, phone)

    const mapped = bookings.map((b: Record<string, unknown>) => ({
      id: b.id,
      licensePlate: b.licensePlate,
      startDate: b.startDate,
      startTime: b.startTime,
      endDate: b.endDate,
      endTime: b.endTime,
      status: b.status,
      paymentStatus: b.paymentStatus,
      amount: b.amount,
      days: b.days,
      apiBookingNumber: b.apiBookingNumber,
      bookingOrigin: b.bookingOrigin,
      paymentProvider: b.paymentProvider,
      qrUrl: b.apiBookingNumber
        ? buildSignedQrUrl(String(b.apiBookingNumber))
        : undefined,
      createdAt: b.createdAt,
    }))

    return mobileJsonResponse({ success: true, bookings: mapped })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
