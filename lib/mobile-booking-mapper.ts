import { createBookingWithFirestore } from "@/app/actions/booking-actions"
import { normalizeLicensePlate } from "@/lib/utils"

export const MOBILE_BOOKING_ORIGIN = "mobile-app"

export type MobilePaymentProvider = "stripe" | "netopia"

export type MobileBookingPayload = {
  licensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  numberOfPersons?: number
  days?: number
  amount?: number
  needInvoice?: boolean
  company?: string | null
  companyVAT?: string | null
  companyReg?: string | null
  companyAddress?: string | null
  address?: string
  city?: string
  county?: string
  postalCode?: string
  country?: string
  orderNotes?: string
}

export type MobileBookingContext = {
  userId: string
  paymentProvider?: MobilePaymentProvider
  paymentIntentId?: string
}

export function validateMobileBookingPayload(
  payload: Partial<MobileBookingPayload> | null | undefined
): { ok: true; data: MobileBookingPayload } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Invalid request body" }
  }

  const {
    licensePlate,
    startDate,
    startTime,
    endDate,
    endTime,
  } = payload

  if (!licensePlate || !startDate || !startTime || !endDate || !endTime) {
    return {
      ok: false,
      error:
        "Missing required fields: licensePlate, startDate, startTime, endDate, endTime",
    }
  }

  return {
    ok: true,
    data: {
      licensePlate: normalizeLicensePlate(String(licensePlate)),
      startDate: String(startDate),
      startTime: String(startTime),
      endDate: String(endDate),
      endTime: String(endTime),
      firstName: payload.firstName ? String(payload.firstName) : undefined,
      lastName: payload.lastName ? String(payload.lastName) : undefined,
      email: payload.email ? String(payload.email) : undefined,
      phone: payload.phone ? String(payload.phone) : undefined,
      numberOfPersons:
        payload.numberOfPersons !== undefined
          ? parseInt(String(payload.numberOfPersons), 10) || 1
          : 1,
      days:
        payload.days !== undefined
          ? parseInt(String(payload.days), 10) || undefined
          : undefined,
      amount:
        payload.amount !== undefined
          ? parseFloat(String(payload.amount)) || undefined
          : undefined,
      needInvoice: !!payload.needInvoice,
      company: payload.company ? String(payload.company) : undefined,
      companyVAT: payload.companyVAT ? String(payload.companyVAT) : undefined,
      companyReg: payload.companyReg ? String(payload.companyReg) : undefined,
      companyAddress: payload.companyAddress
        ? String(payload.companyAddress)
        : undefined,
      address: payload.address ? String(payload.address) : undefined,
      city: payload.city ? String(payload.city) : undefined,
      county: payload.county ? String(payload.county) : undefined,
      postalCode: payload.postalCode ? String(payload.postalCode) : undefined,
      country: payload.country ? String(payload.country) : undefined,
      orderNotes: payload.orderNotes ? String(payload.orderNotes) : undefined,
    },
  }
}

export function mapMobilePayloadToFormData(payload: MobileBookingPayload): FormData {
  const fd = new FormData()
  fd.append("licensePlate", payload.licensePlate)
  fd.append("startDate", payload.startDate)
  fd.append("startTime", payload.startTime)
  fd.append("endDate", payload.endDate)
  fd.append("endTime", payload.endTime)

  const clientName =
    `${payload.firstName || ""} ${payload.lastName || ""}`.trim() || undefined

  if (clientName) {
    fd.append("clientName", clientName)
  }
  if (payload.firstName) {
    fd.append("clientTitle", payload.firstName)
  }

  return fd
}

export function buildPayOnSiteAdditionalData(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext
) {
  return {
    clientEmail: payload.email,
    clientPhone: payload.phone,
    numberOfPersons: payload.numberOfPersons ?? 1,
    paymentStatus: "pending" as const,
    source: "pay_on_site" as const,
    bookingOrigin: MOBILE_BOOKING_ORIGIN,
    userId: ctx.userId,
    amount: payload.amount,
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
  }
}

export function buildPaidCardAdditionalData(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext
) {
  return {
    clientEmail: payload.email,
    clientPhone: payload.phone,
    numberOfPersons: payload.numberOfPersons ?? 1,
    paymentStatus: "paid" as const,
    source: "webhook" as const,
    bookingOrigin: MOBILE_BOOKING_ORIGIN,
    userId: ctx.userId,
    paymentProvider: ctx.paymentProvider,
    paymentIntentId: ctx.paymentIntentId,
    amount: payload.amount,
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
  }
}

export async function createMobilePayOnSiteBooking(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext
) {
  const formData = mapMobilePayloadToFormData(payload)
  return createBookingWithFirestore(
    formData,
    buildPayOnSiteAdditionalData(payload, ctx)
  )
}

export async function createMobilePaidCardBooking(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext
) {
  const formData = mapMobilePayloadToFormData(payload)
  return createBookingWithFirestore(
    formData,
    buildPaidCardAdditionalData(payload, ctx)
  )
}

export function buildStripeMetadataFromMobilePayload(
  payload: MobileBookingPayload,
  ctx: MobileBookingContext,
  orderId: string
): Record<string, string> {
  const clientName =
    `${payload.firstName || ""} ${payload.lastName || ""}`.trim() || ""

  const metadata: Record<string, string> = {
    orderId,
    sourceUrl: MOBILE_BOOKING_ORIGIN,
    bookingOrigin: MOBILE_BOOKING_ORIGIN,
    userId: ctx.userId,
    customerName: clientName,
    customerEmail: payload.email || "",
    customerPhone: payload.phone || "",
    licensePlate: payload.licensePlate,
    startDate: `${payload.startDate}T${payload.startTime}:00`,
    endDate: `${payload.endDate}T${payload.endTime}:00`,
    startTime: payload.startTime,
    endTime: payload.endTime,
    paymentProvider: ctx.paymentProvider || "stripe",
    numberOfPersons: String(payload.numberOfPersons ?? 1),
  }

  if (payload.days !== undefined) metadata.days = String(payload.days)
  if (payload.address) metadata.address = payload.address
  if (payload.city) metadata.city = payload.city
  if (payload.county) metadata.county = payload.county
  if (payload.postalCode) metadata.postalCode = payload.postalCode
  if (payload.country) metadata.country = payload.country
  if (payload.company) metadata.company = payload.company
  if (payload.companyVAT) metadata.companyVAT = payload.companyVAT
  if (payload.companyReg) metadata.companyReg = payload.companyReg
  if (payload.companyAddress) metadata.companyAddress = payload.companyAddress
  if (payload.orderNotes) metadata.orderNotes = payload.orderNotes
  if (payload.needInvoice !== undefined) {
    metadata.needInvoice = String(payload.needInvoice)
  }
  metadata.termsAccepted = "true"

  return metadata
}
