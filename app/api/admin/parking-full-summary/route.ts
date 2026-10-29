import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { readReservationCheckSnapshot } from "@/lib/reservation-check-snapshot.server"
import { calculateParkingFullSummary } from "@/lib/parking-full-summary"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const headers = { "Cache-Control": "no-store" }

export async function GET(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin", "employee", "entriesOperator"])
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store")
    return auth.response
  }
  try {
    const { rows, limit, now } = await readReservationCheckSnapshot(true)
    return NextResponse.json(calculateParkingFullSummary(rows, limit, now), { headers })
  } catch (error) {
    console.error("[parking-full-summary] Calculation unavailable", error)
    return NextResponse.json({ error: "Avertizarea de ocupare nu poate fi actualizată" }, { status: 503, headers })
  }
}
