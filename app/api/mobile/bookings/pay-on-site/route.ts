import { verifyMobileUser } from "@/lib/mobile-api-auth"
import {
  createMobilePayOnSiteBooking,
  validateMobileBookingPayload,
} from "@/lib/mobile-booking-mapper"
import { applyLoyaltyPricingToMobilePayload } from "@/lib/mobile-loyalty-pricing"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { validateMobileBookingWindow } from "@/lib/mobile-booking-window"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const validated = validateMobileBookingPayload(body)
    if (!validated.ok) {
      return mobileJsonResponse({ success: false, error: validated.error }, 400)
    }

    let payload = validated.data
    const windowValidation = validateMobileBookingWindow({
      startDate: payload.startDate,
      startTime: payload.startTime,
      endDate: payload.endDate,
      endTime: payload.endTime,
    })

    if (!windowValidation.ok) {
      return mobileJsonResponse(
        {
          success: false,
          error: windowValidation.message,
          code: windowValidation.code,
        },
        400
      )
    }

    const duplicateCheck = await checkExistingReservationByLicensePlate(
      payload.licensePlate,
      payload.startDate,
      payload.endDate,
      payload.startTime,
      payload.endTime
    )

    if (duplicateCheck.exists) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Există deja o rezervare activă pentru acest număr de înmatriculare în perioada selectată.",
          code: "DUPLICATE_LICENSE_PLATE_PERIOD",
          duplicateReservation: true,
          existingBooking: duplicateCheck.existingBooking,
        },
        409
      )
    }

    if (auth.user.email && !payload.email) {
      payload.email = auth.user.email
    }

    const profileCol = auth.user.isGuest ? ("guests" as const) : ("users" as const)
    const loyaltyPricing = await applyLoyaltyPricingToMobilePayload(
      payload,
      auth.user.uid,
      profileCol,
      "at_parking"
    )
    payload = loyaltyPricing.payload

    const result = await createMobilePayOnSiteBooking(payload, {
      userId: auth.user.uid,
      isGuest: auth.user.isGuest,
      loyaltyFreeDayApplied: loyaltyPricing.applied,
    })

    return mobileJsonResponse(result, result.success ? 200 : 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
