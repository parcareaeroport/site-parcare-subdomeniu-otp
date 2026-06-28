import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { checkAvailability, checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { resolveMobileBookingQuote } from "@/lib/booking-pricing"
import { recordBookingModificationAuditEvent } from "@/lib/booking-modification-audit"
import { db, doc, getDoc } from "@/lib/server-firestore"
import { normalizeLicensePlate } from "@/lib/utils"

const MODIFICATION_MIN_LEAD_MS = 24 * 60 * 60 * 1000

export async function OPTIONS() {
  return mobileOptionsResponse()
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value)
}

function parseDateTime(date: string, time: string): number | null {
  const t = new Date(`${date}T${time}:00`).getTime()
  return Number.isNaN(t) ? null : t
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function getCurrentCommercialAmount(booking: Record<string, unknown>): number {
  const testRealAmount = Number(booking.paymentTestRealAmount || 0)
  if (booking.paymentTestMode === true && testRealAmount > 0) {
    return roundMoney(testRealAmount)
  }
  return roundMoney(Number(booking.amount || 0))
}

function isPayOnSiteBooking(booking: Record<string, unknown>): boolean {
  return (
    String(booking.source || "") === "pay_on_site" ||
    String(booking.paymentMethod || "").toLowerCase() === "at_parking"
  )
}

function isBookingOwner(booking: Record<string, unknown>, uid: string, email?: string | null) {
  if (booking.userId === uid) return true
  return !!email && booking.clientEmail === email && (booking.bookingOrigin === "mobile-app" || booking.userId === uid)
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

    const booking = (snap.data() || {}) as Record<string, unknown>
    if (!isBookingOwner(booking, auth.user.uid, auth.user.email)) {
      return mobileJsonResponse({ success: false, error: "Forbidden" }, 403)
    }

    await recordBookingModificationAuditEvent(String(booking.activeModificationRequestId || ""), "quote_requested", "info", {
      bookingId: id,
      apiBookingNumber: String(booking.apiBookingNumber || booking.bookingNumber || "") || null,
      userId: auth.user.uid,
      message: "Clientul a cerut calculul pentru modificarea rezervării.",
    })

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const newStartDate = asString(body.newStartDate)
    const newStartTime = asString(body.newStartTime)
    const newEndDate = asString(body.newEndDate)
    const newEndTime = asString(body.newEndTime)
    const newLicensePlate = asString(body.newLicensePlate)?.toUpperCase()

    for (const [label, value, validator] of [
      ["Data intrare", newStartDate, isValidDate],
      ["Data ieșire", newEndDate, isValidDate],
      ["Ora intrare", newStartTime, isValidTime],
      ["Ora ieșire", newEndTime, isValidTime],
    ] as const) {
      if (value && !validator(value)) {
        return mobileJsonResponse({ success: false, error: `${label} are format invalid.` }, 400)
      }
    }

    const currentStartDate = String(booking.startDate || "")
    const currentStartTime = String(booking.startTime || "")
    const currentEndDate = String(booking.endDate || "")
    const currentEndTime = String(booking.endTime || "")
    const currentStartMs = parseDateTime(currentStartDate, currentStartTime)
    if (currentStartMs === null) {
      return mobileJsonResponse({ success: false, error: "Rezervarea are data de intrare invalidă." }, 400)
    }
    if (currentStartMs - Date.now() < MODIFICATION_MIN_LEAD_MS) {
      return mobileJsonResponse({ success: false, error: "Rezervarea poate fi modificată doar cu minimum 24h înainte de intrare." }, 403)
    }

    const finalStartDate = newStartDate || currentStartDate
    const finalStartTime = newStartTime || currentStartTime
    const finalEndDate = newEndDate || currentEndDate
    const finalEndTime = newEndTime || currentEndTime
    const finalLicensePlate = normalizeLicensePlate(newLicensePlate || String(booking.licensePlate || ""))

    const startMs = parseDateTime(finalStartDate, finalStartTime)
    const endMs = parseDateTime(finalEndDate, finalEndTime)
    if (startMs === null || endMs === null || endMs <= startMs) {
      return mobileJsonResponse({ success: false, error: "Data/ora de ieșire trebuie să fie după cea de intrare." }, 400)
    }

    const availability = await checkAvailability(
      finalStartDate,
      finalStartTime,
      finalEndDate,
      finalEndTime,
      { excludeBookingId: id }
    )
    if (!availability.available) {
      return mobileJsonResponse({
        success: false,
        available: false,
        error: "Nu sunt locuri disponibile pentru noua perioadă. Poți solicita anularea rezervării.",
      }, 409)
    }

    const duplicateCheck = await checkExistingReservationByLicensePlate(
      finalLicensePlate,
      finalStartDate,
      finalEndDate,
      finalStartTime,
      finalEndTime,
      { excludeBookingId: id }
    )
    if (duplicateCheck.exists) {
      return mobileJsonResponse({
        success: false,
        available: false,
        duplicateReservation: true,
        existingBooking: duplicateCheck.existingBooking,
        error: "Există deja o rezervare activă pentru această mașină în noua perioadă.",
      }, 409)
    }

    const quote = await resolveMobileBookingQuote({
      startDate: finalStartDate,
      startTime: finalStartTime,
      endDate: finalEndDate,
      endTime: finalEndTime,
    })
    const payOnSite = isPayOnSiteBooking(booking)
    const currentPaidAmount = getCurrentCommercialAmount(booking)
    const newAmount = roundMoney(
      payOnSite ? quote.atParkingTotal : quote.onlineTotal
    )
    const difference = roundMoney(newAmount - currentPaidAmount)
    const amountToPay = !payOnSite && difference > 0 ? difference : 0
    const creditAmount = !payOnSite && difference < 0 ? Math.abs(difference) : 0
    const paymentPolicy = payOnSite ? "pay_on_site_amount_updated" : "online_difference_policy"

    console.info("[booking-modification] quote_resolved", {
      bookingId: id,
      userId: auth.user.uid,
      apiBookingNumber: booking.apiBookingNumber || booking.bookingNumber || null,
      currentPaidAmount,
      newAmount,
      difference,
      amountToPay,
      creditAmount,
      billableDays: quote.days,
      paymentTestMode: booking.paymentTestMode === true,
      storedChargedAmount: Number(booking.amount || 0),
      paymentPolicy,
    })

    return mobileJsonResponse({
      success: true,
      available: true,
      currentPaidAmount,
      newAmount,
      difference,
      amountToPay,
      creditAmount,
      billableDays: quote.days,
      paymentPolicy,
      finalValues: {
        startDate: finalStartDate,
        startTime: finalStartTime,
        endDate: finalEndDate,
        endTime: finalEndTime,
        licensePlate: finalLicensePlate,
      },
    })
  } catch (error) {
    console.error("[booking-modification] quote_exception", {
      userId: auth.user.uid,
      message: error instanceof Error ? error.message : "Unknown error",
    })
    return mobileJsonResponse({ success: false, error: error instanceof Error ? error.message : "Quote failed" }, 500)
  }
}
