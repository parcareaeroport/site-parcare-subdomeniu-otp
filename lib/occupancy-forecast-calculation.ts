import { calculateReservationAvailability, createAvailabilityDiagnostics, type ReservationCheckRow } from "@/lib/reservation-availability-calculation"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import type { ForecastInterval, OccupancyForecastInput, OccupancyForecastResponse, ForecastDocument } from "@/lib/occupancy-forecast-contract"

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function validTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
export function validateForecastInput(value: unknown): value is OccupancyForecastInput {
  if (!value || typeof value !== "object") return false
  const { from, to, simulator: s } = value as OccupancyForecastInput
  return validDate(from) && validDate(to) && from <= to && to < "9999-12-31" && !!s &&
    validDate(s.startDate) && validDate(s.endDate) && validTime(s.startTime) && validTime(s.endTime) &&
    new Date(`${s.endDate}T${s.endTime}:00`).getTime() > new Date(`${s.startDate}T${s.startTime}:00`).getTime()
}
function nextDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}
const text = (value: unknown) => typeof value === "string" ? value : null

/** Pure calculation: every result uses the exact same projected documents and clock. */
export function calculateOccupancyForecast(
  rows: ReservationCheckRow[], limit: number, now: number, input: OccupancyForecastInput,
): OccupancyForecastResponse {
  if (!validateForecastInput(input) || !Number.isFinite(Number(limit)) || !Number.isFinite(now)) throw new Error("Invalid forecast data")
  const plates = new Map<string, string[]>()
  for (const { id, booking } of rows) {
    const plate = String(booking.licensePlate || "").replace(/[^a-z0-9]/gi, "").toUpperCase()
    if (plate) {
      const ids = plates.get(plate) || []
      ids.push(id)
      plates.set(plate, ids)
    }
  }
  const documents = Object.fromEntries(rows.map(({ id, booking: b }) => {
    const plate = String(b.licensePlate || "").replace(/[^a-z0-9]/gi, "").toUpperCase()
    const presence = getLprPresenceState({ lpr: b.lpr })
    const warnings: string[] = []
    const repeated = plates.get(plate) || []
    if (repeated.length > 1) warnings.push(`Număr repetat în ${repeated.length} documente; fiecare document este calculat separat.`)
    if (b.lpr?.isInside === true && !presence.isEffectivelyInside) {
      warnings.push(`Date LPR contradictorii: isInside = true, prezență efectivă = false (${presence.reason}).`)
    }
    const entry: ForecastDocument = {
      id, licensePlate: text(b.licensePlate) || "—", apiBookingNumber: b.apiBookingNumber == null ? null : String(b.apiBookingNumber),
      status: text(b.status) || "—", startDate: text(b.startDate), startTime: text(b.startTime), endDate: text(b.endDate), endTime: text(b.endTime),
      lpr: { isInside: b.lpr?.isInside === true, arrivedAt: lprTimestampToMillis(b.lpr?.arrivedAt),
        departedAt: lprTimestampToMillis(b.lpr?.departedAt), lastSeenAt: lprTimestampToMillis(b.lpr?.lastSeenAt), lastEventType: text(b.lpr?.lastEventType) },
      warnings,
    }
    return [id, entry]
  }))
  const calculate = (interval: ForecastInterval) => {
    const diagnostics = createAvailabilityDiagnostics()
    const result = calculateReservationAvailability(rows, interval.startDate, interval.startTime, interval.endDate, interval.endTime, limit, now, diagnostics)
    if (!Number.isFinite(result.totalSpots)) throw new Error("Invalid capacity")
    return { interval, ...result, delayedCount: diagnostics.delayed.length, unmatchedInsideCount: diagnostics.unmatched.length, diagnostics }
  }
  const days = []
  for (let date = input.from; date <= input.to; date = nextDay(date)) {
    days.push(calculate({ startDate: date, startTime: "00:00", endDate: nextDay(date), endTime: "00:00" }))
  }
  return { calculatedAt: new Date(now).toISOString(), serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    capacity: Number(limit), input, documents, days, simulator: calculate(input.simulator) }
}
