import { lprTimestampToMillis } from "./lpr-presence"

export type OccupancyLpr = {
  arrivedAt?: string | null
  departedAt?: string | null
  lastSeenAt?: string | null
  lastEventType: string | null
  lastSeenDeviceId: string | null
}

// Undefined means absent; null means present but unreadable.
export function occupancyLprTimestamp(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined
  // Reject ambiguous input; normalized LPR values use the storage convention below.
  if (typeof value === "string" && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null
  const ms = lprTimestampToMillis(value)
  return ms !== null && Number.isFinite(ms) && !Number.isNaN(new Date(ms).getTime())
    ? new Date(ms).toISOString() : null
}

// LPR writers normalize to Romania CIVIL time stored with a Z suffix (legacy
// contract), including cameras configured with genuine instants. Render those
// clock components without a second UTC -> Bucharest conversion. This is display
// only; it neither converts historical data nor infers an unknown legacy clock.
const dateFormat = new Intl.DateTimeFormat("ro-RO", {
  timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
})

export function formatOccupancyLprTime(value?: string | null): string {
  const iso = occupancyLprTimestamp(value)
  return iso ? dateFormat.format(new Date(iso)) : "Necunoscut"
}

function reservationWallTime(date?: string | null, time?: string | null): string | null {
  if (!date || !time || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const value = `${date}T${time}:00`
  const parsed = new Date(`${value}Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value ? value : null
}

export function occupancyEventOutsidePeriod(plate: {
  startDate?: string | null; startTime?: string | null
  endDate?: string | null; endTime?: string | null; lpr?: OccupancyLpr
}): boolean {
  const iso = occupancyLprTimestamp(plate.lpr?.lastSeenAt)
  const start = reservationWallTime(plate.startDate, plate.startTime)
  const end = reservationWallTime(plate.endDate, plate.endTime)
  if (!iso || !start || !end || start >= end) return false
  // Compare Bucharest civil time with the reservation's Bucharest date/time fields.
  const parts = Object.fromEntries(dateFormat.formatToParts(new Date(iso)).map(p => [p.type, p.value]))
  const event = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
  return event < start || event > end
}

export function occupancyEventLabel(type?: string | null): string {
  switch (type?.trim().toLowerCase()) {
    case "entry": return "Intrare"
    case "exit": return "Ieșire"
    default: return "Necunoscut"
  }
}
