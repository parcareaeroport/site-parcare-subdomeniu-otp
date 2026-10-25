import type { AvailabilityDiagnostics } from "@/lib/reservation-availability-calculation"

export type ForecastInterval = { startDate: string; startTime: string; endDate: string; endTime: string }
export type OccupancyForecastInput = { from: string; to: string; simulator: ForecastInterval }
export type ForecastDocument = {
  id: string; licensePlate: string; apiBookingNumber: string | null; status: string
  startDate: string | null; startTime: string | null; endDate: string | null; endTime: string | null
  lpr: { isInside: boolean; arrivedAt: number | null; departedAt: number | null; lastSeenAt: number | null; lastEventType: string | null }
  warnings: string[]
}
export type ForecastResult = {
  interval: ForecastInterval; available: boolean; conflictingBookings: number; totalSpots: number
  maxBookingsInPeriod: number; delayedCount: number; unmatchedInsideCount: number; diagnostics: AvailabilityDiagnostics
}
export type OccupancyForecastResponse = {
  calculatedAt: string; serverTimeZone: string; capacity: number; input: OccupancyForecastInput
  documents: Record<string, ForecastDocument>; days: ForecastResult[]; simulator: ForecastResult
}
