import type { MobileBookingPayload, MobileBookingContext } from "@/lib/mobile-booking-mapper"
import type { NetopiaPaymentMethod } from "@/lib/mobile-netopia-types"
import { recordPaymentAuditEvent } from "@/lib/payments/payment-audit"
import { db, doc, setDoc, serverTimestamp } from "@/lib/server-firestore"

const NETOPIA_SANDBOX_URL = "https://secure.sandbox.netopia-payments.com"
const NETOPIA_LIVE_URL = "https://secure.mobilpay.ro/pay"

export type NetopiaPaymentSessionOptions = {
  saveCard?: boolean
  selectedPaymentToken?: string
  paymentMethod?: NetopiaPaymentMethod
  realAmount?: number
  chargedAmount?: number
  paymentTestMode?: boolean
}

export type NetopiaPaymentSessionResult = {
  paymentUrl?: string
  authenticationUrl?: string
  ntpID?: string
  orderId: string
  status: "pending" | "requires_action" | "paid" | "failed"
  realAmount: number
  chargedAmount: number
  paymentTestMode: boolean
}

function sanitizeFirestoreValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestoreValue(item))
      .filter((item) => item !== undefined) as T
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, sanitizeFirestoreValue(entryValue)])

    return Object.fromEntries(entries) as T
  }

  return value
}

function getNetopiaConfig() {
  const apiKey = process.env.NETOPIA_API_KEY
  const posSignature = process.env.NETOPIA_POS_SIGNATURE
  const isLive = process.env.NETOPIA_IS_LIVE === "true"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://rezervari.otp-parking.ro"
  const notifyUrl = `${appUrl.replace(/\/$/, "")}/api/mobile/payments/netopia/ipn`
  const redirectUrl = `${appUrl.replace(/\/$/, "")}/api/mobile/payments/netopia/redirect`

  return { apiKey, posSignature, isLive, notifyUrl, redirectUrl }
}

export async function createMobileNetopiaPaymentSession(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext,
  amount: number,
  orderId: string,
  options?: NetopiaPaymentSessionOptions
): Promise<NetopiaPaymentSessionResult> {
  const { apiKey, posSignature, isLive, notifyUrl, redirectUrl } = getNetopiaConfig()
  const realAmount = options?.realAmount ?? amount
  const chargedAmount = options?.chargedAmount ?? amount
  const paymentTestMode = !!options?.paymentTestMode
  console.info("[netopia-provider] Config resolved", {
    hasApiKey: !!apiKey,
    hasPosSignature: !!posSignature,
    isLive,
    notifyUrl,
    redirectUrl,
    orderId,
    userId: ctx.userId,
    isGuest: !!ctx.isGuest,
    amount: chargedAmount,
    realAmount,
    paymentTestMode,
  })

  if (!apiKey || !posSignature) {
    console.error("[netopia-provider] Missing configuration", {
      hasApiKey: !!apiKey,
      hasPosSignature: !!posSignature,
      isLive,
      orderId,
    })
    await recordPaymentAuditEvent(orderId, "netopia_session_failed", {
      status: "failed",
      message: "Netopia configuration missing",
      provider: "netopia",
      orderId,
      userId: ctx.userId,
      paymentTestMode,
      realAmount,
      chargedAmount,
    })
    throw new Error(
      "Netopia is not configured. Set NETOPIA_API_KEY and NETOPIA_POS_SIGNATURE environment variables."
    )
  }

  const baseUrl = isLive ? NETOPIA_LIVE_URL : NETOPIA_SANDBOX_URL
  console.info("[netopia-provider] Preparing Netopia request", {
    baseUrl,
    orderId,
    amount: chargedAmount,
    realAmount,
    paymentTestMode,
  })

  const requestBody = {
    config: {
      emailTemplate: "default",
      notifyUrl,
      redirectUrl: `${redirectUrl}?orderId=${encodeURIComponent(orderId)}`,
      language: "ro",
    },
    payment: {
      options: { installments: 0, bonus: 0 },
      instrument: null,
      data: {},
    },
    order: {
      ntpID: "",
      posSignature,
      dateTime: new Date().toISOString(),
      orderID: orderId,
      description: `Rezervare parcare OTP Parking – ${payload.startDate} → ${payload.endDate}`,
      amount: chargedAmount,
      currency: "RON",
      billing: {
        email: payload.email || "client@otpparking.ro",
        phone: payload.phone || "",
        firstName: payload.firstName || "Client",
        lastName: payload.lastName || "",
        city: payload.city || "București",
        country: 642,
        countryName: "Romania",
        state: payload.county || "București",
        postalCode: payload.postalCode || "000000",
        details: payload.address || "",
      },
      products: [
        {
          name: `Parcare OTP Parking ${payload.days || 1} zi${(payload.days || 1) > 1 ? "le" : ""}`,
          code: orderId,
          category: "Parcare",
          price: chargedAmount,
          vat: 19,
        },
      ],
      installments: { selected: 0, available: [0] },
      data: {},
    },
  }

  const response = await fetch(`${baseUrl}/payment/card/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify(requestBody),
  })

  const result = await response.json()
  console.info("[netopia-provider] Netopia response received", {
    orderId,
    httpStatus: response.status,
    ok: response.ok,
      resultCode: result?.code,
      paymentTestMode,
      realAmount,
      chargedAmount,
      hasPaymentUrl:
      !!result?.data?.payment?.paymentURL ||
      !!result?.data?.paymentURL ||
      !!result?.data?.customerAction?.url ||
      !!result?.paymentURL ||
      !!result?.customerAction?.url,
  })

  if (!response.ok || (result.code && result.code !== 200 && result.code !== 100 && result.code !== 101)) {
    const errorMsg =
      result?.data?.error?.message ||
      result?.message ||
      `NETOPIA returned status ${response.status}`
    console.error("[netopia-provider] Netopia returned an error", {
      orderId,
      httpStatus: response.status,
      ok: response.ok,
      resultCode: result?.code,
      errorMsg,
    })
    await recordPaymentAuditEvent(orderId, "netopia_session_failed", {
      status: "failed",
      message: `Netopia returned error: ${errorMsg}`,
      provider: "netopia",
      orderId,
      userId: ctx.userId,
      paymentTestMode,
      realAmount,
      chargedAmount,
      extra: {
        httpStatus: response.status,
        resultCode: result?.code,
      },
    })
    throw new Error(`Netopia error: ${errorMsg}`)
  }

  const paymentData = result.data || result
  const paymentUrl =
    paymentData?.payment?.paymentURL ||
    paymentData?.paymentURL ||
    paymentData?.customerAction?.url
  const ntpID =
    paymentData?.payment?.ntpID?.toString() ||
    paymentData?.ntpID?.toString() ||
    ""
  const bookingPayloadForStorage = sanitizeFirestoreValue({
    ...payload,
    postalCode: payload.postalCode || "000000",
  })

  await setDoc(doc(db, "pendingPayments", orderId), {
    orderId,
    ntpID,
    userId: ctx.userId,
    isGuest: !!ctx.isGuest,
    amount: chargedAmount,
    realAmount,
    chargedAmount,
    currency: "RON",
    status: "pending",
    provider: "netopia",
    paymentProvider: "netopia",
    paymentTestMode,
    bookingPayload: bookingPayloadForStorage,
    loyaltyFreeDayApplied: !!ctx.loyaltyFreeDayApplied,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  console.info("[netopia-provider] Pending payment persisted", {
    orderId,
    ntpID,
    status: "pending",
    realAmount,
    chargedAmount,
    paymentTestMode,
  })
  await recordPaymentAuditEvent(orderId, "netopia_session_created", {
    status: "success",
    message: "Netopia payment session persisted",
    provider: "netopia",
    orderId,
    userId: ctx.userId,
    paymentTestMode,
    realAmount,
    chargedAmount,
    extra: {
      ntpID,
      hasPaymentUrl: !!paymentUrl,
    },
  })

  return {
    paymentUrl: paymentUrl || undefined,
    ntpID: ntpID || undefined,
    orderId,
    status: paymentUrl ? "requires_action" : "pending",
    realAmount,
    chargedAmount,
    paymentTestMode,
  }
}

export async function getNetopiaPaymentStatus(ntpID: string) {
  const { apiKey, isLive } = getNetopiaConfig()
  if (!apiKey) throw new Error("NETOPIA_API_KEY not configured")

  const baseUrl = isLive ? NETOPIA_LIVE_URL : NETOPIA_SANDBOX_URL

  const response = await fetch(`${baseUrl}/payment/card/status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ ntpID }),
  })

  return response.json()
}
