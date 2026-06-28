import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import {
  type ModificationRequested,
} from "@/lib/modification-email"
import { checkAvailability, checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { resolveMobileBookingQuote } from "@/lib/booking-pricing"
import { recordBookingModificationAuditEvent } from "@/lib/booking-modification-audit"
import { applyBookingModificationRequest } from "@/lib/booking-modifications"
import { addDoc, collection, db, doc, getDoc, serverTimestamp, updateDoc } from "@/lib/server-firestore"

const MODIFICATION_MIN_LEAD_MS = 24 * 60 * 60 * 1000

export async function OPTIONS() {
  return mobileOptionsResponse()
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
  const d = new Date(`${date}T${time}:00`)
  const t = d.getTime()
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response
  let bookingIdForLog: string | null = null

  try {
    const { id } = await params
    bookingIdForLog = id
    const snap = await getDoc(doc(db, "bookings", id))

    if (!snap.exists()) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "booking_not_found",
      })
      return mobileJsonResponse({ success: false, error: "Booking not found" }, 404)
    }

    const booking = (snap.data() || {}) as Record<string, unknown>
    console.info("[booking-modification] modification_request_received", {
      bookingId: id,
      userId: auth.user.uid,
      userEmail: auth.user.email || null,
      apiBookingNumber: booking.apiBookingNumber || booking.bookingNumber || null,
      currentStatus: booking.status || null,
      source: booking.source || null,
      bookingOrigin: booking.bookingOrigin || null,
    })

    if (!isBookingOwner(booking, auth.user.uid, auth.user.email)) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "forbidden",
      })
      return mobileJsonResponse({ success: false, error: "Forbidden" }, 403)
    }

    if (booking.modificationRequested === true) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "existing_active_request",
        activeModificationRequestId: booking.activeModificationRequestId || null,
      })
      return mobileJsonResponse(
        { success: false, error: "Există deja o cerere de modificare în curs pentru această rezervare." },
        409
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const requested: ModificationRequested = {
      newStartDate: asString(body.newStartDate),
      newStartTime: asString(body.newStartTime),
      newEndDate: asString(body.newEndDate),
      newEndTime: asString(body.newEndTime),
      newLicensePlate: asString(body.newLicensePlate)?.toUpperCase(),
      note: asString(body.note),
    }
    console.info("[booking-modification] modification_request_payload_parsed", {
      bookingId: id,
      userId: auth.user.uid,
      requestedFields: {
        hasNewStartDate: Boolean(requested.newStartDate),
        hasNewStartTime: Boolean(requested.newStartTime),
        hasNewEndDate: Boolean(requested.newEndDate),
        hasNewEndTime: Boolean(requested.newEndTime),
        hasNewLicensePlate: Boolean(requested.newLicensePlate),
        hasNote: Boolean(requested.note),
      },
    })

    if (requested.newStartDate && !isValidDate(requested.newStartDate)) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "invalid_start_date",
      })
      return mobileJsonResponse({ success: false, error: "Format dată intrare invalid (YYYY-MM-DD)" }, 400)
    }
    if (requested.newEndDate && !isValidDate(requested.newEndDate)) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "invalid_end_date",
      })
      return mobileJsonResponse({ success: false, error: "Format dată ieșire invalid (YYYY-MM-DD)" }, 400)
    }
    if (requested.newStartTime && !isValidTime(requested.newStartTime)) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "invalid_start_time",
      })
      return mobileJsonResponse({ success: false, error: "Format oră intrare invalid (HH:MM)" }, 400)
    }
    if (requested.newEndTime && !isValidTime(requested.newEndTime)) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "invalid_end_time",
      })
      return mobileJsonResponse({ success: false, error: "Format oră ieșire invalid (HH:MM)" }, 400)
    }
    const currentStartDate = String(booking.startDate || "")
    const currentStartTime = String(booking.startTime || "")
    const currentEndDate = String(booking.endDate || "")
    const currentEndTime = String(booking.endTime || "")
    const currentStartMs = parseDateTime(currentStartDate, currentStartTime)

    if (currentStartMs === null) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "invalid_current_start",
      })
      return mobileJsonResponse({ success: false, error: "Rezervarea are data de intrare invalidă." }, 400)
    }

    if (currentStartMs - Date.now() < MODIFICATION_MIN_LEAD_MS) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "lead_time_less_than_24h",
        currentStartDate,
        currentStartTime,
      })
      return mobileJsonResponse(
        { success: false, error: "Rezervarea poate fi modificată doar cu minimum 24h înainte de intrare." },
        403
      )
    }

    const finalStartDate = requested.newStartDate || currentStartDate
    const finalStartTime = requested.newStartTime || currentStartTime
    const finalEndDate = requested.newEndDate || currentEndDate
    const finalEndTime = requested.newEndTime || currentEndTime

    if (
      finalStartDate &&
      finalEndDate &&
      finalStartTime &&
      finalEndTime &&
      isValidDate(finalStartDate) &&
      isValidDate(finalEndDate) &&
      isValidTime(finalStartTime) &&
      isValidTime(finalEndTime)
    ) {
      const startMs = parseDateTime(finalStartDate, finalStartTime)
      const endMs = parseDateTime(finalEndDate, finalEndTime)
      if (startMs !== null && endMs !== null && endMs <= startMs) {
        console.warn("[booking-modification] modification_request_failed", {
          bookingId: id,
          userId: auth.user.uid,
          reason: "invalid_new_interval",
          finalStartDate,
          finalStartTime,
          finalEndDate,
          finalEndTime,
        })
        return mobileJsonResponse(
          { success: false, error: "Data/ora de ieșire trebuie să fie după cea de intrare" },
          400
        )
      }

      const availability = await checkAvailability(
        finalStartDate,
        finalStartTime,
        finalEndDate,
        finalEndTime,
        { excludeBookingId: id }
      )

      if (!availability.available) {
        console.warn("[booking-modification] modification_request_failed", {
          bookingId: id,
          userId: auth.user.uid,
          reason: "availability_unavailable",
          finalStartDate,
          finalStartTime,
          finalEndDate,
          finalEndTime,
        })
        return mobileJsonResponse(
          {
            success: false,
            error: "Nu sunt locuri disponibile pentru noua perioadă. Poți solicita anularea rezervării.",
          },
          409
        )
      }
    }

    const finalLicensePlate = requested.newLicensePlate || String(booking.licensePlate || "")
    const duplicateCheck = await checkExistingReservationByLicensePlate(
      finalLicensePlate,
      finalStartDate,
      finalEndDate,
      finalStartTime,
      finalEndTime,
      { excludeBookingId: id }
    )

    if (duplicateCheck.exists) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "duplicate_license_plate",
        licensePlate: finalLicensePlate,
        finalStartDate,
        finalStartTime,
        finalEndDate,
        finalEndTime,
      })
      return mobileJsonResponse(
        {
          success: false,
          error: "Există deja o rezervare activă pentru această mașină în noua perioadă.",
          duplicateReservation: true,
          existingBooking: duplicateCheck.existingBooking,
        },
        409
      )
    }

    const hasAnyChange =
      !!requested.newStartDate ||
      !!requested.newStartTime ||
      !!requested.newEndDate ||
      !!requested.newEndTime ||
      !!requested.newLicensePlate

    if (!hasAnyChange) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "no_changes",
      })
      return mobileJsonResponse({ success: false, error: "Niciun câmp modificat" }, 400)
    }

    const email = auth.user.email || String(booking.clientEmail || "")
    const bookingNumber = String(
      booking.apiBookingNumber || booking.bookingNumber || snap.id
    )
    const licensePlate = String(booking.licensePlate || "—")
    const currentAmount = getCurrentCommercialAmount(booking)
    const newQuote = await resolveMobileBookingQuote({
      startDate: finalStartDate,
      startTime: finalStartTime,
      endDate: finalEndDate,
      endTime: finalEndTime,
    })
    const newAmount =
      String(booking.paymentMethod || "").toLowerCase() === "at_parking" ||
      String(booking.source || "") === "pay_on_site"
        ? newQuote.atParkingTotal
        : newQuote.onlineTotal
    const priceDifference = roundMoney(newAmount - currentAmount)
    const amountToPay = priceDifference > 0 ? priceDifference : 0
    const creditAmount = priceDifference < 0 ? Math.abs(priceDifference) : 0
    console.info("[booking-modification] modification_quote_resolved", {
      bookingId: id,
      userId: auth.user.uid,
      apiBookingNumber: booking.apiBookingNumber || booking.bookingNumber || null,
      currentAmount,
      newAmount,
      difference: priceDifference,
      amountToPay,
      creditAmount,
      billableDays: newQuote.days,
      paymentTestMode: booking.paymentTestMode === true,
      storedChargedAmount: Number(booking.amount || 0),
    })

    if (!email) {
      console.warn("[booking-modification] modification_request_failed", {
        bookingId: id,
        userId: auth.user.uid,
        reason: "missing_email",
      })
      return mobileJsonResponse({ success: false, error: "Email utilizator lipsă" }, 400)
    }

    const modificationRef = await addDoc(collection(db, "bookingModificationRequests"), {
      bookingId: snap.id,
      userId: auth.user.uid,
      userEmail: email,
      status: amountToPay > 0 ? "awaiting_difference_payment" : "applying",
      requestedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      source: "mobile-app",
      currentSnapshot: {
        startDate: currentStartDate,
        startTime: currentStartTime,
        endDate: currentEndDate,
        endTime: currentEndTime,
        licensePlate,
        amount: currentAmount,
        storedChargedAmount: Number(booking.amount || 0),
        paymentTestMode: booking.paymentTestMode === true,
        apiBookingNumber: booking.apiBookingNumber || null,
        source: booking.source || null,
        paymentProvider: booking.paymentProvider || null,
      },
      requested,
      finalValues: {
        startDate: finalStartDate,
        startTime: finalStartTime,
        endDate: finalEndDate,
        endTime: finalEndTime,
        licensePlate: finalLicensePlate,
      },
      currentAmount,
      currentPaidAmount: currentAmount,
      newAmount,
      difference: priceDifference,
      amountToPay,
      creditAmount,
      billableDays: newQuote.days,
    })
    console.info("[booking-modification] modification_request_created", {
      bookingId: id,
      modificationRequestId: modificationRef.id,
      userId: auth.user.uid,
      apiBookingNumber: booking.apiBookingNumber || booking.bookingNumber || null,
      currentAmount,
      newAmount,
      difference: priceDifference,
      amountToPay,
      creditAmount,
    })
    await recordBookingModificationAuditEvent(modificationRef.id, "request_created", "info", {
      bookingId: id,
      apiBookingNumber: String(booking.apiBookingNumber || booking.bookingNumber || "") || null,
      userId: auth.user.uid,
      amountToPay,
      creditAmount,
      difference: priceDifference,
      message: "Clientul a trimis cererea de modificare din aplicația mobilă.",
      extra: {
        requested,
        finalValues: {
          startDate: finalStartDate,
          startTime: finalStartTime,
          endDate: finalEndDate,
          endTime: finalEndTime,
          licensePlate: finalLicensePlate,
        },
      },
    })

    await updateDoc(snap.ref, {
      modificationRequested: true,
      activeModificationRequestId: modificationRef.id,
      activeModificationRequest: {
        id: modificationRef.id,
        status: amountToPay > 0 ? "awaiting_difference_payment" : "applying",
        currentAmount,
        newAmount,
        amountToPay,
        creditAmount,
        difference: priceDifference,
        finalValues: {
          startDate: finalStartDate,
          startTime: finalStartTime,
          endDate: finalEndDate,
          endTime: finalEndTime,
          licensePlate: finalLicensePlate,
        },
      },
      modificationRequestedAt: serverTimestamp(),
      modificationRequestPayload: requested,
      modificationPriceImpact: {
        currentAmount,
        newAmount,
        difference: priceDifference,
        policy:
          priceDifference > 0
            ? "Clientul achită diferența înainte de confirmarea modificării."
            : priceDifference < 0
              ? "Diferența rămâne avans pentru o rezervare viitoare."
              : "Fără diferență de preț.",
      },
    })

    if (amountToPay > 0) {
      await recordBookingModificationAuditEvent(modificationRef.id, "payment_required", "info", {
        bookingId: id,
        apiBookingNumber: bookingNumber,
        userId: auth.user.uid,
        amountToPay,
        creditAmount,
        difference: priceDifference,
        message: "Modificarea necesită plata diferenței înainte de aplicare.",
      })
      return mobileJsonResponse({
        success: true,
        status: "awaiting_difference_payment",
        requiresPayment: true,
        modificationRequestId: modificationRef.id,
        bookingId: id,
        currentPaidAmount: currentAmount,
        newAmount,
        difference: priceDifference,
        amountToPay,
        creditAmount,
        billableDays: newQuote.days,
      })
    }

    const applyResult = await applyBookingModificationRequest(modificationRef.id, {
      reason: "auto_no_payment",
    })

    return mobileJsonResponse({
      success: applyResult.success,
      status: applyResult.status,
      requiresPayment: false,
      modificationRequestId: modificationRef.id,
      bookingId: id,
      bookingNumber: applyResult.bookingNumber || undefined,
      currentPaidAmount: currentAmount,
      newAmount,
      difference: priceDifference,
      amountToPay,
      creditAmount,
      billableDays: newQuote.days,
      refundRequired: "refundRequired" in applyResult ? applyResult.refundRequired : false,
      recoveryRequired: "recoveryRequired" in applyResult ? applyResult.recoveryRequired : false,
      error: applyResult.success ? undefined : applyResult.message,
    }, applyResult.success ? 200 : 409)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[booking-modification] modification_request_exception", {
      bookingId: bookingIdForLog,
      userId: auth.user.uid,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    const status = message.includes("obligatorii") || message.includes("modificat") ? 400 : 500
    return mobileJsonResponse({ success: false, error: message }, status)
  }
}
