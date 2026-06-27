import { db, doc, serverTimestamp, setDoc, updateDoc } from "@/lib/server-firestore"

type PaymentAuditStep =
  | "init_received"
  | "amount_overridden"
  | "netopia_session_created"
  | "netopia_session_failed"
  | "ipn_received"
  | "booking_started"
  | "booking_completed"
  | "booking_failed"
  | "oblio_started"
  | "oblio_succeeded"
  | "oblio_failed"

type PaymentAuditStatus = "info" | "success" | "failed"

type PaymentAuditEvent = {
  status: PaymentAuditStatus
  message: string
  provider?: string
  orderId?: string
  userId?: string
  bookingId?: string
  bookingNumber?: string
  paymentTestMode?: boolean
  realAmount?: number
  chargedAmount?: number
  extra?: Record<string, unknown>
}

function sanitizeAuditValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeAuditValue(item))
      .filter((item) => item !== undefined) as T
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, sanitizeAuditValue(entryValue)])

    return Object.fromEntries(entries) as T
  }

  return value
}

export async function recordPaymentAuditEvent(
  orderId: string,
  step: PaymentAuditStep,
  event: PaymentAuditEvent
) {
  if (!orderId) return

  const ref = doc(db, "paymentAudit", orderId)
  const sanitizedEvent = sanitizeAuditValue({
    ...event,
    step,
    loggedAtIso: new Date().toISOString(),
    loggedAt: serverTimestamp(),
  })

  try {
    await setDoc(
      ref,
      sanitizeAuditValue({
        orderId,
        provider: event.provider,
        userId: event.userId,
        paymentTestMode: event.paymentTestMode,
        realAmount: event.realAmount,
        chargedAmount: event.chargedAmount,
        latestStep: step,
        latestStatus: event.status,
        latestMessage: event.message,
        latestUpdatedAtIso: new Date().toISOString(),
        latestUpdatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }),
      { merge: true }
    )

    await updateDoc(ref, {
      [`steps.${step}`]: sanitizedEvent,
    })
  } catch (error) {
    console.error("[payment-audit] Failed to record audit event", {
      orderId,
      step,
      message: event.message,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
