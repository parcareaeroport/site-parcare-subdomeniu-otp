import { computeBillableDaysFromMobilePayload } from "@/lib/booking-pricing"
import { getMobileUserProfile, type ProfileCollection } from "@/lib/mobile-user-service"
import {
  resolveMobileBookingAmountWithLoyalty,
  type LoyaltyState,
} from "@/lib/loyalty-program"
import type { MobileBookingPayload } from "@/lib/mobile-booking-mapper"

export async function applyLoyaltyPricingToMobilePayload(
  payload: MobileBookingPayload,
  userId: string,
  profileCol: ProfileCollection,
  paymentMethod: "online" | "at_parking"
): Promise<{
  payload: MobileBookingPayload
  applied: boolean
  baseAmount: number
  finalAmount: number
  discountAmount: number
  billableDays: number
}> {
  const profile = await getMobileUserProfile(userId, profileCol)
  const billableDays = computeBillableDaysFromMobilePayload(payload)
  const pricing = await resolveMobileBookingAmountWithLoyalty({
    billableDays,
    paymentMethod,
    loyalty: profile?.loyalty as LoyaltyState | undefined,
  })

  return {
    payload: {
      ...payload,
      days: billableDays,
      amount: pricing.finalAmount,
    },
    applied: pricing.applied,
    baseAmount: pricing.baseAmount,
    finalAmount: pricing.finalAmount,
    discountAmount: pricing.discountAmount,
    billableDays,
  }
}
