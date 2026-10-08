import { NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { prepareAdminCancellation, releaseAdminCancellation, BookingCancellationError } from "@/lib/admin-booking-cancellation"
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
    const occupancyRef = adminDb.collection("config").doc("parkingLive")
    const archiveRef = adminDb.collection("deleted_bookings").doc(bookingId)

    const now = new Date()
    const nowIso = now.toISOString()
    const nowDate = nowIso.split("T")[0]
    const nowTime = now.toTimeString().slice(0, 5)

    prepared = await prepareAdminCancellation(bookingId)
    const { token, multiparkAttempted: shouldCancelInMultipark, multiparkCancelled } = prepared

    const result = await adminDb.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef)
      if (!bookingSnap.exists) {
        return { ok: false as const, status: 404 as const, message: "Booking not found" }
      }

      const data: any = bookingSnap.data()
      if (data.adminCancellation?.token !== token) throw new BookingCancellationError("Anularea trebuie reîncercată.", 409)
      const loyalty = await reverseBookingLoyalty(tx, data)
      const wasInside = data?.lpr?.isInside === true
      const occupancyIncrementedFlag = data?.occupancyIncremented === true
      const occupancyDecrementedFlag = data?.occupancyDecremented === true
      const shouldDecrement = wasInside && occupancyIncrementedFlag && !occupancyDecrementedFlag

      const mergedForArchive = {
        ...data,
        ...(loyalty.record ? { loyaltyRecord: loyalty.record } : {}),
        // force a consistent exit snapshot in archive
        lpr: {
          ...(data?.lpr || {}),
          isInside: false,
          departedAt:
            (data?.lpr?.departedAt ?? null) || nowIso,
          lastEventType: "exit_deleted",
        },
        endDate: (data?.endDate && String(data.endDate).trim()) ? data.endDate : nowDate,
        endTime: (data?.endTime && String(data.endTime).trim()) ? data.endTime : nowTime,
        durationMinutes: (() => {
          try {
            const startDate = String(data?.startDate || "").trim()
            const startTime = String(data?.startTime || "").trim()
            if (!startDate || !startTime) return data?.durationMinutes ?? 0
            const startTs = new Date(`${startDate}T${startTime.length === 5 ? `${startTime}:00` : startTime}`).getTime()
            const endTs = now.getTime()
            if (!Number.isNaN(startTs) && endTs > startTs) {
              return Math.round((endTs - startTs) / (1000 * 60))
            }
            return data?.durationMinutes ?? 0
          } catch {
            return data?.durationMinutes ?? 0
          }
        })(),
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

      if (shouldDecrement) {
        tx.set(occupancyRef, { lastUpdated: FieldValue.serverTimestamp() }, { merge: true })
        tx.update(occupancyRef, {
          occupiedCount: FieldValue.increment(-1),
          lastUpdated: FieldValue.serverTimestamp(),
          lastChange: {
            type: "delete_booking_exit",
            bookingId,
            plateNumber: data?.licensePlate || "N/A",
            at: nowIso,
          },
        } as any)
      }

      tx.delete(bookingRef)
      return { ok: true as const, shouldDecrement, loyaltyStatus: loyalty.status }
    })

    if (!result.ok) {
      await releaseAdminCancellation(bookingRef, token)
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      decremented: result.shouldDecrement,
      loyaltyStatus: result.loyaltyStatus,
      multiparkCancelled,
      multiparkAttempted: shouldCancelInMultipark,
    })
  } catch (e) {
    if (prepared) await releaseAdminCancellation(prepared.ref, prepared.token).catch(console.error)
    console.error("Failed to delete booking", e)
    return NextResponse.json({ error: e instanceof BookingCancellationError ? e.message : "Failed to delete booking" }, { status: e instanceof BookingCancellationError ? e.status : 500 })
  }
}
