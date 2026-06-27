import { collection, db, getDocs, orderBy, query } from "@/lib/server-firestore"

export type PaymentMethod = "online" | "at_parking"

export const DEFAULT_ONLINE_DISCOUNT_PERCENT = 20

export type PriceTier = {
  days: number
  standardPrice: number
  reducereAplicata?: number
  discountPercentage?: number
  discountedPrice?: number
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100
}

export function hasExplicitOnlineDiscount(tier: PriceTier): boolean {
  if (typeof tier.reducereAplicata === "number" && tier.reducereAplicata > 0) return true
  if (typeof tier.discountPercentage === "number" && tier.discountPercentage > 0) return true
  if (
    typeof tier.discountedPrice === "number" &&
    !Number.isNaN(tier.discountedPrice) &&
    Math.abs(tier.discountedPrice - tier.standardPrice) > 0.001
  ) {
    return true
  }
  return false
}

function getExplicitOnlineTotal(tier: PriceTier): number {
  if (typeof tier.discountedPrice === "number" && !Number.isNaN(tier.discountedPrice)) {
    return tier.discountedPrice
  }
  if (typeof tier.reducereAplicata === "number" && tier.reducereAplicata > 0) {
    return Math.max(0, tier.standardPrice - tier.reducereAplicata)
  }
  return tier.standardPrice
}

export function computeOnlineSavings(standardTotal: number, onlineTotal: number): number {
  return roundPrice(Math.max(0, standardTotal - onlineTotal))
}

export function formatBookingPrice(amount: number): string {
  return `${roundPrice(amount).toFixed(2)} lei`
}

export type ResolvedPriceTier = {
  tier: PriceTier
  billableDays: number
  total: number
  pricePerDay: number
}

let cachedPriceTiers: PriceTier[] | null = null

function normalizeTimeHHmm(time?: string): string {
  if (!time) return "00:00"
  const trimmed = String(time).trim()
  const match = trimmed.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/)
  if (!match) return trimmed
  const hh = String(parseInt(match[1], 10)).padStart(2, "0")
  const mm = String(parseInt(match[2], 10)).padStart(2, "0")
  return `${hh}:${mm}`
}

export function normalizePriceTier(data: Record<string, unknown>): PriceTier | null {
  const days = Number(data.days || 0)
  const standardPrice = Number(data.standardPrice || 0)
  if (days <= 0 || standardPrice <= 0) return null

  const reducereAplicata =
    data.reducereAplicata !== undefined ? Number(data.reducereAplicata) : undefined
  const discountPercentage =
    data.discountPercentage !== undefined ? Number(data.discountPercentage) : undefined

  let discountedPrice: number | undefined
  if (data.discountedPrice !== undefined) {
    discountedPrice = Number(data.discountedPrice)
  } else if (typeof reducereAplicata === "number" && !Number.isNaN(reducereAplicata)) {
    discountedPrice = Math.max(0, standardPrice - reducereAplicata)
  } else if (typeof discountPercentage === "number" && !Number.isNaN(discountPercentage)) {
    discountedPrice = standardPrice * (1 - discountPercentage / 100)
  }

  return {
    days,
    standardPrice,
    reducereAplicata:
      typeof reducereAplicata === "number" && !Number.isNaN(reducereAplicata)
        ? reducereAplicata
        : undefined,
    discountPercentage:
      typeof discountPercentage === "number" && !Number.isNaN(discountPercentage)
        ? discountPercentage
        : undefined,
    discountedPrice:
      typeof discountedPrice === "number" && !Number.isNaN(discountedPrice)
        ? discountedPrice
        : undefined,
  }
}

export function computeBillableDays(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string
): number {
  const startDateStr = (startDate || "").trim()
  const endDateStr = (endDate || "").trim() || startDateStr
  if (!startDateStr) return 1

  const startTimeNorm = normalizeTimeHHmm(startTime)
  const endTimeNorm = normalizeTimeHHmm(endTime)

  const startDt = new Date(`${startDateStr}T${startTimeNorm}:00`)
  const endDt = new Date(`${endDateStr}T${endTimeNorm}:00`)

  if (!Number.isNaN(startDt.getTime()) && !Number.isNaN(endDt.getTime()) && endDt > startDt) {
    return Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000)))
  }

  try {
    const startOnly = new Date(startDateStr)
    const endOnly = new Date(endDateStr)
    if (!Number.isNaN(startOnly.getTime()) && !Number.isNaN(endOnly.getTime())) {
      const diffMs = endOnly.getTime() - startOnly.getTime()
      return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1)
    }
  } catch {
    // fallback below
  }

  return 1
}

export function resolvePriceTier(days: number, tiers: PriceTier[]): PriceTier | null {
  if (!days || days <= 0 || !tiers.length) return null
  const sorted = [...tiers].sort((a, b) => a.days - b.days)
  const exact = sorted.find((tier) => tier.days === days)
  return exact || sorted.find((tier) => tier.days >= days) || sorted[sorted.length - 1] || null
}

export function getTierTotal(tier: PriceTier, paymentMethod: PaymentMethod): number {
  if (paymentMethod === "at_parking") {
    return tier.standardPrice
  }
  if (hasExplicitOnlineDiscount(tier)) {
    return getExplicitOnlineTotal(tier)
  }
  return roundPrice(tier.standardPrice * (1 - DEFAULT_ONLINE_DISCOUNT_PERCENT / 100))
}

export function computeBookingTotal(
  days: number,
  tiers: PriceTier[],
  paymentMethod: PaymentMethod
): number {
  const tier = resolvePriceTier(days, tiers)
  if (!tier) return 0
  return Math.round(getTierTotal(tier, paymentMethod) * 100) / 100
}

export function computePricePerDayForTier(
  days: number,
  tiers: PriceTier[],
  paymentMethod: PaymentMethod
): number {
  const tier = resolvePriceTier(days, tiers)
  if (!tier || tier.days <= 0) return 0
  const total = getTierTotal(tier, paymentMethod)
  return Math.round((total / tier.days) * 100) / 100
}

export function resolveBookingPrice(
  days: number,
  tiers: PriceTier[],
  paymentMethod: PaymentMethod
): ResolvedPriceTier | null {
  const tier = resolvePriceTier(days, tiers)
  if (!tier) return null
  const total = Math.round(getTierTotal(tier, paymentMethod) * 100) / 100
  const pricePerDay = tier.days > 0 ? Math.round((total / tier.days) * 100) / 100 : 0
  return {
    tier,
    billableDays: Math.max(1, days),
    total,
    pricePerDay,
  }
}

export function computeBillableDaysFromMobilePayload(payload: {
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
  days?: number
}): number {
  if (payload.startDate && payload.endDate) {
    return computeBillableDays(
      payload.startDate,
      payload.startTime || "00:00",
      payload.endDate,
      payload.endTime || "00:00"
    )
  }
  return Math.max(1, Math.floor(Number(payload.days) || 1))
}

export async function loadPriceTiersFromFirestore(): Promise<PriceTier[]> {
  if (cachedPriceTiers) return cachedPriceTiers
  try {
    const snap = await getDocs(query(collection(db, "prices"), orderBy("days")))
    const tiers: PriceTier[] = []
    snap.forEach((docSnap: { data(): Record<string, unknown> }) => {
      const tier = normalizePriceTier(docSnap.data() as Record<string, unknown>)
      if (tier) tiers.push(tier)
    })
    tiers.sort((a, b) => a.days - b.days)
    cachedPriceTiers = tiers
    return tiers
  } catch (error) {
    console.warn("[booking-pricing] Failed to load price tiers", error)
    return []
  }
}

export function clearPriceTiersCache() {
  cachedPriceTiers = null
}

export async function resolveMobileBookingQuote(params: {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  paymentMethod?: PaymentMethod
}) {
  const tiers = await loadPriceTiersFromFirestore()
  const days = computeBillableDays(
    params.startDate,
    params.startTime,
    params.endDate,
    params.endTime
  )
  const onlineResolved = resolveBookingPrice(days, tiers, "online")
  const atParkingResolved = resolveBookingPrice(days, tiers, "at_parking")

  return {
    days,
    onlineTotal: onlineResolved?.total ?? 0,
    atParkingTotal: atParkingResolved?.total ?? 0,
    pricePerDayOnline: onlineResolved?.pricePerDay ?? 0,
    pricePerDayAtParking: atParkingResolved?.pricePerDay ?? 0,
    tierDaysUsed: onlineResolved?.tier.days ?? atParkingResolved?.tier.days ?? days,
  }
}

/** Ashic WP standard per-day rates (for validation script only). */
export const ASHIC_STANDARD_PER_DAY_RATES: Array<{ maxDays: number; rate: number }> = [
  { maxDays: 1, rate: 60.0 },
  { maxDays: 2, rate: 60.0 },
  { maxDays: 3, rate: 50.67 },
  { maxDays: 4, rate: 46.0 },
  { maxDays: 5, rate: 43.0 },
  { maxDays: 6, rate: 41.17 },
  { maxDays: 7, rate: 39.71 },
  { maxDays: 8, rate: 38.88 },
  { maxDays: 9, rate: 37.78 },
  { maxDays: 10, rate: 37.4 },
  { maxDays: 11, rate: 36.82 },
  { maxDays: 12, rate: 36.42 },
  { maxDays: 13, rate: 36.0 },
  { maxDays: 14, rate: 35.71 },
  { maxDays: 15, rate: 35.4 },
  { maxDays: 16, rate: 35.25 },
  { maxDays: 17, rate: 35.0 },
  { maxDays: 18, rate: 34.44 },
  { maxDays: 19, rate: 33.95 },
  { maxDays: 20, rate: 33.5 },
  { maxDays: 21, rate: 33.14 },
  { maxDays: 22, rate: 32.77 },
  { maxDays: 23, rate: 32.43 },
  { maxDays: 24, rate: 32.17 },
  { maxDays: 25, rate: 31.88 },
  { maxDays: 26, rate: 31.62 },
  { maxDays: 27, rate: 31.33 },
  { maxDays: 28, rate: 31.18 },
  { maxDays: 29, rate: 30.97 },
]

export function getAshicStandardPerDayRate(days: number): number {
  const bucket = ASHIC_STANDARD_PER_DAY_RATES.find((entry) => days <= entry.maxDays)
  return bucket?.rate ?? 30.77
}
