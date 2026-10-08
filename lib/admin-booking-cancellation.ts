import { randomUUID } from "node:crypto"
import { adminDb } from "@/lib/firebase-admin"
import { cancelBooking } from "@/app/actions/booking-actions"
import { isCancelledBooking } from "@/lib/booking-loyalty-reversal"

export class BookingCancellationError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export function requiresMultiparkCancellation(data: FirebaseFirestore.DocumentData) {
  return Boolean(data.apiBookingNumber) && data.source !== "pay_on_site" &&
    !(data.status === "confirmed_pay_on_site" && data.source !== "lpr") && !isCancelledBooking(data)
}

/** Serialize admin cancel/delete attempts and remember successful external cancellation for retries. */
export async function prepareAdminCancellation(bookingId: string) {
  const ref = adminDb.collection("bookings").doc(bookingId)
  const token = randomUUID()
  const initial = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new BookingCancellationError("Rezervarea nu a fost găsită.", 404)
    const data = snap.data()!
    if (Number(data.adminCancellation?.expiresAt) > Date.now()) {
      throw new BookingCancellationError("Anularea este deja în curs. Reîncercați în câteva momente.", 409)
    }
    tx.update(ref, { adminCancellation: {
      token, expiresAt: Date.now() + 120000,
      multiparkCompleted: data.adminCancellation?.multiparkCompleted === true,
    } })
    return data
  })
  const attempted = requiresMultiparkCancellation(initial)
  try {
    if (attempted && !initial.adminCancellation?.multiparkCompleted) {
      const result = await cancelBooking(String(initial.apiBookingNumber))
      if (!result.success) throw new BookingCancellationError(result.message || "Anularea Multipark a eșuat.", 502)
      await adminDb.runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (snap.data()?.adminCancellation?.token !== token) throw new BookingCancellationError("Anularea trebuie reîncercată.", 409)
        tx.update(ref, { "adminCancellation.multiparkCompleted": true })
      })
    }
    return { ref, token, multiparkAttempted: attempted, multiparkCancelled: attempted }
  } catch (error) {
    await releaseAdminCancellation(ref, token)
    throw error
  }
}

export async function releaseAdminCancellation(ref: FirebaseFirestore.DocumentReference, token: string) {
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (snap.exists && snap.data()?.adminCancellation?.token === token) {
      tx.update(ref, { "adminCancellation.expiresAt": 0 })
    }
  })
}
