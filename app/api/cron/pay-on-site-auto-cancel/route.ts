import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/firebase"
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore"

// Simplu endpoint de tip cron, care anulează automat rezervările
// cu Plată la Parcare care au depășit pragul configurat (în minute).
// Poate fi apelat de un scheduler extern (ex: la 5-10 minute).

export async function GET(_req: NextRequest) {
  const now = new Date()
  const currentDateStr = now.toISOString().split("T")[0]

  try {
    // 1) Citește pragul din config (fallback 180 minute = 3 ore)
    const settingsRef = doc(db, "config", "reservationSettings")
    const settingsSnap = await getDoc(settingsRef)
    const settingsData = settingsSnap.data() || {}
    const thresholdMinutesRaw = Number(settingsData.payOnSiteAutoCancelMinutes ?? 180)
    const thresholdMinutes = Number.isFinite(thresholdMinutesRaw) ? thresholdMinutesRaw : 180
    const thresholdMs = thresholdMinutes * 60 * 1000

    // 2) Selectează rezervările cu Plată la Parcare care pot fi candidate
    const bookingsRef = collection(db, "bookings")
    const q = query(
      bookingsRef,
      where("source", "==", "pay_on_site"),
      where("status", "in", ["confirmed_pay_on_site", "confirmed", "paid", "confirmed_test", "confirmed_paid"]),
      where("endDate", "<=", currentDateStr),
    )
    const snap = await getDocs(q)

    let cancelledCount = 0

    for (const docSnap of snap.docs) {
      const booking: any = docSnap.data()

      // Sări peste cele deja anulate/lock‑uite
      if (booking.payOnSiteAutoCancelled === true) continue
      if (!booking.endDate || !booking.endTime) continue

      const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
      const endMs = endDateTime.getTime()
      if (Number.isNaN(endMs)) continue

      const diffMs = now.getTime() - endMs
      if (diffMs <= thresholdMs) {
        // încă nu a depășit pragul
        continue
      }

      try {
        await updateDoc(doc(db, "bookings", docSnap.id), {
          status: "cancelled_by_admin",
          payOnSiteStatus: "cancelled",
          payOnSiteAutoCancelled: true,
          payOnSiteAutoCancelledAt: serverTimestamp(),
          lastUpdated: serverTimestamp(),
        })
        cancelledCount++
      } catch (e) {
        console.error("❌ [AUTO-CANCEL PAY_ON_SITE] Failed to cancel booking", {
          bookingId: docSnap.id,
          error: e,
        })
      }
    }

    // 3) Ajustează contorul de rezervări active (dacă este folosit)
    if (cancelledCount > 0) {
      try {
        const statsDocRef = doc(db, "config", "reservationStats")
        await updateDoc(statsDocRef, {
          activeBookingsCount: increment(-cancelledCount),
          lastUpdated: serverTimestamp(),
        })
      } catch (e) {
        console.error("⚠️ [AUTO-CANCEL PAY_ON_SITE] Failed to update reservationStats", e)
      }
    }

    return NextResponse.json({
      ok: true,
      cancelledCount,
      thresholdMinutes,
      checkedAt: now.toISOString(),
    })
  } catch (error) {
    console.error("❌ [AUTO-CANCEL PAY_ON_SITE] Unexpected error", error)
    return NextResponse.json(
      {
        ok: false,
        error: "Internal error while auto-cancelling pay_on_site bookings",
      },
      { status: 500 },
    )
  }
}


