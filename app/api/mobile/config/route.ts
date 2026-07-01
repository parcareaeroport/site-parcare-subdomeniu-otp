import { getPricingSettings } from "@/lib/pricing-settings"
import { getMobileAppSettings } from "@/lib/mobile-app-settings"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { getDoc, doc, db } from "@/lib/server-firestore"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET() {
  try {
    const settings = await getMobileAppSettings()
    const pricingSettings = await getPricingSettings()

    let reservationsEnabled = settings.reservationsEnabled
    if (reservationsEnabled) {
      try {
        const reservationSettingsSnap = await getDoc(doc(db, "config", "reservationSettings"))
        if (reservationSettingsSnap.exists()) {
          const rs = reservationSettingsSnap.data() || {}
          reservationsEnabled = rs.reservationsEnabled !== false
        }
      } catch {
        // keep settings default
      }
    }

    return mobileJsonResponse({
      success: true,
      paymentProvider: settings.paymentProvider,
      stripeEnabled: settings.stripeEnabled,
      netopiaEnabled: settings.netopiaEnabled,
      netopia: settings.netopia,
      netopiaForcedTestMode: settings.netopiaForcedTestMode,
      netopiaForcedTestAmount: settings.netopiaForcedTestAmount,
      pricesEnabled: settings.pricesEnabled,
      reservationsEnabled,
      appUpdate: settings.appUpdate,
      loyaltyProgram: settings.loyaltyProgram,
      testPaymentEnabled: settings.testPaymentEnabled,
      onlineDiscountPercent: pricingSettings.mobileOnlineDiscountPercent,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}

export async function POST() {
  return mobileJsonResponse({ error: "Method not allowed" }, 405)
}
