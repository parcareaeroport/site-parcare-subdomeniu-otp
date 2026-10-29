import { parseCameraTime } from "./lpr-camera-config.server"
import { lprTimestampToMillis } from "./lpr-presence"

// A rejected clock must not become trustworthy merely because time has passed.
const INVALID_REASONS = new Set([
  "missing_plate", "invalid_event_time", "unknown_direction", "future_event_time",
  "stale_event_time", "invalid_pending_event",
])
const TERMINAL_STATUSES = new Set([
  "needs_review", "reviewed", "matched", "unmatched_visit", "duplicate", "whitelist_skip", "manual",
])

export function isLaterKnownExit(receipt: any, entryMs: number, nowMs: number, includePending = false): boolean {
  if (receipt.eventType !== "exit" ||
      !(TERMINAL_STATUSES.has(receipt.associationStatus) || includePending && receipt.associationStatus === "pending") ||
      INVALID_REASONS.has(receipt.associationReason) || INVALID_REASONS.has(receipt.review?.reason)) return false
  // Older manual receipts use the same Romania civil-clock convention, but did
  // not have eventTime. Never apply that fallback to an unknown camera clock.
  const rawTime = receipt.eventTime ?? (receipt.manual === true ? receipt.accurateTime ?? receipt.snapTime : null)
  const at = parseCameraTime(rawTime, "romania_wall_clock")
  return at !== null && Date.parse(at) >= entryMs && Math.floor(Date.parse(at) / 1000) <= Math.floor(nowMs / 1000)
}

export function isBeforePlateCorrection(state: any, entryMs: number): boolean {
  const through = lprTimestampToMillis(state?.plateCorrection?.through)
  // Manual corrections have second precision, so that whole second is ambiguous.
  return through !== null && Math.floor(entryMs / 1000) <= Math.floor(through / 1000)
}
