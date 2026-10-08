import { NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { reverseBookingLoyalty, isCancelledBooking } from "@/lib/booking-loyalty-reversal"
import { prepareAdminCancellation, releaseAdminCancellation, BookingCancellationError } from "@/lib/admin-booking-cancellation"

export async function POST(req: Request) {
  const auth = await authorizeAdminRequest(req, ["admin"])
  if (!auth.ok) return auth.response
  let prepared: Awaited<ReturnType<typeof prepareAdminCancellation>> | undefined
  try {
    const body = await req.json().catch(() => null)
    const bookingId = String(body?.bookingId || "").trim()
    if (!bookingId || bookingId.includes("/")) return NextResponse.json({ error: "Missing or invalid bookingId" }, { status: 400 })
    const reason = String(body?.reason || "").trim().slice(0, 1000) || "Anulat din admin"
    prepared = await prepareAdminCancellation(bookingId)
    const { ref, token } = prepared
    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref)
      if (!snap.exists) throw new BookingCancellationError("Rezervarea nu a fost găsită.", 404)
      const data = snap.data()!
      if (data.adminCancellation?.token !== token) throw new BookingCancellationError("Anularea trebuie reîncercată.", 409)
      const alreadyCancelled = isCancelledBooking(data)
      const loyalty = await reverseBookingLoyalty(tx, data)
      const payOnSite = data.source === "pay_on_site" || (data.status === "confirmed_pay_on_site" && data.source !== "lpr")
      tx.update(ref, {
        ...(alreadyCancelled ? {} : {
          status: "cancelled_by_admin", cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: auth.user.uid, cancelReason: reason,
          ...(payOnSite ? { payOnSiteStatus: "cancelled" } : {}),
        }),
        ...(loyalty.record ? { loyaltyRecord: loyalty.record } : {}),
        lastUpdated: FieldValue.serverTimestamp(), "adminCancellation.expiresAt": 0,
      })
      if (!alreadyCancelled && (prepared!.multiparkAttempted || payOnSite)) {
        tx.set(adminDb.collection("config").doc("reservationStats"), {
          activeBookingsCount: FieldValue.increment(-1),
        }, { merge: true })
      }
      return { alreadyCancelled, loyaltyStatus: loyalty.status }
    })
    return NextResponse.json({ success: true, ...result,
      multiparkCancelled: prepared.multiparkCancelled, multiparkAttempted: prepared.multiparkAttempted })
  } catch (error) {
    if (prepared) await releaseAdminCancellation(prepared.ref, prepared.token).catch(console.error)
    console.error("Admin cancellation failed", error)
    return NextResponse.json({ error: error instanceof BookingCancellationError ? error.message : "Anularea nu a putut fi salvată. Reîncercați." },
      { status: error instanceof BookingCancellationError ? error.status : 500 })
  }
}
