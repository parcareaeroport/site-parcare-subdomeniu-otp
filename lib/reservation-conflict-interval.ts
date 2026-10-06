/** Uses the same minute/day rounding as the Multipark submission. */
export type ReservationIntervalInput = {
  startDate: string; startTime: string; endDate: string; endTime: string;
  multiparkDurationMinutes?: unknown;
}
export function reservationInterval(input: ReservationIntervalInput, multipark: boolean) {
  const start = new Date(`${input.startDate}T${input.startTime}:00`).getTime()
  const realEnd = new Date(`${input.endDate}T${input.endTime}:00`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(realEnd) || realEnd <= start) {
    throw new Error("Invalid reservation interval")
  }
  const stored = Number(input.multiparkDurationMinutes)
  const minutes = Number.isFinite(stored) && stored > 0
    ? stored : Math.ceil(Math.round((realEnd - start) / 60000) / 1440) * 1440
  return { start, end: multipark ? start + minutes * 60000 : realEnd }
}
export function intervalsOverlap(a: {start: number; end: number}, b: {start: number; end: number}) {
  return a.start < b.end && a.end > b.start
}
