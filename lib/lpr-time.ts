import { lprTimestampToMillis } from "./lpr-presence"

// Display/storage compatibility: existing *At fields are Romania civil clocks
// labelled Z. New *AtInstant fields retain the real instant for ordering only.
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
export function romaniaCivilClock(now: Date) {
  const p = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${String(now.getUTCMilliseconds()).padStart(3, "0")}Z`
}
export type LprTime = { wall: unknown; instant?: unknown }
export const lprTime = (wall: unknown, instant?: unknown): LprTime => ({ wall, instant })

/** Enumerate offsets using the zone itself. A repeated hour has two candidates;
 * a nonexistent spring hour has none. Never select an offset arbitrarily. */
export function lprTimeCandidates(point: LprTime): number[] {
  const wall = lprTimestampToMillis(point.wall)
  if (wall === null || !Number.isFinite(new Date(wall).getTime())) return []
  const exact = lprTimestampToMillis(point.instant)
  if (point.instant != null && exact === null) return []
  if (exact !== null) return Number.isFinite(new Date(exact).getTime()) && Date.parse(romaniaCivilClock(new Date(exact))) === wall ? [exact] : []
  const offsets = new Set<number>()
  for (const hours of [-36, 0, 36]) {
    const probe = wall + hours * 3600000
    offsets.add(Date.parse(romaniaCivilClock(new Date(probe))) - probe)
  }
  return [...offsets].map(offset => wall - offset)
    .filter(ms => Date.parse(romaniaCivilClock(new Date(ms))) === wall).sort((a, b) => a - b)
}
export function uniqueLprInstant(wall: unknown): string | null {
  const values = lprTimeCandidates(lprTime(wall))
  return values.length === 1 ? new Date(values[0]).toISOString() : null
}
/** null means the available timestamps cannot prove the ordering. */
export function compareLprTimes(a: LprTime, b: LprTime, precision = 1): -1 | 0 | 1 | null {
  const aa = lprTimeCandidates(a).map(n => Math.floor(n / precision))
  const bb = lprTimeCandidates(b).map(n => Math.floor(n / precision))
  if (!aa.length || !bb.length) return null
  if (aa[aa.length - 1] < bb[0]) return -1
  if (aa[0] > bb[bb.length - 1]) return 1
  return aa.length === 1 && bb.length === 1 && aa[0] === bb[0] ? 0 : null
}
export function bookingLprTimes(b: any): LprTime[] {
  const lpr = b.lpr || {}
  return ["arrivedAt", "departedAt", "lastSeenAt"].filter(k => lprTimestampToMillis(lpr[k]) !== null)
    .map(k => lprTime(lpr[k], lpr[`${k}Instant`]))
}
export function receiptLprTime(r: any): LprTime {
  return lprTime(r.eventTime ?? (r.manual === true ? r.accurateTime ?? r.snapTime : null), r.eventInstant)
}
export function normalizeLprEventType(value: unknown): "entry" | "exit" | null {
  const type = String(value || "").trim().toLowerCase()
  return type.includes("entry") ? "entry" : type.includes("exit") ? "exit" : null
}
