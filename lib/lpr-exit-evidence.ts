import { getLprPresenceState, lprTimestampToMillis } from "./lpr-presence"
import { isTrustedLprReceipt } from "./lpr-entry-evidence"
import { compareLprTimes, lprTime, normalizeLprEventType, receiptLprTime, type LprTime } from "./lpr-time"

/** Shared camera/manual/retry gate. Call after transactionally reading the plate's
 * receipts AND pointer. A receipt still awaiting association is evidence too. */
export function lprExitConflict(input: { bookingId: string; booking: any; state: any; receipts: any[]; at: LprTime; manual?: boolean }): string | null {
  const { bookingId, booking, state, receipts, at } = input
  const lpr = booking.lpr || {}, inside = getLprPresenceState(booking).isEffectivelyInside
  const precision = input.manual ? 1000 : 1
  if (normalizeLprEventType(lpr.lastEventType) === "entry" && lprTimestampToMillis(lpr.lastSeenAt) !== null) {
    const order = compareLprTimes(at, lprTime(lpr.lastSeenAt, lpr.lastSeenAtInstant), precision)
    if (order === null) return "ambiguous_exit_order"
    if (order === -1) return "exit_before_last_entry"
  }
  if (!inside) return null // Historical corrections are bounded separately by subsequent visits.
  if (state?.bookingId === bookingId) {
    if ((state.visitId ?? null) !== (lpr.visitId ?? null) || state.isInside === false || normalizeLprEventType(state.lastEventType) === "exit") return "inconsistent_visit_state"
    if (lprTimestampToMillis(state.lastEventAt) !== null) {
      const pointerTime = lprTime(state.lastEventAt, state.lastEventAtInstant)
      const beforePointer = compareLprTimes(at, pointerTime, precision)
      if (beforePointer === null) return "ambiguous_exit_order"
      if (beforePointer === -1) return "inconsistent_visit_state"
      if (lprTimestampToMillis(lpr.lastSeenAt) !== null && compareLprTimes(pointerTime, lprTime(lpr.lastSeenAt, lpr.lastSeenAtInstant)) !== 0) return "inconsistent_visit_state"
    }
  }
  for (const r of receipts) {
    if (normalizeLprEventType(r.eventType) !== "entry" || !isTrustedLprReceipt(r)) continue
    const order = compareLprTimes(receiptLprTime(r), at, precision)
    if (order === null) return "ambiguous_exit_order"
    // Equality is only safe at manual second precision for an entry already
    // attached to this visit. An unassociated simultaneous entry is ambiguous.
    if (order === 0 && (r.matchedBookingId !== bookingId || r.visitId && r.visitId !== lpr.visitId || ["pending", "needs_review", "reviewed"].includes(r.associationStatus))) return "ambiguous_exit_order"
    if (order === 1) return "later_entry_requires_review"
  }
  return null
}
