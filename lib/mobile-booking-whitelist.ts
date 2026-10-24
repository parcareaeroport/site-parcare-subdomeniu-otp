import { adminDb } from "@/lib/firebase-admin"
import { normalizeLicensePlate } from "@/lib/utils"

export const LICENSE_PLATE_NOT_ALLOWED = "LICENSE_PLATE_NOT_ALLOWED"
export const LICENSE_PLATE_NOT_ALLOWED_MESSAGE =
  "Aplicația nu permite rezervarea pentru acest număr de înmatriculare."

export const MOBILE_BOOKING_PLATE_REJECTION = {
  success: false,
  code: LICENSE_PLATE_NOT_ALLOWED,
  error: LICENSE_PLATE_NOT_ALLOWED_MESSAGE,
} as const

/** Mobile entrypoints only. An existing booking may keep its current plate. */
export async function isMobileBookingPlateBlocked(
  licensePlate: string,
  currentLicensePlate?: string
): Promise<boolean> {
  const plate = normalizeLicensePlate(licensePlate)
  if (!plate || (currentLicensePlate !== undefined && plate === normalizeLicensePlate(currentLicensePlate))) {
    return false
  }

  try {
    const entry = await adminDb.collection("lpr_whitelist").doc(plate).get()
    return entry.exists
  } catch (error) {
    // Preserve booking availability during a whitelist-only outage.
    console.error("[mobile-booking-whitelist] Read failed; continuing existing booking checks", {
      code: (error as { code?: unknown } | null)?.code,
    })
    return false
  }
}
