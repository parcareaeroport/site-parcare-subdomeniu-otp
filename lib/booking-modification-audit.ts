import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"

type AuditStatus = "info" | "success" | "warning" | "failed"

type AuditMetadata = {
  bookingId?: string | null
  apiBookingNumber?: string | null
  userId?: string | null
  orderId?: string | null
  amountToPay?: number | null
  creditAmount?: number | null
  difference?: number | null
  multiparkStatus?: string | null
  message?: string | null
  extra?: Record<string, unknown>
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  )
}

export async function recordBookingModificationAuditEvent(
  modificationRequestId: string | undefined | null,
  step: string,
  status: AuditStatus,
  metadata: AuditMetadata = {}
) {
  if (!modificationRequestId) return

  const event = compact({
    step,
    status,
    bookingId: metadata.bookingId || null,
    apiBookingNumber: metadata.apiBookingNumber || null,
    userId: metadata.userId || null,
    orderId: metadata.orderId || null,
    amountToPay: metadata.amountToPay ?? null,
    creditAmount: metadata.creditAmount ?? null,
    difference: metadata.difference ?? null,
    multiparkStatus: metadata.multiparkStatus || null,
    message: metadata.message || null,
    extra: metadata.extra || undefined,
    atIso: new Date().toISOString(),
  })

  try {
    await adminDb.collection("bookingModificationRequests").doc(modificationRequestId).set(
      {
        auditEvents: FieldValue.arrayUnion(event),
        lastAuditStep: step,
        lastAuditStatus: status,
        lastAuditAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
  } catch (error) {
    console.warn("[booking-modification-audit] Failed to record audit event", {
      modificationRequestId,
      step,
      status,
      message: error instanceof Error ? error.message : "Unknown error",
    })
  }
}
