import { getLprPresenceState } from "@/lib/lpr-presence"

export type ReservationCheckRow = { id: string; booking: Record<string, any> }

export const CAPACITY_STATUSES = ["confirmed_paid", "confirmed_test", "confirmed", "paid"]
export const PRESENCE_STATUSES = [...CAPACITY_STATUSES, "confirmed_pay_on_site"]

/** Mirrors the existing capacity rules, using one request's projected snapshot. */
export function calculateReservationAvailability(
  rows: ReservationCheckRow[],
  startDate: string, startTime: string, endDate: string, endTime: string,
  maxTotalReservations: number,
  now = Date.now()
) {
  const requestedStart = new Date(`${startDate}T${startTime}:00`).getTime()
  const requestedEnd = new Date(`${endDate}T${endTime}:00`).getTime()
  if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) {
    throw new Error("Invalid reservation interval")
  }

  let delayedCount = 0
  let unmatchedInsideCount = 0
  const overlapping: Array<{ start: number; end: number }> = []

  for (const { booking } of rows) {
    if (booking.status === "unmatched_lpr") {
      // Preserve the existing unmatched query's raw isInside rule.
      if (booking.lpr?.isInside === true) unmatchedInsideCount++
      continue
    }
    const end = new Date(`${booking.endDate}T${booking.endTime}:00`).getTime()
    if (PRESENCE_STATUSES.includes(booking.status) &&
        getLprPresenceState({ lpr: booking.lpr }).isEffectivelyInside &&
        booking.endDate && booking.endTime && end < now) delayedCount++

    if (!CAPACITY_STATUSES.includes(booking.status) ||
        typeof booking.startDate !== "string" || typeof booking.endDate !== "string" ||
        booking.startDate > endDate || booking.endDate < startDate) continue
    if (end <= now) continue
    const start = new Date(`${booking.startDate}T${booking.startTime}:00`).getTime()
    // Old capacity code logs these dates with toISOString; invalid relevant data fails closed.
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("Invalid stored reservation interval")
    overlapping.push({ start, end })
  }

  let maxBookingsInPeriod = 0
  const day = new Date(startDate)
  const lastDay = new Date(endDate)
  while (day <= lastDay) {
    const date = day.toISOString().split("T")[0]
    const dayStart = new Date(`${date}T00:00:00`).getTime()
    const dayEnd = new Date(`${date}T23:59:59`).getTime()
    const count = overlapping.filter(b => b.start <= dayEnd && b.end >= dayStart).length
    maxBookingsInPeriod = Math.max(maxBookingsInPeriod, count)
    day.setDate(day.getDate() + 1)
  }

  const conflictingBookings = overlapping.filter(b => requestedStart < b.end && requestedEnd > b.start).length
  const totalSpots = Math.max(0, maxTotalReservations - delayedCount - unmatchedInsideCount)
  return { available: conflictingBookings + 1 <= totalSpots, conflictingBookings, totalSpots, maxBookingsInPeriod }
}
