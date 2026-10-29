import { NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { prepareAdminCancellation, releaseAdminCancellation, BookingCancellationError, assertBookingCanBeDeleted } from "@/lib/admin-booking-cancellation"
import { reverseBookingLoyalty } from "@/lib/booking-loyalty-reversal"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"

export async function POST(req: Request) {
  const authResult = await authorizeAdminRequest(req, ["admin"])
  if (!authResult.ok) {
    return authResult.response
  }

  let prepared: Awaited<ReturnType<typeof prepareAdminCancellation>> | undefined
  try {
    const body = await req.json().catch(() => null)
    const bookingId = String(body?.bookingId || "").trim()
    if (!bookingId || bookingId.includes("/")) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 })
    }

    const bookingRef = adminDb.collection("bookings").doc(bookingId)
    const archiveRef = adminDb.collection("deleted_bookings").doc(bookingId)

    prepared = await prepareAdminCancellation(bookingId, { deleting: true })
    const { token, multiparkAttempted: shouldCancelInMultipark, multiparkCancelled } = prepared

    const result = await adminDb.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef)
      if (!bookingSnap.exists) {
        return { ok: false as const, status: 404 as const, message: "Booking not found" }
      }

      const data: any = bookingSnap.data()
      if (data.adminCancellation?.token !== token) throw new BookingCancellationError("Anularea trebuie reîncercată.", 409)
      assertBookingCanBeDeleted(data) // Rechecked in the transaction: a concurrent entry prevents deletion.
      const loyalty = await reverseBookingLoyalty(tx, data)
      const shouldDecrement = false // Deleting a reservation is never a physical exit.

      const mergedForArchive = {
        ...data,
        ...(loyalty.record ? { loyaltyRecord: loyalty.record } : {}),
        deletedAt: FieldValue.serverTimestamp(),
        deletedReason: "admin_delete",
      }

      tx.set(
        archiveRef,
        {
          ...mergedForArchive,
          originalBookingId: bookingId,
        },
        { merge: true },
      )

      tx.delete(bookingRef)
      return { ok: true as const, shouldDecrement, loyaltyStatus: loyalty.status, loyalty: loyalty.impact }
    })

    if (!result.ok) {
      await releaseAdminCancellation(bookingRef, token)
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      decremented: result.shouldDecrement,
      loyaltyStatus: result.loyaltyStatus,
      loyalty: result.loyalty,
      multiparkCancelled,
      multiparkAttempted: shouldCancelInMultipark,
    })
  } catch (e) {
    if (prepared) await releaseAdminCancellation(prepared.ref, prepared.token).catch(console.error)
    console.error("Failed to delete booking", e)
    return NextResponse.json({ code: e instanceof BookingCancellationError ? e.code : undefined, error: e instanceof BookingCancellationError ? e.message : "Failed to delete booking" }, { status: e instanceof BookingCancellationError ? e.status : 500 })
  }
}
