import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"

export type OblioErrorKind = "timeout" | "auth_503" | "auth_other" | "invoice_error"
export type OblioFailureSource = "auto" | "manual"

const ALERT_WINDOW_MINUTES = 5
const ALERT_THRESHOLD = 3
const AUTO_RESOLVE_QUIET_MINUTES = 30

export function classifyOblioError(message: string): OblioErrorKind {
  const normalized = String(message || "").toLowerCase()

  if (normalized.includes("oblio timeout")) return "timeout"
  if (normalized.includes("503") && (normalized.includes("auth") || normalized.includes("authenticate"))) {
    return "auth_503"
  }
  if (normalized.includes("auth") || normalized.includes("authenticate")) return "auth_other"
  return "invoice_error"
}

function toDate(value: any): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value?.toDate === "function") {
    const converted = value.toDate()
    return Number.isNaN(converted.getTime()) ? null : converted
  }
  if (typeof value === "string" || typeof value === "number") {
    const converted = new Date(value)
    return Number.isNaN(converted.getTime()) ? null : converted
  }
  return null
}

type RecordOblioFailureInput = {
  bookingId?: string
  bookingOrigin?: string
  source: OblioFailureSource
  message: string
  errorKind?: OblioErrorKind
}

export async function recordOblioFailure(input: RecordOblioFailureInput): Promise<{
  kind: OblioErrorKind
  recentFailures: number
  alertOpened: boolean
}> {
  const now = new Date()
  const message = String(input.message || "").slice(0, 3000)
  const kind = input.errorKind || classifyOblioError(message)

  try {
    await adminDb.collection("oblio_alert_events").add({
      createdAt: FieldValue.serverTimestamp(),
      eventAt: now,
      kind,
      bookingId: input.bookingId || null,
      bookingOrigin: input.bookingOrigin || null,
      source: input.source,
      message,
    })

    const windowStart = new Date(now.getTime() - ALERT_WINDOW_MINUTES * 60 * 1000)
    const recentFailuresSnapshot = await adminDb
      .collection("oblio_alert_events")
      .where("eventAt", ">=", windowStart)
      .get()
    const recentFailures = recentFailuresSnapshot.size

    if (recentFailures >= ALERT_THRESHOLD) {
      const alertRef = adminDb.collection("ops_alerts").doc("oblio")
      const existingAlert = await alertRef.get()
      const wasOpen = existingAlert.exists && String((existingAlert.data() as any)?.status || "") === "open"

      const payload: Record<string, any> = {
        status: "open",
        lastEventAt: now,
        windowMinutes: ALERT_WINDOW_MINUTES,
        threshold: ALERT_THRESHOLD,
        lastCountInWindow: recentFailures,
        lastErrorKind: kind,
        lastErrorSample: message,
        resolvedAt: null,
        resolveReason: null,
        lastUpdated: FieldValue.serverTimestamp(),
      }

      if (!wasOpen) {
        payload.openedAt = FieldValue.serverTimestamp()
      }

      await alertRef.set(payload, { merge: true })
      return { kind, recentFailures, alertOpened: !wasOpen }
    }

    return { kind, recentFailures, alertOpened: false }
  } catch (error) {
    console.error("❌ Failed to record Oblio failure alert event", error)
    return { kind, recentFailures: 0, alertOpened: false }
  }
}

export async function autoResolveOblioAlert(nowInput: Date = new Date()): Promise<{
  resolved: boolean
  reason: string
}> {
  try {
    const alertRef = adminDb.collection("ops_alerts").doc("oblio")
    const alertSnap = await alertRef.get()

    if (!alertSnap.exists) {
      return { resolved: false, reason: "alert_missing" }
    }

    const data: any = alertSnap.data()
    if (String(data?.status || "") !== "open") {
      return { resolved: false, reason: "not_open" }
    }

    const lastEventAt = toDate(data?.lastEventAt) || toDate(data?.lastUpdated) || toDate(data?.openedAt)
    if (!lastEventAt) {
      return { resolved: false, reason: "missing_last_event_time" }
    }

    const quietPeriodMs = nowInput.getTime() - lastEventAt.getTime()
    if (quietPeriodMs < AUTO_RESOLVE_QUIET_MINUTES * 60 * 1000) {
      return { resolved: false, reason: "quiet_period_not_elapsed" }
    }

    await alertRef.update({
      status: "resolved",
      resolvedAt: FieldValue.serverTimestamp(),
      resolveReason: "quiet_period_30m",
      lastUpdated: FieldValue.serverTimestamp(),
    })

    return { resolved: true, reason: "quiet_period_30m" }
  } catch (error) {
    console.error("❌ Failed to auto-resolve Oblio alert", error)
    return { resolved: false, reason: "auto_resolve_error" }
  }
}
