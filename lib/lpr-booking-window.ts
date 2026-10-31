export const LPR_ACTIVE_STATUSES = ["confirmed_paid", "confirmed_test", "confirmed", "paid", "confirmed_pay_on_site"]
export const LPR_TOLERANCE_MS = 120 * 60_000

function bookingClockMillis(date: unknown, time: unknown): number | null {
  if (typeof date !== "string" || typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null
  const iso = `${date}T${time.length === 5 ? time + ":00" : time}.000Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) && new Date(ms).toISOString() === iso ? ms : null
}

/** Camera and admin use the same booking window. Preserve the legacy Romania
 * wall-clock-with-Z convention; this is not a migration of historical timestamps. */
export function getLprBookingWindow(data: any): { start: number; end: number } | null {
  const start = bookingClockMillis(data.startDate, data.startTime)
  const end = bookingClockMillis(data.endDate, data.endTime)
  return start !== null && end !== null && end >= start ? { start: start - LPR_TOLERANCE_MS, end: end + LPR_TOLERANCE_MS } : null
}
export function inLprBookingWindow(data: any, time: number): boolean {
  const window = getLprBookingWindow(data)
  return window !== null && time >= window.start && time <= window.end
}
