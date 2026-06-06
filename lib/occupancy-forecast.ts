import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { getLprPresenceState } from "@/lib/lpr-presence"

export type DailyForecastRow = {
  date: string // YYYY-MM-DD
  occupied: number
}

export type ForecastDayBooking = {
  id: string
  licensePlate: string
  clientName: string
  source: string
  status: string
  paymentStatus: string
  startDate: string
  startTime?: string
  endDate: string
  endTime?: string
  isInside: boolean
  apiBookingNumber?: string
}

export type InsideNowVehicle = {
  id: string
  licensePlate: string
  clientName: string
  source: string
  status: string
  paymentStatus: string
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
  apiBookingNumber?: string
  isInside: true
}

function isExcludedStatus(statusRaw: unknown): boolean {
  const s = String(statusRaw || "").trim().toLowerCase()
  if (!s) return false
  if (s === "expired") return true
  if (s === "api_error") return true
  if (s === "unmatched_lpr") return true
  if (s === "cancelled" || s === "cancelled_by_admin" || s === "cancelled_by_api") return true
  if (s.startsWith("cancelled_")) return true
  return false
}

function toDateKey(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function parseIsoDateKey(key: string): Date | null {
  const s = String(key || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

function clampKey(k: string, minKey: string, maxKey: string): string {
  if (k < minKey) return minKey
  if (k > maxKey) return maxKey
  return k
}

export async function computeDailyForecastOccupancy(input: {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  limitCandidates?: number
}): Promise<{ rows: DailyForecastRow[]; maybeTruncated: boolean }> {
  const fromKey = String(input.from || "").trim()
  const toKey = String(input.to || "").trim()
  const limitCandidates = Math.max(1, Math.min(10000, Number(input.limitCandidates || 5000)))

  const fromDate = parseIsoDateKey(fromKey)
  const toDate = parseIsoDateKey(toKey)
  if (!fromDate || !toDate || fromKey > toKey) {
    return { rows: [], maybeTruncated: false }
  }

  // Initialize counts for each day in range
  const counts = new Map<string, number>()
  for (let d = new Date(fromDate); d.getTime() <= toDate.getTime(); d = addDays(d, 1)) {
    counts.set(toDateKey(d), 0)
  }

  // Candidate query:
  // - Firestore doesn't allow range filters on two different fields.
  // - So we query by endDate >= fromKey, then filter by startDate <= toKey in memory.
  const qCandidates = query(
    collection(db, "bookings"),
    where("endDate", ">=", fromKey),
    orderBy("endDate", "asc"),
    limit(limitCandidates),
  )
  const snap = await getDocs(qCandidates)
  const maybeTruncated = snap.size >= limitCandidates

  snap.forEach((docSnap) => {
    const b: any = docSnap.data()
    const startDate = String(b?.startDate || "").trim()
    const endDate = String(b?.endDate || "").trim()
    if (!startDate || !endDate) return
    if (startDate > toKey) return
    if (isExcludedStatus(b?.status)) return

    // Overlap on calendar days (inclusive)
    const effectiveStart = clampKey(startDate, fromKey, toKey)
    const effectiveEnd = clampKey(endDate, fromKey, toKey)
    if (effectiveStart > effectiveEnd) return

    // Iterate day-by-day between effectiveStart..effectiveEnd inclusive
    const sDt = parseIsoDateKey(effectiveStart)
    const eDt = parseIsoDateKey(effectiveEnd)
    if (!sDt || !eDt) return
    for (let d = new Date(sDt); d.getTime() <= eDt.getTime(); d = addDays(d, 1)) {
      const k = toDateKey(d)
      if (!counts.has(k)) continue
      counts.set(k, (counts.get(k) || 0) + 1)
    }
  })

  const rows: DailyForecastRow[] = Array.from(counts.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, occupied]) => ({ date, occupied }))

  return { rows, maybeTruncated }
}

export async function fetchForecastBookingsForDay(input: {
  day: string // YYYY-MM-DD
  limitCandidates?: number
}): Promise<{ items: ForecastDayBooking[]; maybeTruncated: boolean }> {
  const dayKey = String(input.day || "").trim()
  const limitCandidates = Math.max(1, Math.min(10000, Number(input.limitCandidates || 5000)))

  const dayDate = parseIsoDateKey(dayKey)
  if (!dayDate) return { items: [], maybeTruncated: false }

  const qCandidates = query(
    collection(db, "bookings"),
    where("endDate", ">=", dayKey),
    orderBy("endDate", "asc"),
    limit(limitCandidates),
  )
  const snap = await getDocs(qCandidates)
  const maybeTruncated = snap.size >= limitCandidates

  const items: ForecastDayBooking[] = []
  snap.forEach((docSnap) => {
    const b: any = docSnap.data()
    const startDate = String(b?.startDate || "").trim()
    const endDate = String(b?.endDate || "").trim()
    if (!startDate || !endDate) return
    if (startDate > dayKey) return
    if (isExcludedStatus(b?.status)) return

    const isInside = getLprPresenceState({ lpr: b?.lpr }).isEffectivelyInside

    items.push({
      id: docSnap.id,
      licensePlate: String(b?.licensePlate || "N/A"),
      clientName: String(b?.clientName || "N/A"),
      source: String(b?.source || "unknown"),
      status: String(b?.status || "unknown"),
      paymentStatus: String(b?.paymentStatus || "n/a"),
      startDate,
      startTime: b?.startTime ? String(b.startTime) : undefined,
      endDate,
      endTime: b?.endTime ? String(b.endTime) : undefined,
      isInside,
      apiBookingNumber: b?.apiBookingNumber ? String(b.apiBookingNumber) : undefined,
    })
  })

  // Stable sort: inside first, then plate
  items.sort((a, b) => {
    if (a.isInside !== b.isInside) return a.isInside ? -1 : 1
    return a.licensePlate.localeCompare(b.licensePlate)
  })

  return { items, maybeTruncated }
}

export async function fetchInsideNowVehicles(input?: {
  limitCandidates?: number
}): Promise<{ items: InsideNowVehicle[]; maybeTruncated: boolean }> {
  const limitCandidates = Math.max(1, Math.min(10000, Number(input?.limitCandidates || 5000)))

  const qInside = query(
    collection(db, "bookings"),
    where("lpr.isInside", "==", true),
    limit(limitCandidates),
  )
  const snap = await getDocs(qInside)
  const maybeTruncated = snap.size >= limitCandidates

  const items: InsideNowVehicle[] = []
  snap.forEach((docSnap) => {
    const b: any = docSnap.data()
    if (!getLprPresenceState({ lpr: b?.lpr }).isEffectivelyInside) return
    items.push({
      id: docSnap.id,
      licensePlate: String(b?.licensePlate || "N/A"),
      clientName: String(b?.clientName || "N/A"),
      source: String(b?.source || "unknown"),
      status: String(b?.status || "unknown"),
      paymentStatus: String(b?.paymentStatus || "n/a"),
      startDate: b?.startDate ? String(b.startDate) : undefined,
      startTime: b?.startTime ? String(b.startTime) : undefined,
      endDate: b?.endDate ? String(b.endDate) : undefined,
      endTime: b?.endTime ? String(b.endTime) : undefined,
      apiBookingNumber: b?.apiBookingNumber ? String(b.apiBookingNumber) : undefined,
      isInside: true,
    })
  })

  // Stable sort: plate
  items.sort((a, b) => a.licensePlate.localeCompare(b.licensePlate))
  return { items, maybeTruncated }
}

