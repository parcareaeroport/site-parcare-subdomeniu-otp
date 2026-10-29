import { calculateOccupancyForecast } from "@/lib/occupancy-forecast-calculation"
import type { ReservationCheckRow } from "@/lib/reservation-availability-calculation"

export type ParkingFullSummary = {
  from: string
  to: string
  calculatedAt: string
  fullDays: string[]
  warningDays: string[]
}

export function calculateParkingFullSummary(rows: ReservationCheckRow[], limit: number, now: number): ParkingFullSummary {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now))
  const part = (name: string) => parts.find(p => p.type === name)!.value
  const today = `${part("year")}-${part("month")}-${part("day")}`
  const offset = (days: number) => {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
  }
  const from = offset(1), to = offset(30)
  const forecast = calculateOccupancyForecast(rows, limit, now, {
    from, to, simulator: { startDate: from, startTime: "00:00", endDate: offset(2), endTime: "00:00" },
  })
  return { from, to, calculatedAt: forecast.calculatedAt,
    fullDays: forecast.days.filter(day => !day.available).map(day => day.interval.startDate),
    warningDays: forecast.days.filter(day => day.totalSpots - day.conflictingBookings <= 5).map(day => day.interval.startDate) }
}
