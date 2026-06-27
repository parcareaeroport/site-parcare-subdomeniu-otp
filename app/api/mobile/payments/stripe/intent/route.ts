import { getMobileAppSettings } from "@/lib/mobile-app-settings"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import {
  validateMobileBookingPayload,
  type MobileBookingPayload,
} from "@/lib/mobile-booking-mapper"
import { applyLoyaltyPricingToMobilePayload } from "@/lib/mobile-loyalty-pricing"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { resolveActivePaymentProvider } from "@/lib/payments/payment-provider"
import { createMobileStripePaymentIntent } from "@/lib/payments/stripe-provider"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const { amount, orderId, ...bookingFields } = body || {}

    const validated = validateMobileBookingPayload(bookingFields as MobileBookingPayload)
    if (!validated.ok) {
      return mobileJsonResponse({ success: false, error: validated.error }, 400)
    }

    let payload = validated.data
    if (auth.user.email && !payload.email) {
      payload.email = auth.user.email
    }

    const settings = await getMobileAppSettings()
    const provider = resolveActivePaymentProvider(settings)

    if (provider !== "stripe" || !settings.stripeEnabled) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Stripe is not the active payment provider",
          activeProvider: provider,
        },
        400
      )
    }

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
        : `mobile_${auth.user.uid}_${Date.now()}`

    const stripeResult = await createMobileStripePaymentIntent(
      payload,
      {
        userId: auth.user.uid,
        isGuest: auth.user.isGuest,
        paymentProvider: "stripe",
        loyaltyFreeDayApplied: loyaltyPricing.applied,
      },
      parsedAmount,
      resolvedOrderId
    )

    return mobileJsonResponse({
      success: true,
      provider: "stripe",
      clientSecret: stripeResult.clientSecret,
      paymentIntentId: stripeResult.paymentIntentId,
      orderId: resolvedOrderId,
      amount: parsedAmount,
      loyaltyFreeDayApplied: loyaltyPricing.applied,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
