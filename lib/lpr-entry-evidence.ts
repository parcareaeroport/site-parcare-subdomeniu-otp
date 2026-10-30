import { parseCameraTime } from "./lpr-camera-config.server"
import { lprTimestampToMillis } from "./lpr-presence"
import { compareLprTimes, lprTime, receiptLprTime, type LprTime } from "./lpr-time"

// A rejected clock must not become trustworthy merely because time has passed.
const INVALID_REASONS = new Set([
  "missing_plate", "invalid_event_time", "unknown_direction", "future_event_time",
  "stale_event_time", "invalid_pending_event", "invalid_clock_offset_config",
])
const TERMINAL_STATUSES = new Set([
  "needs_review", "reviewed", "matched", "unmatched_visit", "duplicate", "whitelist_skip", "manual",
])

export function isTrustedLprReceipt(receipt: any, includePending = true): boolean {
  return !receipt.supersededBy &&
    (TERMINAL_STATUSES.has(receipt.associationStatus) || includePending && receipt.associationStatus === "pending") &&
    !INVALID_REASONS.has(receipt.associationReason) && !INVALID_REASONS.has(receipt.review?.reason)
}

export function isLaterKnownExit(receipt: any, entryMs: number, nowMs: number, includePending = false, entryPoint?: LprTime, nowPoint?: LprTime): boolean {
  if (receipt.eventType !== "exit" || !isTrustedLprReceipt(receipt, includePending)) return false
  const point = receiptLprTime(receipt)
  // Includes proven legacy linked camera receipts, never an unknown raw clock.
  const at = parseCameraTime(point.wall, "romania_wall_clock")
  if (!at) return false
  const after = compareLprTimes(point, entryPoint || lprTime(entryMs))
  const future = compareLprTimes(point, nowPoint || lprTime(nowMs), 1000)
  return after !== -1 && future !== 1
}

export function isBeforePlateCorrection(state: any, entryMs: number, point?: LprTime): boolean {
  const through = lprTimestampToMillis(state?.plateCorrection?.through)
  // Manual corrections have second precision, so that whole second is ambiguous.
  return through !== null && compareLprTimes(point || lprTime(entryMs), lprTime(through, state.plateCorrection?.throughInstant), 1000) !== 1
}
