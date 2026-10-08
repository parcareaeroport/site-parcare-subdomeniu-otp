import { normalizeLoyaltyState, advanceLoyaltyAfterBooking, type LoyaltyState, type LoyaltyProgress } from "@/lib/loyalty-state"
export * from "@/lib/loyalty-state"
export { DEFAULT_LOYALTY_PROGRAM } from "@/lib/mobile-app-settings.shared"
import {
  db,
  doc,
  getDoc,
  runTransaction,
} from "@/lib/server-firestore"
import type { ProfileCollection } from "@/lib/mobile-user-service"
import {
  computeBookingTotal,
  getMobileOnlineTierTotal,
  loadPriceTiersFromFirestore,
  resolvePriceTier,
  type PaymentMethod,
} from "@/lib/booking-pricing"
import { getPricingSettings } from "@/lib/pricing-settings"
import {
  DEFAULT_LOYALTY_PROGRAM,
  getLoyaltyProgramFromSettings,
  type LoyaltyProgramConfig,
} from "@/lib/mobile-app-settings"

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

export function calculateMobileBookingPriceFromTiers(
  tiers: PriceTier[],
  days: number,
  paymentMethod: PaymentMethod,
  mobileOnlineDiscountPercent: number
): number {
  const tier = resolvePriceTier(days, tiers)
  if (!tier) return 0
  if (paymentMethod === "at_parking") {
    return Math.round(tier.standardPrice * 100) / 100
  }
  return Math.round(getMobileOnlineTierTotal(tier, mobileOnlineDiscountPercent) * 100) / 100
}

export function calculateBookingPriceFromTiers(
  tiers: PriceTier[],
  days: number,
  paymentMethod: PaymentMethod
): number {
  return computeBookingTotal(days, tiers, paymentMethod)
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
  const [tiers, pricingSettings] = await Promise.all([
    loadPriceTiersForLoyalty(),
    getPricingSettings(),
  ])
  const mobileDiscount = pricingSettings.mobileOnlineDiscountPercent
  const days = Math.max(1, Math.floor(Number(params.billableDays) || 1))
  const baseAmount =
    params.paymentMethod === "online"
      ? calculateMobileBookingPriceFromTiers(tiers, days, "online", mobileDiscount)
      : calculateBookingPriceFromTiers(tiers, days, params.paymentMethod)
  const oneDayPrice =
    params.paymentMethod === "online"
      ? calculateMobileBookingPriceFromTiers(tiers, 1, "online", mobileDiscount)
      : calculateBookingPriceFromTiers(tiers, 1, params.paymentMethod)
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

function profileDocRef(uid: string, col: ProfileCollection): FirebaseFirestore.DocumentReference {
  return doc(db, col, uid)
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

    const [tiers, pricingSettings] = await Promise.all([
      loadPriceTiersForLoyalty(),
      getPricingSettings(),
    ])
    const oneDayPrice = calculateMobileBookingPriceFromTiers(
      tiers,
      1,
      "online",
      pricingSettings.mobileOnlineDiscountPercent
    )

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

  if (!params.firestoreId) return
  const userId = params.userId!
  const profileCol: ProfileCollection = params.profileIsGuest ? "guests" : "users"
  const config = await getLoyaltyProgramConfig()
  const bookingRef: FirebaseFirestore.DocumentReference = doc(db, "bookings", params.firestoreId)
  const ref = profileDocRef(userId, profileCol)
  await runTransaction(db, async (tx) => {
    const booking = await tx.get(bookingRef)
    if (!booking.exists) return
    const data = booking.data()!
    if (data.loyaltyRecord?.reversedAt || (data.loyaltyRecord && data.loyaltyRecord.processingStatus !== "pending") || !isMobileLoyaltyEligibleBooking({
      ...data, apiSuccess: data.apiSuccess === true,
    })) return
    const profile = await tx.get(ref)
    let loyalty = normalizeLoyaltyState(profile.data()?.loyalty)
    const days = Math.max(1, Math.floor(Number(params.billableDays) || 1))
    const freeDaysUsed = params.loyaltyFreeDayApplied && canAutoRedeemFreeDay(loyalty, days, config) ? 1 : 0
    loyalty.freeDaysAvailable -= freeDaysUsed
    if (config.enabled) loyalty = advanceLoyaltyAfterBooking(loyalty, config)
    if (config.enabled || freeDaysUsed) {
      tx.set(ref, { ...(profile.exists ? {} : { uid: userId, cars: [] }), loyalty, updatedAt: new Date() }, { merge: true })
    }
    tx.update(bookingRef, {
      loyaltyRecord: {
        version: 1, processingStatus: "processed", profileCollection: profileCol, userId,
        pointsAwarded: config.enabled ? 1 : 0,
        reservationsPerFreeDay: Math.max(1, config.reservationsPerFreeDay),
        freeDaysUsed, processedAt: new Date(),
      },
      loyaltyFreeDaysUsed: freeDaysUsed,
    })
  })
}
