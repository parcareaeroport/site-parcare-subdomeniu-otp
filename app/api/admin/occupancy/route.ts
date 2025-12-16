import { NextResponse } from "next/server"
import { db } from "@/lib/firebase"
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore"

export async function GET() {
  try {
    const settingsDoc = await getDoc(doc(db, "config", "reservationSettings"))
    const maxLimit = settingsDoc.exists() ? Number(settingsDoc.data().maxTotalReservations || 0) : 0

    const bookingsRef = collection(db, "bookings")
    // IMPORTANT: /admin/dashboard/ocupare must be strictly based on real LPR:
    // list ONLY bookings where lpr.isInside==true and count must match that list.
    const qInside = query(bookingsRef, where("lpr.isInside", "==", true))
    const snapInside = await getDocs(qInside)
    const occupiedCount = snapInside.size
    const docsForPlates = snapInside.docs

    const plates = docsForPlates.map((d: any) => {
      const b = d.data() as any
      return {
        id: d.id,
        licensePlate: b.licensePlate || "N/A",
        paymentStatus: b.paymentStatus || "n/a",
        source: b.source || "unknown",
        status: b.status || "unknown",
        startDate: b.startDate || null,
        startTime: b.startTime || null,
        endDate: b.endDate || null,
        endTime: b.endTime || null,
        apiBookingNumber: b.apiBookingNumber || null,
      }
    })

    return NextResponse.json({ occupiedCount, maxLimit, plates })
  } catch (e) {
    console.error("Failed to fetch occupancy data", e)
    return NextResponse.json({ error: "Failed to fetch occupancy" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const ref = doc(db, "config", "parkingLive")
    const body = await req.json().catch(() => null)
    const action = body?.action || "reset"

    if (action === "recalculate") {
      // Recalculează contorul din realitatea LPR: câte booking-uri au lpr.isInside=true
      const bookingsRef = collection(db, "bookings")
      const q = query(bookingsRef, where("lpr.isInside", "==", true))
      const snap = await getDocs(q)
      const count = snap.size

      await setDoc(
        ref,
        {
          occupiedCount: count,
          lastUpdated: serverTimestamp(),
          lastChange: {
            type: "recalculate_from_isInside",
            at: new Date().toISOString(),
            note: "Recalculat din bookings where lpr.isInside=true",
            count,
          },
        },
        { merge: true },
      )

      return NextResponse.json({ success: true, occupiedCount: count })
    }

    if (action === "reset") {
      await setDoc(
        ref,
        {
          occupiedCount: 0,
          lastUpdated: serverTimestamp(),
          lastChange: {
            type: "reset_manual",
            at: new Date().toISOString(),
            note: "Reset contor la 0 din admin",
          },
        },
        { merge: true },
      )
      return NextResponse.json({ success: true })
    }

    if (action === "set_all_outside") {
      // setează toate booking-urile cu lpr.isInside=true la false
      const bookingsRef = collection(db, "bookings")
      const q = query(bookingsRef, where("lpr.isInside", "==", true))
      const snap = await getDocs(q)

      const batch: any[] = []
      for (const docSnap of snap.docs) {
        batch.push({ id: docSnap.id, ref: docSnap.ref })
      }

      for (const item of batch) {
        await setDoc(
          item.ref,
          {
            lpr: {
              isInside: false,
              departedAt: serverTimestamp(),
              lastEventType: "exit",
            },
            lastUpdated: serverTimestamp(),
          },
          { merge: true },
        )
      }

      await setDoc(
        ref,
        {
          occupiedCount: 0,
          lastUpdated: serverTimestamp(),
          lastChange: {
            type: "set_all_outside",
            at: new Date().toISOString(),
            note: "Set toate isInside=false (admin)",
          },
        },
        { merge: true },
      )

      return NextResponse.json({ success: true, updated: batch.length })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (e) {
    console.error("Failed to reset occupancy counter", e)
    return NextResponse.json({ error: "Failed to reset counter" }, { status: 500 })
  }
}

