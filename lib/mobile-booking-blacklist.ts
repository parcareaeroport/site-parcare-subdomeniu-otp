import { adminDb } from "@/lib/firebase-admin"
import { normalizeLicensePlate } from "@/lib/utils"

export const MOBILE_BOOKING_BLACKLIST_COLLECTION = "mobile_booking_blacklist"
export const MOBILE_BOOKING_BLOCKED = "MOBILE_BOOKING_BLOCKED"
export const MOBILE_BOOKING_BLOCKED_MESSAGE =
  "Rezervarea din aplicație nu este permisă pentru aceste date. Contactează parcarea."

export type MobileBookingBlacklistEntry = {
  id: string
  name: string
  email: string
  licensePlate: string
  createdAt: string | null
}

/** Only call at new mobile booking/payment entrypoints, never payment callbacks. */
export async function getMobileBookingBlacklistRejection(input: {
  licensePlate?: string
  emails: (string | null | undefined)[]
}) {
  const plate = normalizeLicensePlate(input.licensePlate || "")
  const emails = [...new Set(input.emails.map(email => (email || "").trim().toLowerCase()).filter(Boolean))]

  try {
    const entries = adminDb.collection(MOBILE_BOOKING_BLACKLIST_COLLECTION)
    const checks = []
    if (plate) checks.push(entries.where("licensePlate", "==", plate).limit(1).get())
    // Equality queries need no composite index and never load the whole list.
    for (const email of emails) checks.push(entries.where("email", "==", email).limit(1).get())
    const matches = await Promise.all(checks)
    if (matches.some(snapshot => !snapshot.empty)) {
      return {
        status: 409,
        body: { success: false, code: MOBILE_BOOKING_BLOCKED, error: MOBILE_BOOKING_BLOCKED_MESSAGE },
      }
    }
    return null
  } catch (error) {
    console.error("[mobile-booking-blacklist] Verification failed", {
      code: (error as { code?: unknown } | null)?.code,
    })
    return {
      status: 503,
      body: {
        success: false,
        code: "BOOKING_CHECK_UNAVAILABLE",
        error: "Nu putem verifica rezervarea momentan. Încearcă din nou",
      },
    }
  }
}
