import { randomUUID } from "node:crypto"
import { adminDb } from "@/lib/firebase-admin"
import { cancelBooking } from "@/app/actions/booking-actions"
import { isCancelledBooking } from "@/lib/booking-loyalty-reversal"

export const UNCERTAIN_CANCELLATION_MESSAGE = "Rezultatul anulării în Multipark este incert. Verificați rezervarea în Multipark înainte de a continua. Anularea nu va fi retrimisă automat."

export class BookingCancellationError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }
}

export function requiresMultiparkCancellation(data: FirebaseFirestore.DocumentData) {
  return Boolean(data.apiBookingNumber) && data.source !== "pay_on_site" &&
    !(data.status === "confirmed_pay_on_site" && data.source !== "lpr") && !isCancelledBooking(data)
}

export function cancellationBlock(data: FirebaseFirestore.DocumentData): BookingCancellationError | null {
  if (Number(data.adminCancellation?.expiresAt) > Date.now()) {
    return new BookingCancellationError("Anularea este deja în curs. Reîncercați în câteva momente.", 409, "CANCELLATION_IN_PROGRESS")
  }
  if (requiresMultiparkCancellation(data) && !data.adminCancellation?.multiparkCompleted &&
    ["requested", "unknown"].includes(data.adminCancellation?.multiparkStatus)) {
    return new BookingCancellationError(UNCERTAIN_CANCELLATION_MESSAGE, 409, "MULTIPARK_CANCELLATION_UNCERTAIN")
  }
  return null
}

/** Persist intent BEFORE the external request. An interrupted request must not be replayed blindly. */
export async function prepareAdminCancellation(bookingId: string) {
  const ref = adminDb.collection("bookings").doc(bookingId)
  const token = randomUUID()
  const initial = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new BookingCancellationError("Rezervarea nu a fost găsită.", 404)
    const data = snap.data()!
    const blocked = cancellationBlock(data)
    if (blocked) throw blocked
    const attempted = requiresMultiparkCancellation(data)
    const completed = data.adminCancellation?.multiparkCompleted === true
    tx.update(ref, { adminCancellation: {
      ...(data.adminCancellation || {}), token, expiresAt: Date.now() + 120000,
      multiparkCompleted: completed,
      multiparkStatus: completed ? "confirmed" : attempted ? "requested" : "not_required",
      ...(attempted && !completed ? { requestedAt: new Date() } : {}),
    } })
    return data
  })
  const attempted = requiresMultiparkCancellation(initial)
  try {
    if (attempted && !initial.adminCancellation?.multiparkCompleted) {
      const result = await cancelBooking(String(initial.apiBookingNumber))
      // Absence of a definite response also counts as uncertain (timeouts, invalid XML, HTTP errors).
      const outcome = result.success ? "confirmed" : result.outcomeUnknown === false ? "rejected" : "unknown"
      await adminDb.runTransaction(async tx => {
        const snap = await tx.get(ref)
        if (snap.data()?.adminCancellation?.token !== token) throw new Error("Cancellation ownership changed")
        tx.update(ref, {
          "adminCancellation.multiparkCompleted": result.success,
          "adminCancellation.multiparkStatus": outcome,
          "adminCancellation.respondedAt": new Date(),
        })
      })
      if (outcome === "unknown") throw new BookingCancellationError(UNCERTAIN_CANCELLATION_MESSAGE, 409, "MULTIPARK_CANCELLATION_UNCERTAIN")
      if (!result.success) throw new BookingCancellationError(result.message || "Anularea Multipark a eșuat.", 502, "MULTIPARK_CANCELLATION_REJECTED")
    }
    return { ref, token, multiparkAttempted: attempted, multiparkCancelled: attempted }
  } catch (error) {
    // If recording the response failed, the durable 'requested' marker still blocks replay.
    await releaseAdminCancellation(ref, token).catch(console.error)
    if (error instanceof BookingCancellationError) throw error
    throw new BookingCancellationError(UNCERTAIN_CANCELLATION_MESSAGE, 409, "MULTIPARK_CANCELLATION_UNCERTAIN")
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
