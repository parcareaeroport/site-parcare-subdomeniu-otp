import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { evaluateBookingLoyalty } from "@/lib/booking-loyalty-reversal"
import { cancellationBlock, requiresMultiparkCancellation, BookingCancellationError } from "@/lib/admin-booking-cancellation"
import type { CancellationPreview } from "@/lib/booking-cancellation-types"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store, max-age=0" }

export async function GET(req: Request) {
  const auth = await authorizeAdminRequest(req, ["admin"])
  if (!auth.ok) return auth.response
  const bookingId = new URL(req.url).searchParams.get("bookingId")?.trim()
  if (!bookingId || bookingId.includes("/")) return NextResponse.json({ error: "Missing or invalid bookingId" }, { status: 400, headers })
  try {
    const preview = await adminDb.runTransaction(async tx => {
      const booking = await tx.get(adminDb.collection("bookings").doc(bookingId))
      if (!booking.exists) throw new BookingCancellationError("Rezervarea nu a fost găsită.", 404)
      const data = booking.data()!
      const evaluation = await evaluateBookingLoyalty(tx, data)
      const blocked = cancellationBlock(data)
      return {
        bookingId, loyalty: evaluation.impact,
        canConfirm: !blocked, blockingMessage: blocked?.message || null,
        multiparkRequired: requiresMultiparkCancellation(data),
      } satisfies CancellationPreview
    })
    return NextResponse.json(preview, { headers })
  } catch (error) {
    console.error("Cancellation preview failed", error)
    return NextResponse.json({ error: error instanceof BookingCancellationError ? error.message : "Nu am putut verifica punctele. Reîncercați." },
      { status: error instanceof BookingCancellationError ? error.status : 500, headers })
  }
}
