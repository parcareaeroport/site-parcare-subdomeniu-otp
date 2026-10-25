import { getLprPresenceState, lprTimestampToMillis, type LprPresenceInput } from "./lpr-presence"

export const LPR_ADMIN_REVIEW_LABEL = "Necesită verificare ADMIN"

/** Informational only: never changes presence, billing records or association. */
export function lprAdminReviewReason(booking: LprPresenceInput & {
  startDate?: string; startTime?: string; endDate?: string; endTime?: string
}): string | undefined {
  if (!getLprPresenceState(booking).isEffectivelyInside) return undefined
  const lpr = booking.lpr || {}
  const entry = String(lpr.lastEventType || "").toLowerCase().includes("entry")
    ? lprTimestampToMillis(lpr.lastSeenAt) ?? lprTimestampToMillis(lpr.arrivedAt)
    : lprTimestampToMillis(lpr.arrivedAt)
  const departure = lprTimestampToMillis(lpr.departedAt)
  if (entry !== null && departure !== null && entry > departure) {
    return "Există o intrare după ieșirea salvată pe același document. Verifică rezervarea aferentă șederii actuale înainte de calcularea sumei."
  }
  // Match the existing entries/exits convention: camera-local clock stored with Z.
  const wallTime = (date?: string, time?: string) => {
    if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
    const iso = `${date}T${time}:00.000Z`
    const ms = Date.parse(iso)
    return Number.isFinite(ms) && new Date(ms).toISOString() === iso ? ms : null
  }
  const start = wallTime(booking.startDate, booking.startTime)
  const end = wallTime(booking.endDate, booking.endTime)
  const tolerance = 120 * 60_000
  if (entry !== null && start !== null && end !== null && start < end &&
      (entry < start - tolerance || entry > end + tolerance)) {
    return "Intrarea LPR este în afara perioadei rezervării, inclusiv toleranța de două ore. Verifică asocierea înainte de calcularea sumei."
  }
  return undefined
}
