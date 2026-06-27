import type { MobileBookingPayload, MobileBookingContext } from "@/lib/mobile-booking-mapper"
import type { NetopiaPaymentMethod } from "@/lib/mobile-netopia-types"
import { db, doc, setDoc, serverTimestamp } from "@/lib/server-firestore"

const NETOPIA_SANDBOX_URL = "https://secure.sandbox.netopia-payments.com"
const NETOPIA_LIVE_URL = "https://secure.mobilpay.ro/pay"

export type NetopiaPaymentSessionOptions = {
  saveCard?: boolean
  selectedPaymentToken?: string
  paymentMethod?: NetopiaPaymentMethod
}

export type NetopiaPaymentSessionResult = {
  paymentUrl?: string
  authenticationUrl?: string
  ntpID?: string
  orderId: string
  status: "pending" | "requires_action" | "paid" | "failed"
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
  _options?: NetopiaPaymentSessionOptions
): Promise<NetopiaPaymentSessionResult> {
  const { apiKey, posSignature, isLive, notifyUrl, redirectUrl } = getNetopiaConfig()
  console.info("[netopia-provider] Config resolved", {
    hasApiKey: !!apiKey,
    hasPosSignature: !!posSignature,
    isLive,
    notifyUrl,
    redirectUrl,
    orderId,
    userId: ctx.userId,
    isGuest: !!ctx.isGuest,
    amount,
  })

  if (!apiKey || !posSignature) {
    console.error("[netopia-provider] Missing configuration", {
      hasApiKey: !!apiKey,
      hasPosSignature: !!posSignature,
      isLive,
      orderId,
    })
    throw new Error(
      "Netopia is not configured. Set NETOPIA_API_KEY and NETOPIA_POS_SIGNATURE environment variables."
    )
  }

  const baseUrl = isLive ? NETOPIA_LIVE_URL : NETOPIA_SANDBOX_URL
  console.info("[netopia-provider] Preparing Netopia request", {
    baseUrl,
    orderId,
    amount,
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
      amount,
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
          price: amount,
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
    amount,
    currency: "RON",
    status: "pending",
    paymentProvider: "netopia",
    bookingPayload: bookingPayloadForStorage,
    loyaltyFreeDayApplied: !!ctx.loyaltyFreeDayApplied,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  console.info("[netopia-provider] Pending payment persisted", {
    orderId,
    ntpID,
    status: "pending",
  })

  return {
    paymentUrl: paymentUrl || undefined,
    ntpID: ntpID || undefined,
    orderId,
    status: paymentUrl ? "requires_action" : "pending",
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
