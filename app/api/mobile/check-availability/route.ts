import { checkAvailability, checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { validateMobileBookingWindow } from "@/lib/mobile-booking-window"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const { licensePlate, startDate, startTime, endDate, endTime } = body || {}

    if (!startDate || !startTime || !endDate || !endTime) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Missing required fields: startDate, startTime, endDate, endTime",
        },
        400
      )
    }

    const windowValidation = validateMobileBookingWindow({
      startDate: String(startDate),
      startTime: String(startTime),
      endDate: String(endDate),
      endTime: String(endTime),
    })

    if (!windowValidation.ok) {
      return mobileJsonResponse({
        success: true,
        available: false,
        error: windowValidation.code,
        message: windowValidation.message,
        conflictingBookings: 0,
        totalSpots: 0,
        maxBookingsInPeriod: 0,
      })
    }

    const result = await checkAvailability(
      String(startDate),
      String(startTime),
      String(endDate),
      String(endTime)
    )

    if (licensePlate) {
      const duplicateCheck = await checkExistingReservationByLicensePlate(
        String(licensePlate),
        String(startDate),
        String(endDate),
        String(startTime),
        String(endTime)
      )

      if (duplicateCheck.exists) {
        return mobileJsonResponse({
          success: true,
          ...result,
          available: false,
          duplicateReservation: true,
          existingBooking: duplicateCheck.existingBooking,
          error: "DUPLICATE_LICENSE_PLATE_PERIOD",
          message: "Există deja o rezervare activă pentru acest număr de înmatriculare în perioada selectată.",
        })
      }
    }

    return mobileJsonResponse({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
