import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { checkAvailability, checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { cancelMultiparkBooking, createMultiparkBooking, type MultiparkBookingResult } from "@/lib/multipark-bookings"
import { addUserCredit } from "@/lib/user-credits"
import { normalizeLicensePlate } from "@/lib/utils"
import { recordBookingModificationAuditEvent } from "@/lib/booking-modification-audit"
import { sendBookingModificationConfirmationEmail } from "@/lib/email-service"

export type BookingModificationStatus =
  | "awaiting_difference_payment"
  | "applying"
  | "completed"
  | "failed"
  | "refund_required"
  | "rollback_completed"
  | "rollback_failed"
  | "pending_admin_review"
  | "rejected"

type ModificationValues = {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  licensePlate: string
}

type ApplyReason = "auto_no_payment" | "difference_payment_paid" | "retry" | "admin_approved"

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function parseDateTime(date: string, time: string): number {
  return new Date(`${date}T${time}:00`).getTime()
}

function computeDurations(values: ModificationValues) {
  const startMs = parseDateTime(values.startDate, values.startTime)
  const endMs = parseDateTime(values.endDate, values.endTime)
  const durationMinutes = Math.round((endMs - startMs) / (1000 * 60))
  const roundedDays = Math.ceil(durationMinutes / (24 * 60))
  return {
    durationMinutes,
    multiparkDurationMinutes: roundedDays * 24 * 60,
    days: Math.max(1, roundedDays),
  }
}

function valuesFromBooking(booking: Record<string, unknown>): ModificationValues {
  return {
    startDate: String(booking.startDate || ""),
    startTime: String(booking.startTime || ""),
    endDate: String(booking.endDate || ""),
    endTime: String(booking.endTime || ""),
    licensePlate: normalizeLicensePlate(String(booking.licensePlate || "")),
  }
}

function valuesFromSnapshot(snapshot: Record<string, unknown> | undefined, fallback: Record<string, unknown>) {
  return {
    startDate: String(snapshot?.startDate || fallback.startDate || ""),
    startTime: String(snapshot?.startTime || fallback.startTime || ""),
    endDate: String(snapshot?.endDate || fallback.endDate || ""),
    endTime: String(snapshot?.endTime || fallback.endTime || ""),
    licensePlate: normalizeLicensePlate(String(snapshot?.licensePlate || fallback.licensePlate || "")),
  }
}

function summarizeMultiparkResult(result: MultiparkBookingResult | null) {
  if (!result) return null
  return {
    success: result.success,
    message: result.message,
    bookingNumber: result.bookingNumber || null,
    apiErrorCode: result.apiErrorCode || null,
    httpStatus: result.httpStatus || null,
  }
}

function buildModificationEmailPayload(input: {
  booking: Record<string, unknown>
  oldValues: ModificationValues
  finalValues: ModificationValues
  oldAmount: number
  newAmount: number
  difference: number
  amountToPay: number
  creditAmount: number
  oldApiBookingNumber: string
  newApiBookingNumber?: string | null
  payOnSiteLocalOnly: boolean
  days: number
}) {
  return {
    clientName: String(input.booking.clientName || "Client"),
    clientEmail: String(input.booking.clientEmail || ""),
    licensePlate: input.finalValues.licensePlate,
    oldLicensePlate: input.oldValues.licensePlate,
    startDate: input.finalValues.startDate,
    startTime: input.finalValues.startTime,
    endDate: input.finalValues.endDate,
    endTime: input.finalValues.endTime,
    oldStartDate: input.oldValues.startDate,
    oldStartTime: input.oldValues.startTime,
    oldEndDate: input.oldValues.endDate,
    oldEndTime: input.oldValues.endTime,
    days: input.days,
    oldAmount: input.oldAmount,
    newAmount: input.newAmount,
    difference: input.difference,
    amountToPay: input.amountToPay,
    creditAmount: input.creditAmount,
    bookingNumber: input.payOnSiteLocalOnly ? undefined : String(input.newApiBookingNumber || ""),
    oldBookingNumber: input.oldApiBookingNumber || undefined,
    source: input.payOnSiteLocalOnly ? "pay_on_site" as const : "online" as const,
    modifiedAt: new Date(),
  }
}

async function markModificationEmailResult(input: {
  bookingId: string
  requestId: string
  status: "sent" | "failed" | "skipped"
  messageId?: string | null
  error?: string | null
  response?: string | null
  qrIncluded?: boolean | null
}) {
  const bookingRef = adminDb.collection("bookings").doc(input.bookingId)
  const requestRef = adminDb.collection("bookingModificationRequests").doc(input.requestId)
  const bookingSnap = await bookingRef.get()
  const booking = bookingSnap.exists ? bookingSnap.data() || {} : {}
  const history = Array.isArray(booking.modificationHistory) ? booking.modificationHistory : []
  const updatedHistory = history.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return entry
    const item = entry as Record<string, unknown>
    if (String(item.requestId || "") !== input.requestId) return entry
    return {
      ...item,
      modificationEmailStatus: input.status,
      modificationEmailSentAtIso: input.status === "sent" ? new Date().toISOString() : null,
      modificationEmailError: input.error || null,
      modificationEmailMessageId: input.messageId || null,
      modificationEmailQrIncluded: input.qrIncluded ?? null,
    }
  })
  const updatePayload = {
    modificationEmailStatus: input.status,
    modificationEmailSentAt: input.status === "sent" ? FieldValue.serverTimestamp() : null,
    modificationEmailError: input.error || null,
    modificationEmailMessageId: input.messageId || null,
    modificationEmailQrIncluded: input.qrIncluded ?? null,
    modificationEmailTransportResponse: input.response || null,
    modificationHistory: updatedHistory,
    activeModificationRequest: {
      ...(booking.activeModificationRequest && typeof booking.activeModificationRequest === "object"
        ? booking.activeModificationRequest as Record<string, unknown>
        : {}),
      modificationEmailStatus: input.status,
      modificationEmailError: input.error || null,
      modificationEmailMessageId: input.messageId || null,
    },
    lastUpdated: FieldValue.serverTimestamp(),
  }
  await Promise.all([
    bookingRef.set(updatePayload, { merge: true }),
    requestRef.set(
      {
        modificationEmailStatus: input.status,
        modificationEmailSentAt: input.status === "sent" ? FieldValue.serverTimestamp() : null,
        modificationEmailError: input.error || null,
        modificationEmailMessageId: input.messageId || null,
        modificationEmailQrIncluded: input.qrIncluded ?? null,
        modificationEmailTransportResponse: input.response || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    ),
  ])
}

async function sendModificationConfirmationEmailBestEffort(input: {
  bookingId: string
  requestId: string
  booking: Record<string, unknown>
  oldValues: ModificationValues
  finalValues: ModificationValues
  oldAmount: number
  newAmount: number
  difference: number
  amountToPay: number
  creditAmount: number
  oldApiBookingNumber: string
  newApiBookingNumber?: string | null
  payOnSiteLocalOnly: boolean
  days: number
  userId?: string | null
  orderId?: string | null
}) {
  const email = String(input.booking.clientEmail || "").trim()
  const shouldHaveQr = !input.payOnSiteLocalOnly
  console.info("[booking-modification] modification_email_started", {
    bookingId: input.bookingId,
    modificationRequestId: input.requestId,
    oldApiBookingNumber: input.oldApiBookingNumber || null,
    newApiBookingNumber: input.newApiBookingNumber || null,
    payOnSiteLocalOnly: input.payOnSiteLocalOnly,
    hasClientEmail: Boolean(email),
  })
  await recordBookingModificationAuditEvent(input.requestId, "modification_email_started", "info", {
    bookingId: input.bookingId,
    apiBookingNumber: input.newApiBookingNumber || null,
    userId: input.userId || null,
    orderId: input.orderId || null,
    amountToPay: input.amountToPay,
    creditAmount: input.creditAmount,
    difference: input.difference,
    message: "Se pregătește emailul de confirmare pentru modificare.",
  })

  if (!email) {
    const error = "Client email missing"
    await markModificationEmailResult({ bookingId: input.bookingId, requestId: input.requestId, status: "failed", error })
    await recordBookingModificationAuditEvent(input.requestId, "modification_email_failed", "failed", {
      bookingId: input.bookingId,
      apiBookingNumber: input.newApiBookingNumber || null,
      message: error,
    })
    return
  }

  if (shouldHaveQr && !input.newApiBookingNumber) {
    const error = "Missing new Multipark booking number for online modification email"
    console.warn("[booking-modification] modification_email_failed", {
      bookingId: input.bookingId,
      modificationRequestId: input.requestId,
      reason: "missing_new_api_booking_number",
    })
    await markModificationEmailResult({ bookingId: input.bookingId, requestId: input.requestId, status: "failed", error })
    await recordBookingModificationAuditEvent(input.requestId, "modification_email_failed", "failed", {
      bookingId: input.bookingId,
      apiBookingNumber: input.newApiBookingNumber || null,
      message: error,
    })
    return
  }

  const result = await sendBookingModificationConfirmationEmail(
    buildModificationEmailPayload({
      booking: input.booking,
      oldValues: input.oldValues,
      finalValues: input.finalValues,
      oldAmount: input.oldAmount,
      newAmount: input.newAmount,
      difference: input.difference,
      amountToPay: input.amountToPay,
      creditAmount: input.creditAmount,
      oldApiBookingNumber: input.oldApiBookingNumber,
      newApiBookingNumber: input.newApiBookingNumber,
      payOnSiteLocalOnly: input.payOnSiteLocalOnly,
      days: input.days,
    })
  )

  if (result.success) {
    console.info("[booking-modification] modification_email_succeeded", {
      bookingId: input.bookingId,
      modificationRequestId: input.requestId,
      oldApiBookingNumber: input.oldApiBookingNumber || null,
      newApiBookingNumber: input.newApiBookingNumber || null,
      messageId: result.messageId || null,
      qrIncluded: result.qrIncluded ?? null,
    })
    await markModificationEmailResult({
      bookingId: input.bookingId,
      requestId: input.requestId,
      status: "sent",
      messageId: result.messageId || null,
      response: result.response || null,
      qrIncluded: result.qrIncluded ?? null,
    })
    await recordBookingModificationAuditEvent(input.requestId, "modification_email_succeeded", "success", {
      bookingId: input.bookingId,
      apiBookingNumber: input.newApiBookingNumber || null,
      userId: input.userId || null,
      orderId: input.orderId || null,
      message: "Emailul de confirmare a modificării a fost trimis.",
    })
    return
  }

  console.error("[booking-modification] modification_email_failed", {
    bookingId: input.bookingId,
    modificationRequestId: input.requestId,
    oldApiBookingNumber: input.oldApiBookingNumber || null,
    newApiBookingNumber: input.newApiBookingNumber || null,
    error: result.error || null,
  })
  await markModificationEmailResult({
    bookingId: input.bookingId,
    requestId: input.requestId,
    status: "failed",
    error: result.error || "Unknown email error",
    qrIncluded: result.qrIncluded ?? null,
  })
  await recordBookingModificationAuditEvent(input.requestId, "modification_email_failed", "failed", {
    bookingId: input.bookingId,
    apiBookingNumber: input.newApiBookingNumber || null,
    userId: input.userId || null,
    orderId: input.orderId || null,
    message: result.error || "Emailul de confirmare a modificării a eșuat.",
  })
}

async function setRequestFailure(
  requestId: string,
  status: Extract<BookingModificationStatus, "failed" | "refund_required" | "rollback_completed" | "rollback_failed">,
  message: string,
  extra: Record<string, unknown>
) {
  console.error("[booking-modification] modification_failed", {
    modificationRequestId: requestId,
    status,
    message,
    ...extra,
  })
  await adminDb.collection("bookingModificationRequests").doc(requestId).set(
    {
      status,
      failureMessage: message,
      ...extra,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
  await recordBookingModificationAuditEvent(requestId, status === "failed" ? "failed" : status, "failed", {
    message,
    multiparkStatus: typeof extra.multiparkStatus === "string" ? extra.multiparkStatus : null,
    extra,
  })
}

export async function rejectBookingModificationRequest(
  requestId: string,
  actorEmail?: string | null,
  reason?: string
) {
  const requestRef = adminDb.collection("bookingModificationRequests").doc(requestId)
  const requestSnap = await requestRef.get()
  if (!requestSnap.exists) throw new Error("Cererea de modificare nu există.")
  const request = requestSnap.data() || {}
  const bookingId = String(request.bookingId || "")

  await adminDb.runTransaction(async (tx) => {
    tx.set(
      requestRef,
      {
        status: "rejected",
        rejectedAt: FieldValue.serverTimestamp(),
        rejectedBy: actorEmail || null,
        rejectionReason: reason || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    if (bookingId) {
      tx.set(
        adminDb.collection("bookings").doc(bookingId),
        {
          modificationRequested: false,
          modificationApplying: false,
          activeModificationRequestId: null,
          activeModificationRequest: {
            id: requestId,
            status: "rejected",
            rejectedAtIso: new Date().toISOString(),
            reason: reason || null,
          },
          lastModificationRequestId: requestId,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }
  })
  await recordBookingModificationAuditEvent(requestId, "rejected", "warning", {
    bookingId,
    userId: String(request.userId || "") || null,
    apiBookingNumber: String(request.currentSnapshot?.apiBookingNumber || "") || null,
    message: reason || "Cererea a fost respinsă de admin.",
  })
}

export async function approveBookingModificationRequest(
  requestId: string,
  actorEmail?: string | null
) {
  console.info("[booking-modification] admin_approve_deprecated_auto_apply", {
    modificationRequestId: requestId,
    actorEmail: actorEmail || null,
  })
  return applyBookingModificationRequest(requestId, {
    actorEmail,
    reason: "admin_approved",
  })
}

async function revalidateModification(
  requestId: string,
  bookingId: string,
  booking: Record<string, unknown>,
  finalValues: ModificationValues
) {
  const currentStartMs = parseDateTime(String(booking.startDate || ""), String(booking.startTime || ""))
  if (Number.isNaN(currentStartMs) || currentStartMs - Date.now() < 24 * 60 * 60 * 1000) {
    throw new Error("Rezervarea poate fi modificată doar cu minimum 24h înainte de intrare.")
  }

  const startMs = parseDateTime(finalValues.startDate, finalValues.startTime)
  const endMs = parseDateTime(finalValues.endDate, finalValues.endTime)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new Error("Intervalul nou este invalid.")
  }

  console.info("[booking-modification] revalidate_availability_started", {
    modificationRequestId: requestId,
    bookingId,
    finalValues,
  })
  const availability = await checkAvailability(
    finalValues.startDate,
    finalValues.startTime,
    finalValues.endDate,
    finalValues.endTime,
    { excludeBookingId: bookingId }
  )
  if (!availability.available) {
    throw new Error("Nu sunt locuri disponibile pentru noua perioadă.")
  }

  const duplicate = await checkExistingReservationByLicensePlate(
    finalValues.licensePlate,
    finalValues.startDate,
    finalValues.endDate,
    finalValues.startTime,
    finalValues.endTime,
    { excludeBookingId: bookingId }
  )
  if (duplicate.exists) {
    throw new Error("Există deja o rezervare activă pentru această mașină în noua perioadă.")
  }
}

async function updateBookingAfterMultiparkFailure(input: {
  bookingId: string
  requestId: string
  status: BookingModificationStatus
  amountToPay: number
  difference: number
  message: string
  refundRequiredAmount?: number
  recoveryRequired?: boolean
}) {
  await adminDb.collection("bookings").doc(input.bookingId).set(
    {
      modificationRequested: false,
      modificationApplying: false,
      modificationRecoveryRequired: !!input.recoveryRequired,
      activeModificationRequestId: null,
      activeModificationRequest: {
        id: input.requestId,
        status: input.status,
        amountToPay: input.amountToPay,
        difference: input.difference,
        refundRequiredAmount: input.refundRequiredAmount || 0,
        message: input.message,
        atIso: new Date().toISOString(),
      },
      lastModificationRequestId: input.requestId,
      lastMultiparkUpdateStatus: input.status,
      lastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

export async function applyBookingModificationRequest(
  requestId: string,
  options: {
    actorEmail?: string | null
    reason: ApplyReason
    paymentOrderId?: string
    paymentChargedAmount?: number
  }
) {
  const requestRef = adminDb.collection("bookingModificationRequests").doc(requestId)
  const bookingId = await adminDb.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef)
    if (!requestSnap.exists) throw new Error("Cererea de modificare nu există.")
    const request = requestSnap.data() || {}
    const id = String(request.bookingId || "")
    if (!id) throw new Error("Cererea nu are bookingId.")

    const status = String(request.status || "")
    if (status === "completed") throw new Error("Cererea este deja finalizată.")
    if (!["awaiting_difference_payment", "applying", "failed", "pending_admin_review"].includes(status)) {
      throw new Error(`Cererea nu poate fi aplicată din statusul ${status}.`)
    }

    const bookingRef = adminDb.collection("bookings").doc(id)
    const bookingSnap = await tx.get(bookingRef)
    if (!bookingSnap.exists) throw new Error("Rezervarea nu există.")
    const booking = bookingSnap.data() || {}
    if (booking.modificationApplying === true && booking.activeModificationRequestId !== requestId) {
      throw new Error("Există deja o modificare în aplicare pentru această rezervare.")
    }

    const amountToPay = roundMoney(Number(request.amountToPay || 0))
    if (amountToPay > 0 && options.reason !== "difference_payment_paid") {
      throw new Error("Cererea necesită plata diferenței înainte de aplicare.")
    }

    tx.set(
      requestRef,
      {
        status: "applying",
        applyingStartedAt: FieldValue.serverTimestamp(),
        paymentOrderId: options.paymentOrderId || request.paymentOrderId || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    tx.set(
      bookingRef,
      {
        modificationRequested: true,
        modificationApplying: true,
        activeModificationRequestId: requestId,
        activeModificationRequest: {
          id: requestId,
          status: "applying",
          currentAmount: Number(request.currentAmount || 0),
          newAmount: Number(request.newAmount || 0),
          amountToPay,
          creditAmount: Number(request.creditAmount || 0),
          difference: Number(request.difference || 0),
          paymentPolicy: request.paymentPolicy || null,
          payOnSiteLocalOnly: request.payOnSiteLocalOnly === true,
          finalValues: request.finalValues || null,
        },
        lastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    return id
  })

  const bookingRef = adminDb.collection("bookings").doc(bookingId)
  const requestSnap = await requestRef.get()
  if (!requestSnap.exists) throw new Error("Cererea de modificare nu există.")
  const request = requestSnap.data() || {}
  const bookingSnap = await bookingRef.get()
  if (!bookingSnap.exists) throw new Error("Rezervarea nu există.")
  const booking = bookingSnap.data() || {}
  const finalValues = request.finalValues as ModificationValues | undefined
  if (!finalValues?.startDate || !finalValues?.startTime || !finalValues?.endDate || !finalValues?.endTime || !finalValues?.licensePlate) {
    throw new Error("Cererea de modificare nu are valorile finale complete.")
  }
  finalValues.licensePlate = normalizeLicensePlate(finalValues.licensePlate)

  const amountToPay = roundMoney(Number(request.amountToPay || 0))
  const creditAmount = roundMoney(Number(request.creditAmount || 0))
  const difference = roundMoney(Number(request.difference || 0))
  const paymentPolicy = String(request.paymentPolicy || "")
  const payOnSiteLocalOnly =
    paymentPolicy === "pay_on_site_amount_updated" ||
    request.payOnSiteLocalOnly === true ||
    String(booking.source || "") === "pay_on_site" ||
    String(booking.paymentMethod || "").toLowerCase() === "at_parking"
  const multiparkSkippedStatus = payOnSiteLocalOnly
    ? "skipped_pay_on_site_local_only"
    : "skipped_no_api_booking_number"
  const refundRequiredAmount =
    options.reason === "difference_payment_paid"
      ? roundMoney(Number(options.paymentChargedAmount ?? amountToPay))
      : 0
  const oldApiBookingNumber = String(booking.apiBookingNumber || "")
  const shouldUseMultipark = Boolean(oldApiBookingNumber) && !payOnSiteLocalOnly
  const oldValues = valuesFromSnapshot(request.currentSnapshot as Record<string, unknown> | undefined, booking)
  const newDurations = computeDurations(finalValues)
  const oldDurations = computeDurations(oldValues)

  console.info("[booking-modification] apply_started", {
    modificationRequestId: requestId,
    bookingId,
    oldApiBookingNumber: oldApiBookingNumber || null,
    amountToPay,
    creditAmount,
    difference,
    reason: options.reason,
    paymentOrderId: options.paymentOrderId || null,
    paymentChargedAmount: options.paymentChargedAmount ?? null,
    paymentPolicy: paymentPolicy || null,
    payOnSiteLocalOnly,
  })
  await recordBookingModificationAuditEvent(requestId, "apply_started", "info", {
    bookingId,
    apiBookingNumber: oldApiBookingNumber || null,
    userId: String(request.userId || "") || null,
    orderId: options.paymentOrderId || null,
    amountToPay,
    creditAmount,
    difference,
    message: "Aplicarea automată a modificării a început.",
  })

  await revalidateModification(requestId, bookingId, booking, finalValues)

  let cancelResult: MultiparkBookingResult | null = null
  let createResult: MultiparkBookingResult | null = null
  let rollbackResult: MultiparkBookingResult | null = null
  let newApiBookingNumber = oldApiBookingNumber || undefined

  if (shouldUseMultipark) {
    await recordBookingModificationAuditEvent(requestId, "old_multipark_cancel_started", "info", {
      bookingId,
      apiBookingNumber: oldApiBookingNumber,
      userId: String(request.userId || "") || null,
      orderId: options.paymentOrderId || null,
      amountToPay,
      creditAmount,
      difference,
      message: "Se anulează rezervarea veche în Multipark.",
    })
    cancelResult = await cancelMultiparkBooking(oldApiBookingNumber)
    if (!cancelResult.success) {
      const status = options.reason === "difference_payment_paid" ? "refund_required" : "failed"
      const message = `Anularea rezervării vechi în Multipark a eșuat: ${cancelResult.message}`
      await setRequestFailure(requestId, status, message, {
        bookingId,
        oldApiBookingNumber,
        multiparkStatus: "old_cancel_failed",
        oldMultiparkCancelResult: summarizeMultiparkResult(cancelResult),
        refundRequiredAmount: status === "refund_required" ? refundRequiredAmount : 0,
      })
      await updateBookingAfterMultiparkFailure({
        bookingId,
        requestId,
        status,
        amountToPay,
        difference,
        message,
        refundRequiredAmount: status === "refund_required" ? refundRequiredAmount : 0,
      })
      return { success: false, status, bookingId, message, refundRequired: status === "refund_required" }
    }

    await recordBookingModificationAuditEvent(requestId, "old_multipark_cancel_succeeded", "success", {
      bookingId,
      apiBookingNumber: oldApiBookingNumber,
      userId: String(request.userId || "") || null,
      orderId: options.paymentOrderId || null,
      amountToPay,
      creditAmount,
      difference,
      message: "Rezervarea veche a fost anulată în Multipark.",
    })

    await recordBookingModificationAuditEvent(requestId, "new_multipark_create_started", "info", {
      bookingId,
      apiBookingNumber: oldApiBookingNumber,
      userId: String(request.userId || "") || null,
      orderId: options.paymentOrderId || null,
      amountToPay,
      creditAmount,
      difference,
      message: "Se creează noua rezervare în Multipark.",
    })
    createResult = await createMultiparkBooking({
      licensePlate: finalValues.licensePlate,
      startDate: finalValues.startDate,
      startTime: finalValues.startTime,
      durationMinutes: newDurations.multiparkDurationMinutes,
      clientName: String(booking.clientName || ""),
      clientTitle: String(booking.clientTitle || ""),
    })

    if (!createResult.success || !createResult.bookingNumber) {
      await recordBookingModificationAuditEvent(requestId, "new_multipark_create_failed", "failed", {
        bookingId,
        apiBookingNumber: oldApiBookingNumber,
        userId: String(request.userId || "") || null,
        orderId: options.paymentOrderId || null,
        amountToPay,
        creditAmount,
        difference,
        message: createResult.message,
        extra: { createResult: summarizeMultiparkResult(createResult) },
      })

      await recordBookingModificationAuditEvent(requestId, "rollback_old_multipark_started", "warning", {
        bookingId,
        apiBookingNumber: oldApiBookingNumber,
        userId: String(request.userId || "") || null,
        orderId: options.paymentOrderId || null,
        amountToPay,
        creditAmount,
        difference,
        message: "Se încearcă recrearea rezervării vechi în Multipark.",
      })
      rollbackResult = await createMultiparkBooking({
        bookingNumber: oldApiBookingNumber,
        licensePlate: oldValues.licensePlate,
        startDate: oldValues.startDate,
        startTime: oldValues.startTime,
        durationMinutes: oldDurations.multiparkDurationMinutes,
        clientName: String(booking.clientName || ""),
        clientTitle: String(booking.clientTitle || ""),
      })

      const rollbackSucceeded = rollbackResult.success
      const status: BookingModificationStatus = rollbackSucceeded ? "rollback_completed" : "rollback_failed"
      const message = rollbackSucceeded
        ? "Noua rezervare nu a putut fi creată în Multipark; rezervarea veche a fost recreată."
        : "Noua rezervare nu a putut fi creată în Multipark, iar rollback-ul rezervării vechi a eșuat."
      await setRequestFailure(requestId, status, message, {
        bookingId,
        oldApiBookingNumber,
        multiparkStatus: status,
        oldMultiparkCancelResult: summarizeMultiparkResult(cancelResult),
        newMultiparkCreateResult: summarizeMultiparkResult(createResult),
        rollbackMultiparkResult: summarizeMultiparkResult(rollbackResult),
        refundRequiredAmount,
      })
      await updateBookingAfterMultiparkFailure({
        bookingId,
        requestId,
        status,
        amountToPay,
        difference,
        message,
        refundRequiredAmount,
        recoveryRequired: !rollbackSucceeded,
      })
      await recordBookingModificationAuditEvent(
        requestId,
        rollbackSucceeded ? "rollback_old_multipark_succeeded" : "rollback_old_multipark_failed",
        rollbackSucceeded ? "warning" : "failed",
        {
          bookingId,
          apiBookingNumber: oldApiBookingNumber,
          userId: String(request.userId || "") || null,
          orderId: options.paymentOrderId || null,
          amountToPay,
          creditAmount,
          difference,
          message,
          extra: { rollbackResult: summarizeMultiparkResult(rollbackResult) },
        }
      )
      return {
        success: false,
        status,
        bookingId,
        message,
        refundRequired: options.reason === "difference_payment_paid",
        recoveryRequired: !rollbackSucceeded,
      }
    }

    newApiBookingNumber = createResult.bookingNumber
    await recordBookingModificationAuditEvent(requestId, "new_multipark_create_succeeded", "success", {
      bookingId,
      apiBookingNumber: newApiBookingNumber,
      userId: String(request.userId || "") || null,
      orderId: options.paymentOrderId || null,
      amountToPay,
      creditAmount,
      difference,
      message: "Noua rezervare a fost creată în Multipark.",
    })
  }

  const newAmount = roundMoney(Number(request.newAmount || booking.amount || 0))
  await adminDb.runTransaction(async (tx) => {
    tx.set(
      bookingRef,
      {
        startDate: finalValues.startDate,
        startTime: finalValues.startTime,
        endDate: finalValues.endDate,
        endTime: finalValues.endTime,
        licensePlate: finalValues.licensePlate,
        amount: newAmount,
        days: newDurations.days,
        durationMinutes: newDurations.durationMinutes,
        multiparkDurationMinutes: shouldUseMultipark ? newDurations.multiparkDurationMinutes : booking.multiparkDurationMinutes || null,
        apiBookingNumber: newApiBookingNumber || null,
        previousApiBookingNumber: oldApiBookingNumber || null,
        apiSuccess: shouldUseMultipark ? true : booking.apiSuccess,
        apiMessage: shouldUseMultipark ? createResult?.message || "Rezervarea a fost recreată în Multipark." : booking.apiMessage,
        apiErrorCode: null,
        apiRequestPayload: shouldUseMultipark ? createResult?.apiPayload || "" : booking.apiRequestPayload || "",
        apiResponseRaw: shouldUseMultipark ? createResult?.apiResponse || "" : booking.apiResponseRaw || "",
        apiRequestTimestamp: FieldValue.serverTimestamp(),
        modificationRequested: false,
        modificationApplying: false,
        modificationRecoveryRequired: false,
        activeModificationRequestId: null,
        activeModificationRequest: {
          id: requestId,
          status: "completed",
          currentAmount: Number(request.currentAmount || 0),
          newAmount,
          amountToPay,
          creditAmount,
          difference,
          paymentPolicy: paymentPolicy || null,
          payOnSiteLocalOnly,
          modificationEmailStatus: "pending",
          completedAtIso: new Date().toISOString(),
        },
        lastModificationRequestId: requestId,
        lastModifiedAt: FieldValue.serverTimestamp(),
        lastModifiedBy: options.actorEmail || options.reason,
        lastMultiparkUpdateStatus: shouldUseMultipark ? "recreated" : multiparkSkippedStatus,
        lastPriceDifference: difference,
        modificationHistory: FieldValue.arrayUnion({
          requestId,
          status: "completed",
          reason: options.reason,
          paymentOrderId: options.paymentOrderId || null,
          oldValues,
          newValues: finalValues,
          oldApiBookingNumber: oldApiBookingNumber || null,
          newApiBookingNumber: newApiBookingNumber || null,
          oldAmount: Number(request.currentAmount || 0),
          newAmount,
          difference,
          creditAmount,
          amountToPay,
          paymentPolicy: paymentPolicy || null,
          payOnSiteLocalOnly,
          modificationEmailStatus: "pending",
          modificationEmailSentAtIso: null,
          modificationEmailError: null,
          modificationEmailMessageId: null,
          modificationEmailQrIncluded: null,
          multipark: {
            oldCancel: cancelResult
              ? summarizeMultiparkResult(cancelResult)
              : null,
            newCreate: createResult
              ? summarizeMultiparkResult(createResult)
              : null,
          },
          atIso: new Date().toISOString(),
        }),
        lastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    tx.set(
      requestRef,
      {
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        appliedBy: options.actorEmail || options.reason,
        paymentOrderId: options.paymentOrderId || null,
        oldApiBookingNumber: oldApiBookingNumber || null,
        newApiBookingNumber: newApiBookingNumber || null,
        multiparkStatus: shouldUseMultipark ? "recreated" : multiparkSkippedStatus,
        oldMultiparkCancelResult: summarizeMultiparkResult(cancelResult),
        newMultiparkCreateResult: summarizeMultiparkResult(createResult),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  })

  await recordBookingModificationAuditEvent(requestId, "firestore_booking_updated", "success", {
    bookingId,
    apiBookingNumber: newApiBookingNumber || null,
    userId: String(request.userId || "") || null,
    orderId: options.paymentOrderId || null,
    amountToPay,
    creditAmount,
    difference,
    multiparkStatus: shouldUseMultipark ? "recreated" : multiparkSkippedStatus,
    extra: {
      paymentPolicy: paymentPolicy || null,
      payOnSiteLocalOnly,
    },
    message: "Rezervarea a fost actualizată în Firestore.",
  })

  if (!payOnSiteLocalOnly && creditAmount > 0 && request.userId) {
    await addUserCredit({
      userId: String(request.userId),
      amount: creditAmount,
      source: "booking_modification_decrease",
      bookingId,
      modificationRequestId: requestId,
      message: "Diferență rămasă avans după modificarea rezervării.",
    })
    await recordBookingModificationAuditEvent(requestId, "credit_created", "success", {
      bookingId,
      apiBookingNumber: newApiBookingNumber || null,
      userId: String(request.userId),
      creditAmount,
      difference,
      message: "Diferența negativă a fost adăugată ca avans pentru următoarea rezervare.",
    })
  }

  await sendModificationConfirmationEmailBestEffort({
    bookingId,
    requestId,
    booking,
    oldValues,
    finalValues,
    oldAmount: Number(request.currentAmount || 0),
    newAmount,
    difference,
    amountToPay,
    creditAmount,
    oldApiBookingNumber,
    newApiBookingNumber: newApiBookingNumber || null,
    payOnSiteLocalOnly,
    days: newDurations.days,
    userId: String(request.userId || "") || null,
    orderId: options.paymentOrderId || null,
  })

  console.info("[booking-modification] completed", {
    modificationRequestId: requestId,
    bookingId,
    oldApiBookingNumber: oldApiBookingNumber || null,
    newApiBookingNumber: newApiBookingNumber || null,
    amountToPay,
    creditAmount,
    difference,
  })

  return {
    success: true,
    status: "completed" as const,
    bookingId,
    bookingNumber: newApiBookingNumber || null,
    creditAmount,
    amountToPay,
  }
}
