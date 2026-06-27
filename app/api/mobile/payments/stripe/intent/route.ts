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
import { checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { validateMobileBookingWindow } from "@/lib/mobile-booking-window"
import { getUserCreditBalance } from "@/lib/user-credits"

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
    const windowValidation = validateMobileBookingWindow({
      startDate: payload.startDate,
      startTime: payload.startTime,
      endDate: payload.endDate,
      endTime: payload.endTime,
    })

    if (!windowValidation.ok) {
      return mobileJsonResponse(
        {
          success: false,
          error: windowValidation.message,
          code: windowValidation.code,
        },
        400
      )
    }

    const duplicateCheck = await checkExistingReservationByLicensePlate(
      payload.licensePlate,
      payload.startDate,
      payload.endDate,
      payload.startTime,
      payload.endTime
    )

    if (duplicateCheck.exists) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Există deja o rezervare activă pentru acest număr de înmatriculare în perioada selectată.",
          code: "DUPLICATE_LICENSE_PLATE_PERIOD",
          duplicateReservation: true,
          existingBooking: duplicateCheck.existingBooking,
        },
        409
      )
    }

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
    const availableCredit = await getUserCreditBalance(auth.user.uid)
    const creditAppliedAmount = Math.min(parsedAmount, Math.max(0, availableCredit))
    const amountToCharge = Math.round((parsedAmount - creditAppliedAmount) * 100) / 100

    if (amountToCharge <= 0) {
      return mobileJsonResponse(
        {
          success: false,
          error: "Rezervarea este acoperită integral de credit. Folosește plata NETOPIA sau contactează suportul.",
          creditAppliedAmount,
        },
        400
      )
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
        creditAppliedAmount,
        totalBookingAmount: parsedAmount,
      },
      amountToCharge,
      resolvedOrderId
    )

    return mobileJsonResponse({
      success: true,
      provider: "stripe",
      clientSecret: stripeResult.clientSecret,
      paymentIntentId: stripeResult.paymentIntentId,
      orderId: resolvedOrderId,
      amount: amountToCharge,
      realAmount: parsedAmount,
      creditAppliedAmount,
      loyaltyFreeDayApplied: loyaltyPricing.applied,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
