import { resolveMobileBookingQuote } from "@/lib/booking-pricing"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const { startDate, startTime, endDate, endTime } = body || {}

    if (!startDate || !endDate) {
      return mobileJsonResponse({ success: false, error: "startDate and endDate are required" }, 400)
    }

    const quote = await resolveMobileBookingQuote({
      startDate: String(startDate),
      startTime: startTime ? String(startTime) : "00:00",
      endDate: String(endDate),
      endTime: endTime ? String(endTime) : "00:00",
    })

    return mobileJsonResponse({
      success: true,
      ...quote,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
