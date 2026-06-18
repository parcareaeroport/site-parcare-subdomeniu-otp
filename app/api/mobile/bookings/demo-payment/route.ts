import { createBookingWithFirestore } from "@/app/actions/booking-actions"
import { verifyMobileUser } from "@/lib/mobile-api-auth"
import {
  mapMobilePayloadToFormData,
  MOBILE_BOOKING_ORIGIN,
  validateMobileBookingPayload,
} from "@/lib/mobile-booking-mapper"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

export async function POST(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const body = await request.json()
    const validated = validateMobileBookingPayload(body)
    if (!validated.ok) {
      return mobileJsonResponse({ success: false, error: validated.error }, 400)
    }

    const payload = validated.data
    if (auth.user.email && !payload.email) {
      payload.email = auth.user.email
    }

    const formData = mapMobilePayloadToFormData(payload)

    const result = await createBookingWithFirestore(formData, {
      clientEmail: payload.email,
      clientPhone: payload.phone,
      numberOfPersons: payload.numberOfPersons ?? 1,
      paymentStatus: "paid",
      source: "test_mode",
      bookingOrigin: MOBILE_BOOKING_ORIGIN,
      userId: auth.user.uid,
      paymentProvider: undefined,
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
    })

    return mobileJsonResponse(result, result.success ? 200 : 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mobileJsonResponse({ success: false, error: message }, 500)
  }
}
