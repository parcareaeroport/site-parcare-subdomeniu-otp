import { getMobileAppSettings } from "@/lib/mobile-app-settings"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import {
  validateMobileBookingPayload,
  type MobileBookingPayload,
} from "@/lib/mobile-booking-mapper"
import { applyLoyaltyPricingToMobilePayload } from "@/lib/mobile-loyalty-pricing"
import type { NetopiaPaymentMethod } from "@/lib/mobile-netopia-types"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { resolveActivePaymentProvider } from "@/lib/payments/payment-provider"
import { createMobileNetopiaPaymentSession } from "@/lib/payments/netopia-provider"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const settings = await getMobileAppSettings()
    const provider = resolveActivePaymentProvider(settings)

    if (provider !== "netopia" || !settings.netopiaEnabled) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Netopia is not the active payment provider",
          activeProvider: provider,
        },
        501
      )
    }

    const body = await request.json()
    const {
      amount,
      orderId,
      saveCard,
      selectedPaymentToken,
      paymentMethod,
      ...bookingFields
    } = body || {}

    const validated = validateMobileBookingPayload(bookingFields as MobileBookingPayload)
    if (!validated.ok) {
      return mobileJsonResponse({ success: false, error: validated.error }, 400)
    }

    let payload = validated.data
    const profileCol = auth.user.isGuest ? ("guests" as const) : ("users" as const)
    const loyaltyPricing = await applyLoyaltyPricingToMobilePayload(
      payload,
      auth.user.uid,
      profileCol,
      "online"
    )
    payload = loyaltyPricing.payload

    const parsedAmount = loyaltyPricing.finalAmount
    if (!parsedAmount || parsedAmount < 0) {
      return mobileJsonResponse({ success: false, error: "Invalid amount" }, 400)
    }

    const resolvedOrderId =
      typeof orderId === "string" && orderId.trim()
        ? orderId.trim()
        : `mobile_netopia_${auth.user.uid}_${Date.now()}`

    const resolvedPaymentMethod: NetopiaPaymentMethod =
      paymentMethod === "google_pay" || paymentMethod === "apple_pay"
        ? paymentMethod
        : "card"

    const session = await createMobileNetopiaPaymentSession(
      payload,
      {
        userId: auth.user.uid,
        isGuest: auth.user.isGuest,
        paymentProvider: "netopia",
        loyaltyFreeDayApplied: loyaltyPricing.applied,
      },
      parsedAmount,
      resolvedOrderId,
      {
        saveCard: !!saveCard,
        selectedPaymentToken:
          typeof selectedPaymentToken === "string" ? selectedPaymentToken : undefined,
        paymentMethod: resolvedPaymentMethod,
      }
    )

    return mobileJsonResponse({
      success: true,
      provider: "netopia",
      paymentUrl: session.paymentUrl,
      authenticationUrl: session.authenticationUrl,
      ntpID: session.ntpID,
      status: session.status,
      orderId: resolvedOrderId,
      amount: parsedAmount,
      loyaltyFreeDayApplied: loyaltyPricing.applied,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
