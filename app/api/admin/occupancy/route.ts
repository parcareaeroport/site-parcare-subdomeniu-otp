import { NextResponse } from "next/server"
import { FieldValue, Timestamp } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"

export async function GET(request: Request) {
  const authResult = await authorizeAdminRequest(request, ["admin", "employee"])
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const settingsDoc = await adminDb.collection("config").doc("reservationSettings").get()
    const maxLimit = settingsDoc.exists ? Number((settingsDoc.data() as any)?.maxTotalReservations || 0) : 0

    const bookingsRef = adminDb.collection("bookings")
    // IMPORTANT: /admin/dashboard/ocupare must be strictly based on real LPR:
    // list ONLY bookings where lpr.isInside==true and count must match that list.
    const snapInside = await bookingsRef.where("lpr.isInside", "==", true).get()
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
  const authResult = await authorizeAdminRequest(req, ["admin"])
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const ref = adminDb.collection("config").doc("parkingLive")
    const body = await req.json().catch(() => null)
    const action = body?.action || "reset"

    if (action === "recalculate") {
      // Recalculează contorul din realitatea LPR: câte booking-uri au lpr.isInside=true
      const bookingsRef = adminDb.collection("bookings")
      const snap = await bookingsRef.where("lpr.isInside", "==", true).get()
      const count = snap.size

      await ref.set(
        {
          occupiedCount: count,
          lastUpdated: FieldValue.serverTimestamp(),
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
      await ref.set(
        {
          occupiedCount: 0,
          lastUpdated: FieldValue.serverTimestamp(),
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
      const bookingsRef = adminDb.collection("bookings")
      const snap = await bookingsRef.where("lpr.isInside", "==", true).get()

      const batch: any[] = []
      for (const docSnap of snap.docs) {
        batch.push({ id: docSnap.id, ref: docSnap.ref })
      }

      for (const item of batch) {
        await item.ref.set(
          {
            lpr: {
              isInside: false,
              departedAt: FieldValue.serverTimestamp(),
              lastEventType: "exit",
            },
            lastUpdated: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }

      await ref.set(
        {
          occupiedCount: 0,
          lastUpdated: FieldValue.serverTimestamp(),
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

    if (action === "reverse_set_all_outside_window") {
      // Reverse helper for a known incident window: revert bookings incorrectly marked as exited by set_all_outside.
      // Key detail: set_all_outside writes `lpr.departedAt` as Firestore Timestamp (serverTimestamp),
      // while real LPR writes are usually ISO strings.
      const fromIso = String(body?.fromIso || "").trim()
      const toIso = String(body?.toIso || "").trim()
      const from = fromIso ? new Date(fromIso) : null
      const to = toIso ? new Date(toIso) : null
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        return NextResponse.json({ error: "Invalid window" }, { status: 400 })
      }

      const bookingsRef = adminDb.collection("bookings")
      // IMPORTANT: keep query single-field indexed to avoid composite index errors (common source of 500s).
      // Query only by departedAt range (Timestamp), then filter in-memory by lastEventType/isInside.
      const snap = await bookingsRef
        .where("lpr.departedAt", ">=", Timestamp.fromDate(from))
        .where("lpr.departedAt", "<=", Timestamp.fromDate(to))
        .get()
      console.log("[occupancy.reverse_set_all_outside_window] start", { fromIso, toIso })
      console.log("[occupancy.reverse_set_all_outside_window] candidates", { count: snap.size })

      let reversed = 0
      let skippedNotTimestamp = 0
      let skippedNotMatch = 0
      for (const docSnap of snap.docs) {
        const data: any = docSnap.data() || {}
        const departedAt = data?.lpr?.departedAt
        const isTimestamp = departedAt && typeof departedAt?.toDate === "function"
        if (!isTimestamp) {
          skippedNotTimestamp += 1
          continue
        }
        const lastEventType = String(data?.lpr?.lastEventType || "")
        const isInside = data?.lpr?.isInside === true
        if (isInside || lastEventType !== "exit") {
          skippedNotMatch += 1
          continue
        }
        await docSnap.ref.update({
          "lpr.isInside": true,
          "lpr.lastEventType": "entry",
          "lpr.departedAt": FieldValue.delete(),
          lastUpdated: FieldValue.serverTimestamp(),
        })
        reversed += 1
      }

      // Recalculate live counter after reversing (strictly from lpr.isInside==true)
      const snapInside = await bookingsRef.where("lpr.isInside", "==", true).get()
      const count = snapInside.size
      await ref.set(
        {
          occupiedCount: count,
          lastUpdated: FieldValue.serverTimestamp(),
          lastChange: {
            type: "reverse_set_all_outside_window",
            at: new Date().toISOString(),
            window: { fromIso, toIso },
            reversed,
            candidates: snap.size,
            skippedNotTimestamp,
            skippedNotMatch,
            count,
          },
        },
        { merge: true },
      )

      console.log("[occupancy.reverse_set_all_outside_window] done", {
        candidates: snap.size,
        reversed,
        skippedNotTimestamp,
        skippedNotMatch,
        occupiedCount: count,
      })
      return NextResponse.json({
        success: true,
        window: { fromIso, toIso },
        candidates: snap.size,
        reversed,
        skippedNotTimestamp,
        skippedNotMatch,
        occupiedCount: count,
      })
    }

    if (action === "reverse_set_all_outside_window_preview") {
      // Preview how many docs would be reversed, without writing anything.
      const fromIso = String(body?.fromIso || "").trim()
      const toIso = String(body?.toIso || "").trim()
      const from = fromIso ? new Date(fromIso) : null
      const to = toIso ? new Date(toIso) : null
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
        return NextResponse.json({ error: "Invalid window" }, { status: 400 })
      }

      const bookingsRef = adminDb.collection("bookings")
      const snap = await bookingsRef
        .where("lpr.departedAt", ">=", Timestamp.fromDate(from))
        .where("lpr.departedAt", "<=", Timestamp.fromDate(to))
        .get()
      console.log("[occupancy.reverse_set_all_outside_window_preview] start", { fromIso, toIso })

      let willReverse = 0
      let skippedNotTimestamp = 0
      let skippedNotMatch = 0
      for (const docSnap of snap.docs) {
        const data: any = docSnap.data() || {}
        const departedAt = data?.lpr?.departedAt
        const isTimestamp = departedAt && typeof departedAt?.toDate === "function"
        if (!isTimestamp) {
          skippedNotTimestamp += 1
          continue
        }
        const lastEventType = String(data?.lpr?.lastEventType || "")
        const isInside = data?.lpr?.isInside === true
        if (isInside || lastEventType !== "exit") {
          skippedNotMatch += 1
          continue
        }
        willReverse += 1
      }

      console.log("[occupancy.reverse_set_all_outside_window_preview] done", {
        candidates: snap.size,
        willReverse,
        skippedNotTimestamp,
        skippedNotMatch,
      })

      return NextResponse.json({
        success: true,
        window: { fromIso, toIso },
        candidates: snap.size,
        willReverse,
        skippedNotTimestamp,
        skippedNotMatch,
      })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (e: any) {
    console.error("Failed to reset occupancy counter", e)
    return NextResponse.json(
      {
        error: "Failed to reset counter",
        message: e?.message ? String(e.message) : "Unknown error",
        code: e?.code ? String(e.code) : undefined,
      },
      { status: 500 },
    )
  }
}
