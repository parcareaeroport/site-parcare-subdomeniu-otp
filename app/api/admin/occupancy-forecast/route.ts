import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { readReservationCheckSnapshot } from "@/lib/reservation-check-snapshot.server"
import { calculateOccupancyForecast, validateForecastInput } from "@/lib/occupancy-forecast-calculation"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
const headers = { "Cache-Control": "no-store" }

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin", "employee"])
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store")
    return auth.response
  }
  let input: unknown
  try { input = await request.json() } catch {
    return NextResponse.json({ error: "Interval invalid." }, { status: 400, headers })
  }
  if (!validateForecastInput(input)) return NextResponse.json({ error: "Interval invalid." }, { status: 400, headers })
  try {
    const { rows, limit, now } = await readReservationCheckSnapshot(true)
    return NextResponse.json(calculateOccupancyForecast(rows, limit, now, input), { headers })
  } catch (error) {
    console.error("[occupancy-forecast] Calculation unavailable", error)
    return NextResponse.json({ error: "Calcul indisponibil", code: "FORECAST_UNAVAILABLE" }, { status: 503, headers })
  }
}
