import { getMobileAppSettings } from "@/lib/mobile-app-settings"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import {
  mapMobilePayloadToFormData,
  MOBILE_BOOKING_ORIGIN,
  validateMobileBookingPayload,
  type MobileBookingPayload,
} from "@/lib/mobile-booking-mapper"
import { createBookingWithFirestore } from "@/app/actions/booking-actions"
import { applyLoyaltyPricingToMobilePayload } from "@/lib/mobile-loyalty-pricing"
import type { NetopiaPaymentMethod } from "@/lib/mobile-netopia-types"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { resolveActivePaymentProvider } from "@/lib/payments/payment-provider"
import { createMobileNetopiaPaymentSession } from "@/lib/payments/netopia-provider"
import { recordPaymentAuditEvent } from "@/lib/payments/payment-audit"
import { getNetopiaForcedTestConfig } from "@/lib/payments/netopia-test-mode"
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
    console.info("[netopia-init] Request received", {
      userId: auth.user.uid,
      isGuest: auth.user.isGuest,
    })

    const settings = await getMobileAppSettings()
    const provider = resolveActivePaymentProvider(settings)
    console.info("[netopia-init] Payment settings resolved", {
      provider,
      netopiaEnabled: settings.netopiaEnabled,
      stripeEnabled: settings.stripeEnabled,
    })

    if (provider !== "netopia" || !settings.netopiaEnabled) {
      console.warn("[netopia-init] Netopia rejected by settings", {
        provider,
        netopiaEnabled: settings.netopiaEnabled,
      })
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
    console.info("[netopia-init] Request body parsed", {
      hasOrderId: typeof orderId === "string" && orderId.trim().length > 0,
      saveCard: !!saveCard,
      hasSelectedPaymentToken: typeof selectedPaymentToken === "string",
      paymentMethod:
        paymentMethod === "google_pay" || paymentMethod === "apple_pay"
          ? paymentMethod
          : "card",
    })

    const validated = validateMobileBookingPayload(bookingFields as MobileBookingPayload)
    if (!validated.ok) {
      console.warn("[netopia-init] Payload validation failed", {
        error: validated.error,
      })
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
      console.warn("[netopia-init] Booking window blocked before payment", {
        userId: auth.user.uid,
        code: windowValidation.code,
        licensePlate: payload.licensePlate,
        startDate: payload.startDate,
        startTime: payload.startTime,
        endDate: payload.endDate,
        endTime: payload.endTime,
      })
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
      console.warn("[netopia-init] Duplicate reservation blocked before payment", {
        userId: auth.user.uid,
        licensePlate: payload.licensePlate,
        startDate: payload.startDate,
        startTime: payload.startTime,
        endDate: payload.endDate,
        endTime: payload.endTime,
        existingBookingId: duplicateCheck.existingBooking?.id,
        existingBookingNumber: duplicateCheck.existingBooking?.apiBookingNumber,
      })
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

    const profileCol = auth.user.isGuest ? ("guests" as const) : ("users" as const)
    const loyaltyPricing = await applyLoyaltyPricingToMobilePayload(
      payload,
      auth.user.uid,
      profileCol,
      "online"
    )
    payload = loyaltyPricing.payload
    console.info("[netopia-init] Loyalty pricing resolved", {
      userId: auth.user.uid,
      profileCol,
      applied: loyaltyPricing.applied,
      baseAmount: loyaltyPricing.baseAmount,
      finalAmount: loyaltyPricing.finalAmount,
      billableDays: loyaltyPricing.billableDays,
    })

    const parsedAmount = loyaltyPricing.finalAmount
    if (!parsedAmount || parsedAmount < 0) {
      console.warn("[netopia-init] Invalid amount after loyalty pricing", {
        parsedAmount,
      })
      return mobileJsonResponse({ success: false, error: "Invalid amount" }, 400)
    }

    const resolvedOrderId =
      typeof orderId === "string" && orderId.trim()
        ? orderId.trim()
        : `mobile_netopia_${auth.user.uid}_${Date.now()}`
    const forcedTestConfig = getNetopiaForcedTestConfig()
    const availableCredit = forcedTestConfig.enabled ? 0 : await getUserCreditBalance(auth.user.uid)
    const creditAppliedAmount = forcedTestConfig.enabled
      ? 0
      : Math.min(parsedAmount, Math.max(0, availableCredit))
    const amountAfterCredit = Math.round((parsedAmount - creditAppliedAmount) * 100) / 100
    const effectiveChargedAmount = forcedTestConfig.enabled
      ? forcedTestConfig.amount
      : amountAfterCredit

    const resolvedPaymentMethod: NetopiaPaymentMethod =
      paymentMethod === "google_pay" || paymentMethod === "apple_pay"
        ? paymentMethod
        : "card"

    await recordPaymentAuditEvent(resolvedOrderId, "init_received", {
      status: "info",
      message: "Netopia init request received",
      provider: "netopia",
      orderId: resolvedOrderId,
      userId: auth.user.uid,
      paymentTestMode: forcedTestConfig.enabled,
      realAmount: parsedAmount,
      chargedAmount: effectiveChargedAmount,
      extra: {
        isGuest: auth.user.isGuest,
        paymentMethod: resolvedPaymentMethod,
        availableCredit,
        creditAppliedAmount,
      },
    })

    if (forcedTestConfig.enabled) {
      console.warn("[netopia-init] Forced test amount active", {
        orderId: resolvedOrderId,
        realAmount: parsedAmount,
        chargedAmount: effectiveChargedAmount,
      })
      await recordPaymentAuditEvent(resolvedOrderId, "amount_overridden", {
        status: "info",
        message: `Forced test amount applied: ${effectiveChargedAmount} RON`,
        provider: "netopia",
        orderId: resolvedOrderId,
        userId: auth.user.uid,
        paymentTestMode: true,
        realAmount: parsedAmount,
        chargedAmount: effectiveChargedAmount,
      })
    }

    if (effectiveChargedAmount <= 0) {
      console.info("[netopia-init] Booking fully covered by credit, creating without external payment", {
        orderId: resolvedOrderId,
        userId: auth.user.uid,
        realAmount: parsedAmount,
        creditAppliedAmount,
      })
      const formData = mapMobilePayloadToFormData(payload)
      const bookingResult = await createBookingWithFirestore(formData, {
        clientEmail: payload.email,
        clientPhone: payload.phone,
        numberOfPersons: payload.numberOfPersons ?? 1,
        paymentStatus: "paid",
        source: "webhook",
        bookingOrigin: MOBILE_BOOKING_ORIGIN,
        userId: auth.user.uid,
        profileIsGuest: auth.user.isGuest,
        paymentProvider: "netopia",
        paymentOrderId: resolvedOrderId,
        paymentIntentId: resolvedOrderId,
        amount: parsedAmount,
        days: payload.days,
        address: payload.address,
        city: payload.city,
        county: payload.county,
        postalCode: payload.postalCode,
        country: payload.country,
        needInvoice: payload.needInvoice,
        company: payload.needInvoice ? payload.company || undefined : undefined,
        companyVAT: payload.needInvoice ? payload.companyVAT || undefined : undefined,
        companyReg: payload.needInvoice ? payload.companyReg || undefined : undefined,
        companyAddress: payload.needInvoice ? payload.companyAddress || undefined : undefined,
        orderNotes: payload.orderNotes,
        termsAccepted: true,
        loyaltyFreeDayApplied: loyaltyPricing.applied,
        creditAppliedAmount,
        creditAppliedSource: "mobile_booking_credit",
      })

      if (!bookingResult.success) {
        return mobileJsonResponse({ success: false, error: bookingResult.message || "Booking creation failed" }, 400)
      }

      return mobileJsonResponse({
        success: true,
        provider: "netopia",
        status: "paid",
        orderId: resolvedOrderId,
        amount: 0,
        realAmount: parsedAmount,
        creditAppliedAmount,
        bookingId: bookingResult.firestoreId,
        bookingNumber: bookingResult.bookingNumber || undefined,
        loyaltyFreeDayApplied: loyaltyPricing.applied,
      })
    }

    console.info("[netopia-init] Creating Netopia session", {
      orderId: resolvedOrderId,
      amount: effectiveChargedAmount,
      realAmount: parsedAmount,
      creditAppliedAmount,
      paymentTestMode: forcedTestConfig.enabled,
      paymentMethod: resolvedPaymentMethod,
    })
    const session = await createMobileNetopiaPaymentSession(
      payload,
      {
        userId: auth.user.uid,
        isGuest: auth.user.isGuest,
        paymentProvider: "netopia",
        loyaltyFreeDayApplied: loyaltyPricing.applied,
      },
      effectiveChargedAmount,
      resolvedOrderId,
      {
        saveCard: !!saveCard,
        selectedPaymentToken:
          typeof selectedPaymentToken === "string" ? selectedPaymentToken : undefined,
        paymentMethod: resolvedPaymentMethod,
        realAmount: parsedAmount,
        chargedAmount: effectiveChargedAmount,
        paymentTestMode: forcedTestConfig.enabled,
        pendingPaymentExtra: {
          paymentType: "booking_create",
          creditAppliedAmount,
          creditAvailableAtInit: availableCredit,
        },
      }
    )
    console.info("[netopia-init] Netopia session created", {
      orderId: resolvedOrderId,
      status: session.status,
      hasPaymentUrl: !!session.paymentUrl,
      hasAuthenticationUrl: !!session.authenticationUrl,
      hasNtpId: !!session.ntpID,
      chargedAmount: session.chargedAmount,
      realAmount: session.realAmount,
      paymentTestMode: session.paymentTestMode,
    })

    return mobileJsonResponse({
      success: true,
      provider: "netopia",
      paymentUrl: session.paymentUrl,
      authenticationUrl: session.authenticationUrl,
      ntpID: session.ntpID,
      status: session.status,
      orderId: resolvedOrderId,
      amount: session.chargedAmount,
      realAmount: session.realAmount,
      creditAppliedAmount,
      paymentTestMode: session.paymentTestMode,
      loyaltyFreeDayApplied: loyaltyPricing.applied,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[netopia-init] Request failed", {
      userId: auth.user.uid,
      isGuest: auth.user.isGuest,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
