import {
  DEFAULT_PRICING_SETTINGS,
  normalizePricingSettings,
  type PricingSettings,
} from "@/lib/pricing-settings.shared"
import { db, doc, getDoc } from "@/lib/server-firestore"

export {
  DEFAULT_MOBILE_ONLINE_DISCOUNT_PERCENT,
  DEFAULT_PRICING_SETTINGS,
  normalizeMobileOnlineDiscountPercent,
  normalizePricingSettings,
} from "@/lib/pricing-settings.shared"
export type { PricingSettings } from "@/lib/pricing-settings.shared"

/** Always read Firestore so admin changes (e.g. mobile discount %) apply immediately. */
export async function getPricingSettings(): Promise<PricingSettings> {
  try {
    const snap = await getDoc(doc(db, "config", "pricingSettings"))
    return snap.exists()
      ? normalizePricingSettings(snap.data())
      : DEFAULT_PRICING_SETTINGS
  } catch (error) {
    console.warn("[pricing-settings] Failed to load settings, using defaults.", error)
    return DEFAULT_PRICING_SETTINGS
  }
}
