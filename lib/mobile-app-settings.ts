import { doc, getDoc, db } from "@/lib/server-firestore"
import {
  DEFAULT_MOBILE_APP_SETTINGS,
  getLoyaltyProgramFromSettings,
  normalizeAppUpdate,
  normalizeNetopiaFeatures,
  type MobileAppSettings,
} from "@/lib/mobile-app-settings.shared"

export * from "@/lib/mobile-app-settings.shared"

export async function getMobileAppSettings(): Promise<MobileAppSettings> {
  try {
    const snap = await getDoc(doc(db, "config", "mobileAppSettings"))
    if (!snap.exists()) {
      return DEFAULT_MOBILE_APP_SETTINGS
    }

    const data = snap.data() || {}
    const paymentProvider =
      data.paymentProvider === "netopia" && data.netopiaEnabled
        ? "netopia"
        : data.paymentProvider === "netopia" && !data.netopiaEnabled
          ? "stripe"
          : data.paymentProvider === "stripe"
            ? "stripe"
            : DEFAULT_MOBILE_APP_SETTINGS.paymentProvider

    return {
      paymentProvider,
      stripeEnabled: data.stripeEnabled !== false,
      netopiaEnabled: !!data.netopiaEnabled,
      netopia: normalizeNetopiaFeatures(data.netopia),
      pricesEnabled: data.pricesEnabled !== false,
      reservationsEnabled: data.reservationsEnabled !== false,
      testPaymentEnabled: !!data.testPaymentEnabled,
      appUpdate: normalizeAppUpdate(data.appUpdate),
      loyaltyProgram: getLoyaltyProgramFromSettings(data),
    }
  } catch (error) {
    console.warn("[mobile-app-settings] Failed to load settings, using defaults.", error)
    return DEFAULT_MOBILE_APP_SETTINGS
  }
}
