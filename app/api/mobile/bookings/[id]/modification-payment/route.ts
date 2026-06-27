import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { db, doc, getDoc } from "@/lib/server-firestore"
import { createMobileNetopiaPaymentSession } from "@/lib/payments/netopia-provider"
import { recordBookingModificationAuditEvent } from "@/lib/booking-modification-audit"
import type { MobileBookingPayload } from "@/lib/mobile-booking-mapper"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

function isBookingOwner(booking: Record<string, unknown>, uid: string, email?: string | null) {
  if (booking.userId === uid) return true
  return !!email && booking.clientEmail === email
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response
  let bookingIdForLog: string | null = null
  let modificationRequestIdForLog: string | null = null

  try {
    const { id: bookingId } = await params
    bookingIdForLog = bookingId
    const body = await request.json().catch(() => ({}))
    const requestedOrderId = typeof body?.orderId === "string" ? body.orderId.trim() : ""

    const bookingSnap = await getDoc(doc(db, "bookings", bookingId))
    if (!bookingSnap.exists()) {
      return mobileJsonResponse({ success: false, error: "Booking not found" }, 404)
    }

    const booking = bookingSnap.data() || {}
    if (!isBookingOwner(booking, auth.user.uid, auth.user.email)) {
      console.warn("[booking-modification] modification_difference_payment_failed", {
        bookingId,
        userId: auth.user.uid,
        reason: "forbidden",
      })
      return mobileJsonResponse({ success: false, error: "Forbidden" }, 403)
    }

    const requestId = String(booking.activeModificationRequestId || "")
    modificationRequestIdForLog = requestId || null
    if (!requestId) {
      console.warn("[booking-modification] modification_difference_payment_failed", {
        bookingId,
        userId: auth.user.uid,
        reason: "missing_active_request",
      })
      return mobileJsonResponse({ success: false, error: "Nu există o cerere de modificare activă." }, 400)
    }

    const requestSnap = await getDoc(doc(db, "bookingModificationRequests", requestId))
    if (!requestSnap.exists()) {
      return mobileJsonResponse({ success: false, error: "Cererea de modificare nu există." }, 404)
    }

    const mod = requestSnap.data() || {}
    if (mod.status !== "awaiting_difference_payment") {
      console.warn("[booking-modification] modification_difference_payment_failed", {
        bookingId,
        modificationRequestId: requestId,
        userId: auth.user.uid,
        reason: "not_awaiting_difference_payment",
        status: mod.status || null,
      })
      return mobileJsonResponse({ success: false, error: "Cererea nu așteaptă plata diferenței." }, 400)
    }

    const amountToPay = Math.round(Number(mod.amountToPay || 0) * 100) / 100
    if (amountToPay <= 0) {
      console.warn("[booking-modification] modification_difference_payment_failed", {
        bookingId,
        modificationRequestId: requestId,
        userId: auth.user.uid,
        reason: "no_amount_to_pay",
        amountToPay,
      })
      return mobileJsonResponse({ success: false, error: "Cererea nu are diferență de plată." }, 400)
    }

    const finalValues = (mod.finalValues || {}) as Record<string, string>
    const payload: MobileBookingPayload = {
      licensePlate: String(finalValues.licensePlate || booking.licensePlate || ""),
      startDate: String(finalValues.startDate || booking.startDate || ""),
      startTime: String(finalValues.startTime || booking.startTime || ""),
      endDate: String(finalValues.endDate || booking.endDate || ""),
      endTime: String(finalValues.endTime || booking.endTime || ""),
      email: String(booking.clientEmail || auth.user.email || ""),
      phone: booking.clientPhone ? String(booking.clientPhone) : undefined,
      firstName: booking.clientName ? String(booking.clientName).split(" ")[0] : "Client",
      lastName: booking.clientName ? String(booking.clientName).split(" ").slice(1).join(" ") : "OTP Parking",
      days: Number(mod.billableDays || booking.days || 1),
      amount: amountToPay,
    }

    const orderId = requestedOrderId || `mobile_mod_${bookingId}_${Date.now()}`
    console.info("[booking-modification] modification_difference_payment_init", {
      bookingId,
      modificationRequestId: requestId,
      userId: auth.user.uid,
      orderId,
      amountToPay,
      apiBookingNumber: booking.apiBookingNumber || booking.bookingNumber || null,
      originalBookingAmount: Number(mod.currentAmount || booking.amount || 0),
      newBookingAmount: Number(mod.newAmount || 0),
    })
    await recordBookingModificationAuditEvent(requestId, "difference_payment_init", "info", {
      bookingId,
      apiBookingNumber: String(booking.apiBookingNumber || booking.bookingNumber || "") || null,
      userId: auth.user.uid,
      orderId,
      amountToPay,
      creditAmount: Number(mod.creditAmount || 0),
      difference: Number(mod.difference || 0),
      message: "Clientul a inițiat plata diferenței pentru modificare.",
    })
    const session = await createMobileNetopiaPaymentSession(
      payload,
      {
        userId: auth.user.uid,
        isGuest: auth.user.isGuest,
        paymentProvider: "netopia",
      },
      amountToPay,
      orderId,
      {
        realAmount: amountToPay,
        chargedAmount: amountToPay,
        paymentType: "booking_modification_difference",
        description: `Diferență modificare rezervare OTP Parking #${booking.apiBookingNumber || bookingId}`,
        pendingPaymentExtra: {
          paymentType: "booking_modification_difference",
          bookingId,
          modificationRequestId: requestId,
          originalBookingAmount: Number(mod.currentAmount || booking.amount || 0),
          newBookingAmount: Number(mod.newAmount || 0),
        },
      }
    )
    console.info("[booking-modification] modification_difference_payment_session_created", {
      bookingId,
      modificationRequestId: requestId,
      userId: auth.user.uid,
      orderId,
      amountToPay,
      hasPaymentUrl: Boolean(session.paymentUrl || session.authenticationUrl),
      ntpID: session.ntpID || null,
      status: session.status,
    })

    return mobileJsonResponse({
      success: true,
      provider: "netopia",
      paymentUrl: session.paymentUrl,
      authenticationUrl: session.authenticationUrl,
      ntpID: session.ntpID,
      status: session.status,
      orderId,
      amount: session.chargedAmount,
      realAmount: session.realAmount,
      modificationRequestId: requestId,
      bookingId,
    })
  } catch (error) {
    console.error("[booking-modification] modification_difference_payment_exception", {
      bookingId: bookingIdForLog,
      modificationRequestId: modificationRequestIdForLog,
      userId: auth.user.uid,
      message: error instanceof Error ? error.message : "Payment init failed",
      stack: error instanceof Error ? error.stack : undefined,
    })
    return mobileJsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Payment init failed" },
      500
    )
  }
}
