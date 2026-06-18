import type { MobilePaymentProvider } from "@/lib/mobile-booking-mapper"
import type { MobileAppSettings } from "@/lib/mobile-app-settings"

export type PaymentInitResult = {
  provider: MobilePaymentProvider
  clientSecret?: string
  paymentUrl?: string
  orderId?: string
}

export interface ServerPaymentProvider {
  name: MobilePaymentProvider
  isEnabled(settings: MobileAppSettings): boolean
}

export function resolveActivePaymentProvider(
  settings: MobileAppSettings
): MobilePaymentProvider {
  if (settings.paymentProvider === "netopia" && settings.netopiaEnabled) {
    return "netopia"
  }
  if (settings.paymentProvider === "stripe" && settings.stripeEnabled) {
    return "stripe"
  }
  if (settings.stripeEnabled) return "stripe"
  if (settings.netopiaEnabled) return "netopia"
  return "stripe"
}
