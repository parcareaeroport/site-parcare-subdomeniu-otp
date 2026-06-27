import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import {
  sendModificationRequestEmail,
  type ModificationRequested,
} from "@/lib/modification-email"
import { getMobileUserProfile } from "@/lib/mobile-user-service"
import { db, doc, getDoc, serverTimestamp, updateDoc } from "@/lib/server-firestore"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

function isBookingOwner(
  booking: Record<string, unknown>,
  uid: string,
  email: string | null | undefined
) {
  if (booking.userId === uid) return true
  if (
    email &&
    booking.clientEmail === email &&
    (booking.bookingOrigin === "mobile-app" || booking.userId === uid)
  ) {
    return true
  }
  return false
}

function asString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime())
}

function isValidTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value)
}

function parseDateTime(date: string, time: string): number | null {
  const d = new Date(`${date}T${time}:00`)
  const t = d.getTime()
  return Number.isNaN(t) ? null : t
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    const snap = await getDoc(doc(db, "bookings", id))

    if (!snap.exists()) {
      return mobileJsonResponse({ success: false, error: "Booking not found" }, 404)
    }

    const booking = (snap.data() || {}) as Record<string, unknown>

    if (!isBookingOwner(booking, auth.user.uid, auth.user.email)) {
      return mobileJsonResponse({ success: false, error: "Forbidden" }, 403)
    }

    if (booking.modificationRequested === true) {
      return mobileJsonResponse(
        { success: false, error: "Există deja o cerere de modificare în curs pentru această rezervare." },
        409
      )
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const requested: ModificationRequested = {
      newStartDate: asString(body.newStartDate),
      newStartTime: asString(body.newStartTime),
      newEndDate: asString(body.newEndDate),
      newEndTime: asString(body.newEndTime),
      newLicensePlate: asString(body.newLicensePlate)?.toUpperCase(),
      newNumberOfPersons:
        body.newNumberOfPersons !== undefined && body.newNumberOfPersons !== null
          ? Number(body.newNumberOfPersons)
          : undefined,
      note: asString(body.note),
    }

    if (requested.newStartDate && !isValidDate(requested.newStartDate)) {
      return mobileJsonResponse({ success: false, error: "Format dată intrare invalid (YYYY-MM-DD)" }, 400)
    }
    if (requested.newEndDate && !isValidDate(requested.newEndDate)) {
      return mobileJsonResponse({ success: false, error: "Format dată ieșire invalid (YYYY-MM-DD)" }, 400)
    }
    if (requested.newStartTime && !isValidTime(requested.newStartTime)) {
      return mobileJsonResponse({ success: false, error: "Format oră intrare invalid (HH:MM)" }, 400)
    }
    if (requested.newEndTime && !isValidTime(requested.newEndTime)) {
      return mobileJsonResponse({ success: false, error: "Format oră ieșire invalid (HH:MM)" }, 400)
    }
    if (
      requested.newNumberOfPersons !== undefined &&
      (!Number.isFinite(requested.newNumberOfPersons) || requested.newNumberOfPersons <= 0)
    ) {
      return mobileJsonResponse(
        { success: false, error: "Număr persoane invalid" },
        400
      )
    }

    const currentStartDate = String(booking.startDate || "")
    const currentStartTime = String(booking.startTime || "")
    const currentEndDate = String(booking.endDate || "")
    const currentEndTime = String(booking.endTime || "")

    const finalStartDate = requested.newStartDate || currentStartDate
    const finalStartTime = requested.newStartTime || currentStartTime
    const finalEndDate = requested.newEndDate || currentEndDate
    const finalEndTime = requested.newEndTime || currentEndTime

    if (
      finalStartDate &&
      finalEndDate &&
      finalStartTime &&
      finalEndTime &&
      isValidDate(finalStartDate) &&
      isValidDate(finalEndDate) &&
      isValidTime(finalStartTime) &&
      isValidTime(finalEndTime)
    ) {
      const startMs = parseDateTime(finalStartDate, finalStartTime)
      const endMs = parseDateTime(finalEndDate, finalEndTime)
      if (startMs !== null && endMs !== null && endMs <= startMs) {
        return mobileJsonResponse(
          { success: false, error: "Data/ora de ieșire trebuie să fie după cea de intrare" },
          400
        )
      }
    }

    const hasAnyChange =
      !!requested.newStartDate ||
      !!requested.newStartTime ||
      !!requested.newEndDate ||
      !!requested.newEndTime ||
      !!requested.newLicensePlate ||
      requested.newNumberOfPersons !== undefined ||
      !!(requested.note && requested.note.trim())

    if (!hasAnyChange) {
      return mobileJsonResponse({ success: false, error: "Niciun câmp modificat" }, 400)
    }

    const profile = await getMobileUserProfile(auth.user.uid)
    const firstName = profile?.firstName || String(booking.clientFirstName || "Client")
    const lastName = profile?.lastName || String(booking.clientLastName || "OTP Parking")
    const phone = profile?.phone || String(booking.clientPhone || "—")
    const email = auth.user.email || profile?.email || String(booking.clientEmail || "")
    const bookingNumber = String(
      booking.apiBookingNumber || booking.bookingNumber || snap.id
    )
    const licensePlate = String(booking.licensePlate || "—")
    const numberOfPersons =
      booking.numberOfPersons !== undefined && booking.numberOfPersons !== null
        ? Number(booking.numberOfPersons)
        : "—"

    if (!email) {
      return mobileJsonResponse({ success: false, error: "Email utilizator lipsă" }, 400)
    }

    await updateDoc(snap.ref, {
      modificationRequested: true,
      modificationRequestedAt: serverTimestamp(),
      modificationRequestPayload: requested,
    })

    const result = await sendModificationRequestEmail({
      firstName,
      lastName,
      phone,
      email,
      bookingNumber,
      current: {
        startDate: currentStartDate,
        startTime: currentStartTime,
        endDate: currentEndDate,
        endTime: currentEndTime,
        licensePlate,
        numberOfPersons,
      },
      requested,
    })

    return mobileJsonResponse({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const status = message.includes("obligatorii") || message.includes("modificat") ? 400 : 500
    return mobileJsonResponse({ success: false, error: message }, status)
  }
}
