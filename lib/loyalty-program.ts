import {
  db,
  doc,
  getDoc,
  runTransaction,
} from "@/lib/server-firestore"
import type { ProfileCollection } from "@/lib/mobile-user-service"
import {
  computeBookingTotal,
  loadPriceTiersFromFirestore,
  type PaymentMethod,
} from "@/lib/booking-pricing"
import {
  DEFAULT_LOYALTY_PROGRAM,
  getLoyaltyProgramFromSettings,
  type LoyaltyProgramConfig,
} from "@/lib/mobile-app-settings"

export type LoyaltyState = {
  reservationsCount?: number
  freeDaysAvailable?: number
  points?: number
}

export type LoyaltyProgress = {
  remaining: number
  freeDaysAvailable: number
  reservationsCount: number
  reservationsPerFreeDay: number
}

export type LoyaltyRedeemResult = {
  applied: boolean
  freeDaysUsed: number
  discountAmount: number
}

type PriceTier = {
  days: number
  standardPrice: number
  discountedPrice?: number
}

export function calculateBookingPriceFromTiers(
  tiers: PriceTier[],
  days: number,
  paymentMethod: PaymentMethod
): number {
  return computeBookingTotal(days, tiers, paymentMethod)
}

export function normalizeLoyaltyState(loyalty?: LoyaltyState | null): Required<LoyaltyState> {
  return {
    reservationsCount: Math.max(0, Number(loyalty?.reservationsCount) || 0),
    freeDaysAvailable: Math.max(0, Number(loyalty?.freeDaysAvailable) || 0),
    points: Math.max(0, Number(loyalty?.points) || 0),
  }
}

export function computeLoyaltyProgress(
  loyalty: LoyaltyState | undefined | null,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): LoyaltyProgress {
  const normalized = normalizeLoyaltyState(loyalty)
  const threshold = Math.max(1, config.reservationsPerFreeDay)
  const mod = normalized.reservationsCount % threshold
  const remaining = mod === 0 ? threshold : threshold - mod
  return {
    remaining,
    freeDaysAvailable: normalized.freeDaysAvailable,
    reservationsCount: normalized.reservationsCount,
    reservationsPerFreeDay: threshold,
  }
}

export function canAutoRedeemFreeDay(
  loyalty: LoyaltyState | undefined | null,
  billableDays: number,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): boolean {
  if (!config.enabled) return false
  const normalized = normalizeLoyaltyState(loyalty)
  if (normalized.freeDaysAvailable <= 0) return false
  const days = Math.max(1, Math.floor(Number(billableDays) || 1))
  return days <= Math.max(1, config.maxBillableDaysForAutoRedeem)
}

export function applyLoyaltyDiscountToAmount(
  baseAmount: number,
  oneDayPrice: number,
  loyalty: LoyaltyState | undefined | null,
  billableDays: number,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): { finalAmount: number; applied: boolean; discountAmount: number } {
  if (!canAutoRedeemFreeDay(loyalty, billableDays, config)) {
    return { finalAmount: baseAmount, applied: false, discountAmount: 0 }
  }

  const discountAmount = Math.min(baseAmount, Math.max(0, oneDayPrice))
  return {
    finalAmount: Math.max(0, Math.round((baseAmount - discountAmount) * 100) / 100),
    applied: discountAmount > 0,
    discountAmount,
  }
}

export async function getLoyaltyProgramConfig(): Promise<LoyaltyProgramConfig> {
  const snap = await getDoc(doc(db, "config", "mobileAppSettings"))
  return getLoyaltyProgramFromSettings(snap.exists() ? snap.data() : null)
}

export async function loadPriceTiersForLoyalty(): Promise<PriceTier[]> {
  return loadPriceTiersFromFirestore()
}

export async function resolveMobileBookingAmountWithLoyalty(params: {
  billableDays: number
  paymentMethod: "online" | "at_parking"
  loyalty?: LoyaltyState | null
  config?: LoyaltyProgramConfig
}): Promise<{
  baseAmount: number
  finalAmount: number
  applied: boolean
  discountAmount: number
  oneDayPrice: number
}> {
  const config = params.config || (await getLoyaltyProgramConfig())
  const tiers = await loadPriceTiersForLoyalty()
  const days = Math.max(1, Math.floor(Number(params.billableDays) || 1))
  const baseAmount = calculateBookingPriceFromTiers(tiers, days, params.paymentMethod)
  const oneDayPrice = calculateBookingPriceFromTiers(tiers, 1, params.paymentMethod)
  const discounted = applyLoyaltyDiscountToAmount(
    baseAmount,
    oneDayPrice,
    params.loyalty,
    days,
    config
  )

  return {
    baseAmount,
    oneDayPrice,
    ...discounted,
  }
}

function profileDocRef(uid: string, col: ProfileCollection) {
  return doc(db, col, uid)
}

export function advanceLoyaltyAfterBooking(
  loyalty: LoyaltyState | undefined | null,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): Required<LoyaltyState> {
  const existing = normalizeLoyaltyState(loyalty)
  const threshold = Math.max(1, config.reservationsPerFreeDay)
  let reservationsCount = existing.reservationsCount + 1
  let freeDaysAvailable = existing.freeDaysAvailable

  while (reservationsCount >= threshold) {
    freeDaysAvailable += 1
    reservationsCount -= threshold
  }

  return {
    ...existing,
    reservationsCount,
    freeDaysAvailable,
    points: existing.points + 1,
  }
}

export async function redeemFreeDayIfEligible(
  userId: string,
  profileCol: ProfileCollection,
  billableDays: number,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): Promise<LoyaltyRedeemResult> {
  if (!config.enabled) {
    return { applied: false, freeDaysUsed: 0, discountAmount: 0 }
  }

  const days = Math.max(1, Math.floor(Number(billableDays) || 1))
  if (days > Math.max(1, config.maxBillableDaysForAutoRedeem)) {
    return { applied: false, freeDaysUsed: 0, discountAmount: 0 }
  }

  const ref = profileDocRef(userId, profileCol)

  try {
    const applied = await runTransaction(db, async (tx) => {
      const snap = (await tx.get(ref)) as unknown as {
        exists(): boolean
        data(): { loyalty?: LoyaltyState }
      }
      if (!snap.exists()) return false
      const loyalty = normalizeLoyaltyState(snap.data().loyalty)
      if (loyalty.freeDaysAvailable <= 0) return false

      tx.update(ref, {
        loyalty: {
          ...loyalty,
          freeDaysAvailable: loyalty.freeDaysAvailable - 1,
        },
        updatedAt: new Date(),
      })
      return true
    })

    if (!applied) {
      return { applied: false, freeDaysUsed: 0, discountAmount: 0 }
    }

    const tiers = await loadPriceTiersForLoyalty()
    const oneDayPrice = calculateBookingPriceFromTiers(tiers, 1, "online")

    return { applied: true, freeDaysUsed: 1, discountAmount: oneDayPrice }
  } catch (error) {
    console.warn("[loyalty-program] redeemFreeDayIfEligible failed", error)
    return { applied: false, freeDaysUsed: 0, discountAmount: 0 }
  }
}

export async function awardLoyaltyAfterBooking(
  userId: string,
  profileCol: ProfileCollection,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): Promise<void> {
  if (!config.enabled) return

  const ref = profileDocRef(userId, profileCol)

  try {
    await runTransaction(db, async (tx) => {
      const snap = (await tx.get(ref)) as unknown as {
        exists?: boolean | (() => boolean)
        data(): { loyalty?: LoyaltyState }
      }
      const snapExists =
        typeof snap.exists === "function" ? snap.exists() : Boolean(snap.exists)
      const existing = snapExists
        ? normalizeLoyaltyState(snap.data().loyalty)
        : normalizeLoyaltyState(null)

      const nextLoyalty = advanceLoyaltyAfterBooking(existing, config)

      if (snapExists) {
        tx.update(ref, { loyalty: nextLoyalty, updatedAt: new Date() })
      } else {
        tx.set(ref, {
          uid: userId,
          loyalty: nextLoyalty,
          cars: [],
          updatedAt: new Date(),
        })
      }
    })
  } catch (error) {
    console.warn("[loyalty-program] awardLoyaltyAfterBooking failed", error)
  }
}

export function formatLoyaltyHomeMessage(
  progress: LoyaltyProgress,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): string {
  if (config.homeMessageTemplate?.trim()) {
    return config.homeMessageTemplate
      .replace(/\{remaining\}/g, String(progress.remaining))
      .replace(/\{freeDaysAvailable\}/g, String(progress.freeDaysAvailable))
      .replace(/\{reservationsPerFreeDay\}/g, String(progress.reservationsPerFreeDay))
  }

  return `Încă ${progress.remaining} rezervări până la 1 zi gratuită`
}

export function isMobileLoyaltyEligibleBooking(params: {
  bookingOrigin?: string
  userId?: string
  apiSuccess: boolean
  status?: string
}): boolean {
  if (params.bookingOrigin !== "mobile-app") return false
  if (!params.userId) return false
  if (!params.apiSuccess) return false
  return (
    params.status === "confirmed_paid" ||
    params.status === "confirmed_pay_on_site"
  )
}

export async function processLoyaltyForCompletedMobileBooking(params: {
  userId?: string
  profileIsGuest?: boolean
  bookingOrigin?: string
  apiSuccess: boolean
  status?: string
  billableDays?: number
  loyaltyFreeDayApplied?: boolean
  firestoreId?: string
}): Promise<void> {
  if (
    !isMobileLoyaltyEligibleBooking({
      bookingOrigin: params.bookingOrigin,
      userId: params.userId,
      apiSuccess: params.apiSuccess,
      status: params.status,
    })
  ) {
    return
  }

  const userId = params.userId!
  const profileCol: ProfileCollection = params.profileIsGuest ? "guests" : "users"
  const config = await getLoyaltyProgramConfig()
  const days = Math.max(1, Math.floor(Number(params.billableDays) || 1))

  if (params.loyaltyFreeDayApplied) {
    await redeemFreeDayIfEligible(userId, profileCol, days, config)
  }

  await awardLoyaltyAfterBooking(userId, profileCol, config)
}
