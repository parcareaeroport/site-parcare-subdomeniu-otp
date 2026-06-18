import { checkAvailability } from "@/lib/booking-utils"
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

    if (!startDate || !startTime || !endDate || !endTime) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Missing required fields: startDate, startTime, endDate, endTime",
        },
        400
      )
    }

    const result = await checkAvailability(
      String(startDate),
      String(startTime),
      String(endDate),
      String(endTime)
    )

    return mobileJsonResponse({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
