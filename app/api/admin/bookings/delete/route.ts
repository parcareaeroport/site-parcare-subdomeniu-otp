import { NextResponse } from "next/server"
import { db } from "@/lib/firebase"
import {
  doc,
  increment,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const bookingId = String(body?.bookingId || "").trim()
    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 })
    }

    const bookingRef = doc(db, "bookings", bookingId)
    const occupancyRef = doc(db, "config", "parkingLive")
    const archiveRef = doc(db, "deleted_bookings", bookingId)

    const now = new Date()
    const nowIso = now.toISOString()
    const nowDate = nowIso.split("T")[0]
    const nowTime = now.toTimeString().slice(0, 5)

    const result = await runTransaction(db, async (tx) => {
      const bookingSnap = await tx.get(bookingRef)
      if (!bookingSnap.exists()) {
        return { ok: false as const, status: 404 as const, message: "Booking not found" }
      }

      const data: any = bookingSnap.data()
      const wasInside = data?.lpr?.isInside === true
      const occupancyIncrementedFlag = data?.occupancyIncremented === true
      const occupancyDecrementedFlag = data?.occupancyDecremented === true
      const shouldDecrement = wasInside && occupancyIncrementedFlag && !occupancyDecrementedFlag

      const mergedForArchive = {
        ...data,
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
        deletedAt: serverTimestamp(),
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
        tx.set(occupancyRef, { lastUpdated: serverTimestamp() }, { merge: true })
        tx.update(occupancyRef, {
          occupiedCount: increment(-1),
          lastUpdated: serverTimestamp(),
          lastChange: {
            type: "delete_booking_exit",
            bookingId,
            plateNumber: data?.licensePlate || "N/A",
            at: nowIso,
          },
        } as any)
      }

      tx.delete(bookingRef)
      return { ok: true as const, shouldDecrement }
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    return NextResponse.json({ success: true, decremented: result.shouldDecrement })
  } catch (e) {
    console.error("Failed to delete booking", e)
    return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 })
  }
}


