import { getMobileBookingBlacklistRejection } from "@/lib/mobile-booking-blacklist"
import { isMobileBookingPlateBlocked, LICENSE_PLATE_NOT_ALLOWED, LICENSE_PLATE_NOT_ALLOWED_MESSAGE } from "@/lib/mobile-booking-whitelist"
import { conflictMessage, BOOKING_CHECK_UNAVAILABLE } from "@/lib/mobile-reservation-conflicts"
import { checkMobileReservation, type ReservationCheckMetrics } from "@/lib/mobile-reservation-check.server"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { validateMobileBookingWindow } from "@/lib/mobile-booking-window"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const started = performance.now()
  let authenticationMs = 0
  let outcome = "unavailable"
  let statusCode = 503
  let errorCode: string | number | undefined
  const metrics: ReservationCheckMetrics = { readMs: 0, calculationMs: 0, documents: 0 }
  const respond = (body: Record<string, unknown>, status = 200) => {
    statusCode = status
    return mobileJsonResponse(body, status)
  }

  try {
    const auth = await verifyMobileUser(request)
    authenticationMs = performance.now() - started
    if (!auth.ok) {
      outcome = "authentication_failed"
      statusCode = auth.response.status
      return auth.response
    }

    const body = await request.json()
    const { licensePlate, startDate, startTime, endDate, endTime, paymentMethod } = body || {}
    if (!startDate || !startTime || !endDate || !endTime) {
      outcome = "invalid_request"
      return respond({ success: false, error: "Missing required fields: startDate, startTime, endDate, endTime" }, 400)
    }

    const input = {
      startDate: String(startDate), startTime: String(startTime),
      endDate: String(endDate), endTime: String(endTime),
      licensePlate: licensePlate ? String(licensePlate) : undefined,
      paymentMethod: paymentMethod === undefined ? undefined : String(paymentMethod),
    }
    const windowValidation = validateMobileBookingWindow(input)
    if (!windowValidation.ok) {
      outcome = "invalid_window"
      return respond({
        success: true, available: false,
        error: windowValidation.code, message: windowValidation.message,
        conflictingBookings: 0, totalSpots: 0, maxBookingsInPeriod: 0,
      })
    }

    const blacklistRejection = await getMobileBookingBlacklistRejection({
      licensePlate: input.licensePlate,
      emails: [auth.user.email, typeof body.email === "string" ? body.email : undefined],
    })
    if (blacklistRejection) {
      outcome = blacklistRejection.status === 409 ? "booking_blocked" : "blacklist_unavailable"
      if (blacklistRejection.status === 503) return respond(blacklistRejection.body, 503)
      return respond({
        success: true, available: false,
        code: blacklistRejection.body.code, message: blacklistRejection.body.error,
        conflictingBookings: 0, totalSpots: 0, maxBookingsInPeriod: 0,
      })
    }

    if (input.licensePlate && await isMobileBookingPlateBlocked(input.licensePlate)) {
      outcome = "plate_not_allowed"
      return respond({
        success: true, available: false,
        code: LICENSE_PLATE_NOT_ALLOWED, message: LICENSE_PLATE_NOT_ALLOWED_MESSAGE,
        conflictingBookings: 0, totalSpots: 0, maxBookingsInPeriod: 0,
      })
    }

    const { availability, conflict } = await checkMobileReservation(input, auth.user, metrics)
    if (conflict.exists) {
      outcome = "conflict"
      return respond({
        success: true, ...availability, available: false,
        duplicateReservation: true, existingBooking: conflict.existingBooking,
        error: "DUPLICATE_LICENSE_PLATE_PERIOD", message: conflictMessage(input.licensePlate!),
      })
    }
    outcome = availability.available ? "available" : "full"
    return respond({ success: true, ...availability })
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    errorCode = typeof code === "string" || typeof code === "number" ? code : undefined
    return respond({ success: false, code: "BOOKING_CHECK_UNAVAILABLE", error: BOOKING_CHECK_UNAVAILABLE }, 503)
  } finally {
    console.info("[mobile-check-availability] summary", {
      authenticationMs: Math.round(authenticationMs), readMs: Math.round(metrics.readMs),
      calculationMs: Math.round(metrics.calculationMs), totalMs: Math.round(performance.now() - started),
      documents: metrics.documents, result: outcome, statusCode, errorCode,
    })
  }
}
