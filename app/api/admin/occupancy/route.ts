import { recalculateLiveOccupancy } from "@/lib/occupancy-recalculation.server"
import { NextResponse } from "next/server"
import { adminDb } from "@/lib/firebase-admin"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { getLprPresenceState } from "@/lib/lpr-presence"
import { occupancyLprTimestamp } from "@/lib/occupancy-lpr-display"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const authResult = await authorizeAdminRequest(request, ["admin", "employee"])
  if (!authResult.ok) {
    return authResult.response
  }

  try {
    const settingsDoc = await adminDb.collection("config").doc("reservationSettings").get()
    const maxLimit = settingsDoc.exists ? Number((settingsDoc.data() as any)?.maxTotalReservations || 0) : 0

    const bookingsRef = adminDb.collection("bookings")
    // IMPORTANT: /admin/dashboard/ocupare must be based on effective LPR state.
    // Legacy/failed writes can leave isInside=true after an exit event; those must not count.
    const snapInside = await bookingsRef.where("lpr.isInside", "==", true).get()
    const docsForPlates = snapInside.docs.filter((d: any) => {
      const b = d.data() as any
      return getLprPresenceState({ lpr: b?.lpr }).isEffectivelyInside
    })
    const occupiedCount = docsForPlates.length

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
        lpr: {
          arrivedAt: occupancyLprTimestamp(b.lpr?.arrivedAt),
          departedAt: occupancyLprTimestamp(b.lpr?.departedAt),
          lastSeenAt: occupancyLprTimestamp(b.lpr?.lastSeenAt),
          lastEventType: typeof b.lpr?.lastEventType === "string" ? b.lpr.lastEventType : null,
          lastSeenDeviceId: typeof b.lpr?.lastSeenDeviceId === "string" ? b.lpr.lastSeenDeviceId : null,
        },
      }
    })

    const issues = await adminDb.collection("lpr_events").where("associationStatus", "in", ["pending", "needs_review"]).get()
    const lprAttention = {count:issues.size, events:issues.docs.slice(0,50).map(d => {
      const e = d.data()
      return {id:d.id, plate:String(e.normalizedPlate || e.plateNumber || "Necunoscut"), at:typeof e.eventTime === "string" ? e.eventTime : null,
        type:e.eventType || "unknown",reason:e.associationReason || "pending",pending:e.associationStatus === "pending",bookingIds:e.candidateBookingIds || []}
    })}

    return NextResponse.json({ occupiedCount, maxLimit, plates, lprAttention }, { headers: { "Cache-Control": "no-store" } })
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
    const body = await req.json().catch(() => null)
    const action = body?.action || "reset"

    if (action === "recalculate") {
      const result = await recalculateLiveOccupancy(authResult.user.uid)
      return NextResponse.json(result)
    }

    if (["reset", "set_all_outside", "reverse_set_all_outside_window", "reverse_set_all_outside_window_preview"].includes(action)) {
      return NextResponse.json({ error: "Operațiunea globală a fost dezactivată. Folosește ieșirea verificată pentru fiecare ședere sau recalcularea contorului.", code: "LEGACY_OPERATION_DISABLED" }, { status: 410 })
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
