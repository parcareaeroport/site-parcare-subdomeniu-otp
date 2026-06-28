import { createBookingWithFirestore } from "@/app/actions/booking-actions"
import {
  mapMobilePayloadToFormData,
  MOBILE_BOOKING_ORIGIN,
  type MobileBookingPayload,
} from "@/lib/mobile-booking-mapper"
import { recordPaymentAuditEvent } from "@/lib/payments/payment-audit"
import { applyBookingModificationRequest } from "@/lib/booking-modifications"
import { recordBookingModificationAuditEvent } from "@/lib/booking-modification-audit"
import { db, doc, getDoc, updateDoc, serverTimestamp } from "@/lib/server-firestore"

export const dynamic = "force-dynamic"

const NETOPIA_STATUS_PAID = 3
const NETOPIA_STATUS_CONFIRMED = 5

function isPaymentSuccessful(status: number | undefined, errorCode: string | undefined): boolean {
  if (status === NETOPIA_STATUS_PAID || status === NETOPIA_STATUS_CONFIRMED) return true
  if (errorCode === "00" || errorCode === "0") return true
  return false
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Verification-Token",
    },
  })
}

/**
 * NETOPIA IPN (Instant Payment Notification) handler.
 *
 * NETOPIA POSTs here after a payment attempt to notify us of the result.
 * We verify the data, match it to a pending payment, and create the booking.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    // TODO: In production, verify IPN signature using the Verification-Token header
    // and NETOPIA_PUBLIC_KEY via JWT verification (RS512). For sandbox testing this
    // is skipped to allow integration testing without the full key setup.
    // const verificationToken = request.headers.get("verification-token")

    const payment = body?.payment || body?.data?.payment || {}
    const order = body?.order || body?.data?.order || {}
    const error = body?.error || body?.data?.error || {}

    const ntpID = payment?.ntpID?.toString() || order?.ntpID?.toString() || ""
    const orderID = order?.orderID || ""
    const paymentStatus = payment?.status
    const errorCode = error?.code?.toString()
    console.info("[netopia-ipn] IPN payload parsed", {
      orderId: orderID,
      ntpID,
      paymentStatus,
      errorCode,
    })

    if (!orderID && !ntpID) {
      console.warn("[netopia-ipn] No orderID or ntpID in IPN body")
      return Response.json({ errorCode: 0, message: "OK – no orderId" }, { status: 200 })
    }

    const pendingRef = doc(db, "pendingPayments", orderID)
    const pendingSnap = await getDoc(pendingRef)

    if (!pendingSnap.exists()) {
      console.warn(`[netopia-ipn] No pending payment found for orderId=${orderID}`)
      return Response.json({ errorCode: 0, message: "OK – unknown order" }, { status: 200 })
    }

    const pending = pendingSnap.data() as {
      orderId: string
      ntpID: string
      userId: string
      isGuest: boolean
      amount: number
      realAmount?: number
      chargedAmount?: number
      status: string
      provider?: string
      paymentTestMode?: boolean
      paymentType?: "booking_create" | "booking_modification_difference"
      modificationRequestId?: string
      creditAppliedAmount?: number
      bookingPayload: MobileBookingPayload
      loyaltyFreeDayApplied: boolean
      bookingId?: string
    }
    const chargedAmount = pending.chargedAmount ?? pending.amount
    const realAmount = pending.realAmount ?? pending.amount

    await recordPaymentAuditEvent(orderID, "ipn_received", {
      status: "info",
      message: "Netopia IPN received",
      provider: pending.provider || "netopia",
      orderId: orderID,
      userId: pending.userId,
      paymentTestMode: !!pending.paymentTestMode,
      realAmount,
      chargedAmount,
      extra: {
        ntpID,
        paymentStatus,
        errorCode,
      },
    })

    if (
      pending.status === "paid" ||
      pending.status === "completed" ||
      pending.status === "booking_failed_refund_required"
    ) {
      return Response.json({ errorCode: 0, message: "Already processed" }, { status: 200 })
    }

    const paid = isPaymentSuccessful(paymentStatus, errorCode)

    if (!paid) {
      console.warn("[netopia-ipn] Payment marked as failed", {
        orderId: orderID,
        ntpID,
        paymentStatus,
        errorCode,
      })
      await updateDoc(pendingRef, {
        status: "failed",
        ...withoutUndefined({
          netopiaStatus: paymentStatus,
          netopiaErrorCode: errorCode ?? null,
        }),
        netopiaErrorMessage: error?.message || "",
        updatedAt: serverTimestamp(),
      })
      return Response.json({ errorCode: 0, message: "OK – payment failed" }, { status: 200 })
    }

    if (pending.paymentType === "booking_modification_difference") {
      console.info("[netopia-ipn] modification_difference_ipn_received", {
        orderId: orderID,
        ntpID,
        userId: pending.userId,
        bookingId: pending.bookingId,
        modificationRequestId: pending.modificationRequestId,
        chargedAmount,
        paymentStatus,
        errorCode,
      })
      await recordBookingModificationAuditEvent(pending.modificationRequestId, "payment_received", "success", {
        bookingId: pending.bookingId || null,
        userId: pending.userId,
        orderId: orderID,
        amountToPay: chargedAmount,
        message: "NETOPIA a confirmat plata diferenței pentru modificare.",
        extra: {
          ntpID,
          paymentStatus,
          errorCode,
        },
      })

      if (!pending.modificationRequestId) {
        await updateDoc(pendingRef, {
          status: "booking_failed_refund_required",
          ntpID: ntpID || pending.ntpID,
          netopiaStatus: paymentStatus,
          netopiaErrorCode: errorCode ?? null,
          bookingSuccess: false,
          bookingError: "Missing modificationRequestId for paid modification difference",
          refundRequired: true,
          updatedAt: serverTimestamp(),
        })
        console.error("[netopia-ipn] modification_difference_payment_paid_missing_request", {
          orderId: orderID,
          ntpID,
          bookingId: pending.bookingId || null,
          userId: pending.userId,
          chargedAmount,
        })
        return Response.json({ errorCode: 0, message: "OK – missing modification request" }, { status: 200 })
      }

      console.info("[netopia-ipn] modification_difference_payment_paid", {
        orderId: orderID,
        ntpID,
        userId: pending.userId,
        bookingId: pending.bookingId,
        modificationRequestId: pending.modificationRequestId,
        chargedAmount,
      })
      const applyResult = await applyBookingModificationRequest(pending.modificationRequestId, {
        reason: "difference_payment_paid",
        paymentOrderId: orderID,
        paymentChargedAmount: chargedAmount,
      })
      console.info("[netopia-ipn] modification_difference_apply_result", {
        orderId: orderID,
        ntpID,
        userId: pending.userId,
        bookingId: pending.bookingId || applyResult.bookingId || null,
        modificationRequestId: pending.modificationRequestId,
        success: applyResult.success,
        status: applyResult.status,
        message: applyResult.success ? "Modification applied" : applyResult.message || "Modification apply failed",
        refundRequired: !applyResult.success,
        chargedAmount,
      })
      await recordBookingModificationAuditEvent(
        pending.modificationRequestId,
        applyResult.success ? "payment_apply_completed" : "refund_required",
        applyResult.success ? "success" : "failed",
        {
          bookingId: pending.bookingId || applyResult.bookingId || null,
          userId: pending.userId,
          orderId: orderID,
          amountToPay: chargedAmount,
          message: applyResult.success
            ? "Modificarea a fost aplicată după plata diferenței."
            : applyResult.message || "Modificarea nu a putut fi aplicată după plata diferenței.",
          extra: {
            ntpID,
            status: applyResult.status,
            refundRequired: !applyResult.success,
          },
        }
      )

      await updateDoc(
        pendingRef,
        withoutUndefined({
          status: applyResult.success ? "paid" : "booking_failed_refund_required",
          ntpID: ntpID || pending.ntpID,
          netopiaStatus: paymentStatus,
          netopiaErrorCode: errorCode ?? null,
          bookingId: pending.bookingId || applyResult.bookingId || null,
          bookingSuccess: applyResult.success,
          bookingError: applyResult.success ? undefined : applyResult.message || "Modification apply failed after paid difference",
          refundRequired: applyResult.success ? undefined : true,
          updatedAt: serverTimestamp(),
        })
      )

      console.info("[netopia-ipn] Modification difference IPN finalized", {
        orderId: orderID,
        ntpID: ntpID || pending.ntpID,
        modificationRequestId: pending.modificationRequestId,
        bookingId: pending.bookingId || applyResult.bookingId || null,
        success: applyResult.success,
        chargedAmount,
      })

      return Response.json({ errorCode: 0, message: "OK" }, { status: 200 })
    }

    const payload = pending.bookingPayload
    console.info("[netopia-ipn] Starting booking creation from IPN", {
      orderId: orderID,
      ntpID,
      userId: pending.userId,
      paymentTestMode: !!pending.paymentTestMode,
      chargedAmount,
      realAmount,
    })
    const formData = mapMobilePayloadToFormData(payload)
    await recordPaymentAuditEvent(orderID, "booking_started", {
      status: "info",
      message: "Booking creation started from Netopia IPN",
      provider: pending.provider || "netopia",
      orderId: orderID,
      userId: pending.userId,
      paymentTestMode: !!pending.paymentTestMode,
      realAmount,
      chargedAmount,
    })

    const bookingResult = await createBookingWithFirestore(formData, {
      clientEmail: payload.email,
      clientPhone: payload.phone,
      numberOfPersons: payload.numberOfPersons ?? 1,
      paymentStatus: "paid",
      source: "webhook",
      bookingOrigin: MOBILE_BOOKING_ORIGIN,
      userId: pending.userId,
      profileIsGuest: pending.isGuest,
      paymentProvider: "netopia",
      paymentOrderId: orderID,
      paymentIntentId: ntpID || orderID,
      amount: pending.paymentTestMode ? chargedAmount : realAmount,
      days: payload.days,
      address: payload.address,
      city: payload.city,
      county: payload.county,
      postalCode: payload.postalCode,
      country: payload.country,
      needInvoice: payload.needInvoice,
      company: payload.needInvoice ? payload.company || undefined : undefined,
      companyVAT: payload.needInvoice ? payload.companyVAT || undefined : undefined,
      companyReg: payload.needInvoice ? payload.companyReg || undefined : undefined,
      companyAddress: payload.needInvoice ? payload.companyAddress || undefined : undefined,
      orderNotes: payload.orderNotes,
      termsAccepted: true,
      loyaltyFreeDayApplied: pending.loyaltyFreeDayApplied,
      paymentTestMode: !!pending.paymentTestMode,
      paymentTestRealAmount: realAmount,
      paymentTestChargedAmount: chargedAmount,
      creditAppliedAmount: Number(pending.creditAppliedAmount || 0),
      creditAppliedSource: "mobile_booking_credit",
    })

    await updateDoc(
      pendingRef,
      withoutUndefined({
        status: bookingResult.success ? "paid" : "booking_failed_refund_required",
        ntpID: ntpID || pending.ntpID,
        netopiaStatus: paymentStatus,
        netopiaErrorCode: errorCode ?? null,
        bookingId: bookingResult.success ? bookingResult.firestoreId || null : null,
        bookingNumber: bookingResult.success ? bookingResult.bookingNumber || null : null,
        bookingSuccess: bookingResult.success,
        bookingError: bookingResult.success ? undefined : bookingResult.message || "Booking creation failed after paid Netopia payment",
        duplicateReservation: bookingResult.success ? undefined : !!(bookingResult as any).duplicateReservation,
        refundRequired: bookingResult.success ? undefined : true,
        updatedAt: serverTimestamp(),
      })
    )
    console.info("[netopia-ipn] Pending payment updated after booking", {
      orderId: orderID,
      ntpID: ntpID || pending.ntpID,
      bookingSuccess: bookingResult.success,
      bookingId: bookingResult.firestoreId,
      bookingNumber: bookingResult.bookingNumber || null,
    })

    await recordPaymentAuditEvent(orderID, bookingResult.success ? "booking_completed" : "booking_failed", {
      status: bookingResult.success ? "success" : "failed",
      message: bookingResult.success
        ? "Booking created from Netopia IPN"
        : bookingResult.message || "Booking creation failed from Netopia IPN",
      provider: pending.provider || "netopia",
      orderId: orderID,
      userId: pending.userId,
      bookingId: bookingResult.firestoreId,
      bookingNumber: bookingResult.bookingNumber || undefined,
      paymentTestMode: !!pending.paymentTestMode,
      realAmount,
      chargedAmount,
    })

    console.log(
      `[netopia-ipn] Payment confirmed for orderId=${orderID}, ` +
        `bookingSuccess=${bookingResult.success}, ` +
        `bookingNumber=${bookingResult.bookingNumber || "N/A"}`
    )
    console.info("[netopia-ipn] IPN fully finalized", {
      orderId: orderID,
      ntpID: ntpID || pending.ntpID,
      bookingSuccess: bookingResult.success,
      bookingId: bookingResult.firestoreId || null,
      bookingNumber: bookingResult.bookingNumber || null,
      pendingPaymentStatus: bookingResult.success ? "paid" : "booking_failed_refund_required",
      paymentTestMode: !!pending.paymentTestMode,
      chargedAmount,
      realAmount,
    })

    return Response.json({ errorCode: 0, message: "OK" }, { status: 200 })
  } catch (err) {
    console.error("[netopia-ipn] Error processing IPN:", err)
    return Response.json({ errorCode: 0, message: "OK – internal error logged" }, { status: 200 })
  }
}
