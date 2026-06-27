import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { checkAvailability, checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { updateMultiparkBooking } from "@/lib/multipark-booking-update"
import { addUserCredit } from "@/lib/user-credits"
import { normalizeLicensePlate } from "@/lib/utils"
import { recordBookingModificationAuditEvent } from "@/lib/booking-modification-audit"

export type BookingModificationStatus =
  | "pending_admin_review"
  | "rejected"
  | "awaiting_difference_payment"
  | "approved_applying"
  | "completed"
  | "failed"
  | "refund_required"

type ModificationValues = {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  licensePlate: string
}

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

async function failRequest(
  requestId: string,
  status: "failed" | "refund_required",
  message: string,
  extra?: Record<string, unknown>
) {
  console.error("[booking-modification] modification_failed", {
    modificationRequestId: requestId,
    status,
    message,
    ...(extra || {}),
  })
  await adminDb.collection("bookingModificationRequests").doc(requestId).set(
    {
      status,
      failureMessage: message,
      ...(extra || {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
  await recordBookingModificationAuditEvent(
    requestId,
    status === "refund_required" ? "refund_required" : "failed",
    "failed",
    {
      message,
      multiparkStatus: typeof extra?.multiparkStatus === "string" ? extra.multiparkStatus : null,
      extra,
    }
  )
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
  console.info("[booking-modification] modification_reject_requested", {
    modificationRequestId: requestId,
    bookingId,
    actorEmail: actorEmail || null,
    reason: reason || null,
    previousStatus: request.status || null,
  })

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
  console.info("[booking-modification] modification_rejected", {
    modificationRequestId: requestId,
    bookingId,
    actorEmail: actorEmail || null,
  })
}

export async function approveBookingModificationRequest(
  requestId: string,
  actorEmail?: string | null
) {
  const requestRef = adminDb.collection("bookingModificationRequests").doc(requestId)
  const requestSnap = await requestRef.get()
  if (!requestSnap.exists) throw new Error("Cererea de modificare nu există.")
  const request = requestSnap.data() || {}
  const status = String(request.status || "")
  const bookingId = String(request.bookingId || "")
  console.info("[booking-modification] modification_approve_requested", {
    modificationRequestId: requestId,
    bookingId,
    actorEmail: actorEmail || null,
    previousStatus: status,
    amountToPay: Number(request.amountToPay || 0),
    creditAmount: Number(request.creditAmount || 0),
    difference: Number(request.difference || 0),
  })
  if (!["pending_admin_review", "failed"].includes(status)) {
    throw new Error(`Cererea nu poate fi aprobată din statusul ${status}.`)
  }

  const amountToPay = roundMoney(Number(request.amountToPay || 0))
  await recordBookingModificationAuditEvent(requestId, "admin_approved", "info", {
    bookingId,
    userId: String(request.userId || "") || null,
    apiBookingNumber: String(request.currentSnapshot?.apiBookingNumber || "") || null,
    amountToPay,
    creditAmount: Number(request.creditAmount || 0),
    difference: Number(request.difference || 0),
    message: "Admin a aprobat cererea de modificare.",
  })
  if (amountToPay > 0) {
    await requestRef.set(
      {
        status: "awaiting_difference_payment",
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: actorEmail || null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    await adminDb.collection("bookings").doc(String(request.bookingId)).set(
      {
        activeModificationRequest: {
          id: requestId,
          status: "awaiting_difference_payment",
          amountToPay,
          creditAmount: Number(request.creditAmount || 0),
          difference: Number(request.difference || 0),
          finalValues: request.finalValues || null,
        },
        lastUpdated: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    await recordBookingModificationAuditEvent(requestId, "awaiting_payment", "info", {
      bookingId,
      userId: String(request.userId || "") || null,
      apiBookingNumber: String(request.currentSnapshot?.apiBookingNumber || "") || null,
      amountToPay,
      creditAmount: Number(request.creditAmount || 0),
      difference: Number(request.difference || 0),
      message: "Admin a aprobat cererea; clientul trebuie să plătească diferența.",
    })
    console.info("[booking-modification] modification_awaiting_difference_payment", {
      modificationRequestId: requestId,
      bookingId,
      amountToPay,
      actorEmail: actorEmail || null,
    })
    return { success: true, status: "awaiting_difference_payment" as const, amountToPay }
  }

  return applyBookingModificationRequest(requestId, {
    actorEmail,
    reason: "admin_approved",
  })
}

export async function applyBookingModificationRequest(
  requestId: string,
  options: {
    actorEmail?: string | null
    reason: "admin_approved" | "difference_payment_paid" | "retry"
    paymentOrderId?: string
  }
) {
  const requestRef = adminDb.collection("bookingModificationRequests").doc(requestId)
  const requestSnap = await requestRef.get()
  if (!requestSnap.exists) throw new Error("Cererea de modificare nu există.")
  const request = requestSnap.data() || {}
  const bookingId = String(request.bookingId || "")
  if (!bookingId) throw new Error("Cererea nu are bookingId.")
  console.info("[booking-modification] modification_apply_started", {
    modificationRequestId: requestId,
    bookingId,
    reason: options.reason,
    actorEmail: options.actorEmail || null,
    paymentOrderId: options.paymentOrderId || null,
    previousStatus: request.status || null,
    amountToPay: Number(request.amountToPay || 0),
    creditAmount: Number(request.creditAmount || 0),
    difference: Number(request.difference || 0),
  })

  const bookingRef = adminDb.collection("bookings").doc(bookingId)
  const bookingSnap = await bookingRef.get()
  if (!bookingSnap.exists) throw new Error("Rezervarea nu există.")
  const booking = bookingSnap.data() || {}
  const apiBookingNumber = String(booking.apiBookingNumber || "")
  await recordBookingModificationAuditEvent(requestId, "apply_started", "info", {
    bookingId,
    userId: String(request.userId || "") || null,
    apiBookingNumber: apiBookingNumber || null,
    orderId: options.paymentOrderId || null,
    amountToPay: Number(request.amountToPay || 0),
    creditAmount: Number(request.creditAmount || 0),
    difference: Number(request.difference || 0),
    message: "Aplicarea modificării a început.",
  })

  const status = String(request.status || "")
  if (!["pending_admin_review", "awaiting_difference_payment", "failed"].includes(status)) {
    throw new Error(`Cererea nu poate fi aplicată din statusul ${status}.`)
  }

  const amountToPay = roundMoney(Number(request.amountToPay || 0))
  if (amountToPay > 0 && options.reason !== "difference_payment_paid") {
    console.warn("[booking-modification] modification_apply_blocked", {
      modificationRequestId: requestId,
      bookingId,
      reason: "difference_payment_required",
      amountToPay,
    })
    throw new Error("Cererea necesită plata diferenței înainte de aplicare.")
  }

  const currentStartMs = parseDateTime(String(booking.startDate || ""), String(booking.startTime || ""))
  if (Number.isNaN(currentStartMs) || currentStartMs - Date.now() < 24 * 60 * 60 * 1000) {
    console.warn("[booking-modification] modification_revalidation_failed", {
      modificationRequestId: requestId,
      bookingId,
      check: "lead_time_24h",
      startDate: booking.startDate || null,
      startTime: booking.startTime || null,
    })
    throw new Error("Rezervarea poate fi modificată doar cu minimum 24h înainte de intrare.")
  }
  console.info("[booking-modification] modification_revalidation_passed", {
    modificationRequestId: requestId,
    bookingId,
    check: "lead_time_24h",
  })

  const finalValues = request.finalValues as ModificationValues | undefined
  if (!finalValues?.startDate || !finalValues?.startTime || !finalValues?.endDate || !finalValues?.endTime || !finalValues?.licensePlate) {
    throw new Error("Cererea de modificare nu are valorile finale complete.")
  }
  finalValues.licensePlate = normalizeLicensePlate(finalValues.licensePlate)

  const startMs = parseDateTime(finalValues.startDate, finalValues.startTime)
  const endMs = parseDateTime(finalValues.endDate, finalValues.endTime)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    console.warn("[booking-modification] modification_revalidation_failed", {
      modificationRequestId: requestId,
      bookingId,
      check: "new_interval",
      finalValues,
    })
    throw new Error("Intervalul nou este invalid.")
  }
  console.info("[booking-modification] modification_revalidation_passed", {
    modificationRequestId: requestId,
    bookingId,
    check: "new_interval",
    finalValues,
  })

  console.info("[booking-modification] modification_revalidation_started", {
    modificationRequestId: requestId,
    bookingId,
    check: "availability",
    startDate: finalValues.startDate,
    startTime: finalValues.startTime,
    endDate: finalValues.endDate,
    endTime: finalValues.endTime,
  })
  const availability = await checkAvailability(
    finalValues.startDate,
    finalValues.startTime,
    finalValues.endDate,
    finalValues.endTime,
    { excludeBookingId: bookingId }
  )
  if (!availability.available) {
    console.warn("[booking-modification] modification_revalidation_failed", {
      modificationRequestId: requestId,
      bookingId,
      check: "availability",
    })
    throw new Error("Nu sunt locuri disponibile pentru noua perioadă.")
  }
  console.info("[booking-modification] modification_revalidation_passed", {
    modificationRequestId: requestId,
    bookingId,
    check: "availability",
  })

  console.info("[booking-modification] modification_revalidation_started", {
    modificationRequestId: requestId,
    bookingId,
    check: "duplicate_license_plate",
    licensePlate: finalValues.licensePlate,
  })
  const duplicate = await checkExistingReservationByLicensePlate(
    finalValues.licensePlate,
    finalValues.startDate,
    finalValues.endDate,
    finalValues.startTime,
    finalValues.endTime,
    { excludeBookingId: bookingId }
  )
  if (duplicate.exists) {
    console.warn("[booking-modification] modification_revalidation_failed", {
      modificationRequestId: requestId,
      bookingId,
      check: "duplicate_license_plate",
      licensePlate: finalValues.licensePlate,
    })
    throw new Error("Există deja o rezervare activă pentru această mașină în noua perioadă.")
  }
  console.info("[booking-modification] modification_revalidation_passed", {
    modificationRequestId: requestId,
    bookingId,
    check: "duplicate_license_plate",
    licensePlate: finalValues.licensePlate,
  })

  await requestRef.set(
    {
      status: "approved_applying",
      applyingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )

  const durations = computeDurations(finalValues)
  const shouldUpdateMultipark =
    Boolean(booking.apiBookingNumber) && String(booking.source || "") !== "pay_on_site"
  let multiparkStatus = "skipped_no_api_booking_number"
  let multiparkResult: Record<string, unknown> | null = null

  if (shouldUpdateMultipark) {
    console.info("[booking-modification] multipark_update_started", {
      modificationRequestId: requestId,
      bookingId,
      apiBookingNumber: booking.apiBookingNumber,
      licensePlate: finalValues.licensePlate,
      startDate: finalValues.startDate,
      startTime: finalValues.startTime,
      durationMinutes: durations.multiparkDurationMinutes,
    })
    await recordBookingModificationAuditEvent(requestId, "multipark_update_started", "info", {
      bookingId,
      apiBookingNumber,
      userId: String(request.userId || "") || null,
      orderId: options.paymentOrderId || null,
      amountToPay,
      creditAmount: Number(request.creditAmount || 0),
      difference: Number(request.difference || 0),
      message: "Se trimite modificarea către Multipark.",
    })
    const result = await updateMultiparkBooking({
      bookingNumber: String(booking.apiBookingNumber),
      licensePlate: finalValues.licensePlate,
      startDate: finalValues.startDate,
      startTime: finalValues.startTime,
      durationMinutes: durations.multiparkDurationMinutes,
      clientName: String(booking.clientName || ""),
      clientTitle: String(booking.clientTitle || ""),
    })
    multiparkStatus = result.success ? "success" : "failed"
    multiparkResult = result
    console.info("[booking-modification] multipark_update_finished", {
      modificationRequestId: requestId,
      bookingId,
      apiBookingNumber: booking.apiBookingNumber,
      success: result.success,
      httpStatus: result.httpStatus || null,
      apiErrorCode: result.apiErrorCode || null,
      message: result.message,
    })
    await recordBookingModificationAuditEvent(
      requestId,
      result.success ? "multipark_update_succeeded" : "multipark_update_failed",
      result.success ? "success" : "failed",
      {
        bookingId,
        apiBookingNumber,
        userId: String(request.userId || "") || null,
        orderId: options.paymentOrderId || null,
        amountToPay,
        creditAmount: Number(request.creditAmount || 0),
        difference: Number(request.difference || 0),
        multiparkStatus,
        message: result.message,
        extra: {
          httpStatus: result.httpStatus || null,
          apiErrorCode: result.apiErrorCode || null,
        },
      }
    )

    if (!result.success) {
      const failedStatus = options.reason === "difference_payment_paid" ? "refund_required" : "failed"
      await failRequest(requestId, failedStatus, result.message, {
        multiparkStatus,
        multiparkResult,
        refundRequiredAmount: options.reason === "difference_payment_paid" ? amountToPay : 0,
      })
      await bookingRef.set(
        {
          activeModificationRequest: {
            id: requestId,
            status: failedStatus,
            amountToPay,
            refundRequiredAmount: options.reason === "difference_payment_paid" ? amountToPay : 0,
            difference: Number(request.difference || 0),
          },
          lastMultiparkUpdateStatus: multiparkStatus,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      console.error("[booking-modification] modification_refund_required", {
        modificationRequestId: requestId,
        bookingId,
        apiBookingNumber: booking.apiBookingNumber,
        refundRequired: failedStatus === "refund_required",
        refundRequiredAmount: options.reason === "difference_payment_paid" ? amountToPay : 0,
        message: result.message,
      })
      return { success: false, status: failedStatus, message: result.message }
    }
  } else {
    console.info("[booking-modification] multipark_update_skipped", {
      modificationRequestId: requestId,
      bookingId,
      apiBookingNumber: booking.apiBookingNumber || null,
      source: booking.source || null,
      reason: booking.apiBookingNumber ? "pay_on_site" : "missing_api_booking_number",
    })
    await recordBookingModificationAuditEvent(requestId, "multipark_update_skipped", "info", {
      bookingId,
      apiBookingNumber: apiBookingNumber || null,
      userId: String(request.userId || "") || null,
      orderId: options.paymentOrderId || null,
      multiparkStatus,
      message: "Modificarea nu a fost trimisă către Multipark pentru această rezervare.",
    })
  }

  const newAmount = roundMoney(Number(request.newAmount || booking.amount || 0))
  const creditAmount = roundMoney(Number(request.creditAmount || 0))

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
        days: durations.days,
        durationMinutes: durations.durationMinutes,
        multiparkDurationMinutes: shouldUpdateMultipark ? durations.multiparkDurationMinutes : booking.multiparkDurationMinutes || null,
        modificationRequested: false,
        activeModificationRequestId: null,
        activeModificationRequest: {
          id: requestId,
          status: "completed",
          amountToPay,
          creditAmount,
          difference: Number(request.difference || 0),
          completedAtIso: new Date().toISOString(),
        },
        lastModificationRequestId: requestId,
        lastModifiedAt: FieldValue.serverTimestamp(),
        lastModifiedBy: options.actorEmail || options.reason,
        lastMultiparkUpdateStatus: multiparkStatus,
        lastPriceDifference: Number(request.difference || 0),
        modificationHistory: FieldValue.arrayUnion({
          requestId,
          status: "completed",
          reason: options.reason,
          paymentOrderId: options.paymentOrderId || null,
          oldValues: request.currentSnapshot || null,
          newValues: finalValues,
          oldAmount: Number(request.currentAmount || 0),
          newAmount,
          difference: Number(request.difference || 0),
          creditAmount,
          amountToPay,
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
        multiparkStatus,
        multiparkResult,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  })
  console.info("[booking-modification] modification_firestore_updated", {
    modificationRequestId: requestId,
    bookingId,
    apiBookingNumber: booking.apiBookingNumber || null,
    newAmount,
    creditAmount,
    amountToPay,
    multiparkStatus,
  })
  await recordBookingModificationAuditEvent(requestId, "booking_updated", "success", {
    bookingId,
    apiBookingNumber: apiBookingNumber || null,
    userId: String(request.userId || "") || null,
    orderId: options.paymentOrderId || null,
    amountToPay,
    creditAmount,
    difference: Number(request.difference || 0),
    multiparkStatus,
    message: "Rezervarea a fost actualizată în Firestore.",
  })

  if (creditAmount > 0 && request.userId) {
    await addUserCredit({
      userId: String(request.userId),
      amount: creditAmount,
      source: "booking_modification_decrease",
      bookingId,
      modificationRequestId: requestId,
      message: "Diferență rămasă avans după modificarea rezervării.",
    })
    console.info("[booking-modification] modification_credit_created", {
      modificationRequestId: requestId,
      bookingId,
      userId: String(request.userId),
      creditAmount,
    })
    await recordBookingModificationAuditEvent(requestId, "credit_created", "success", {
      bookingId,
      apiBookingNumber: apiBookingNumber || null,
      userId: String(request.userId),
      creditAmount,
      difference: Number(request.difference || 0),
      message: "Diferența negativă a fost adăugată ca avans pentru următoarea rezervare.",
    })
  }

  console.info("[booking-modification] modification_completed", {
    modificationRequestId: requestId,
    bookingId,
    apiBookingNumber: booking.apiBookingNumber || null,
    creditAmount,
    amountToPay,
    multiparkStatus,
  })
  return { success: true, status: "completed" as const, bookingId, creditAmount }
}
