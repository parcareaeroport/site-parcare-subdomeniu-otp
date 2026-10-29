import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { ManualExitError, prepareManualExit, saveManualExit } from "@/lib/manual-lpr-exit.server"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin", "employee", "entriesOperator"])
  if (!auth.ok) return auth.response
  try {
    const input = await request.json().catch(() => null)
    if (!input || typeof input !== "object" || typeof input.bookingId !== "string" || !input.bookingId || input.bookingId.includes("/")) return NextResponse.json({ error: "Rezervare invalidă." }, { status: 400 })
    const result = input.action === "prepare" ? await prepareManualExit(input.bookingId) : input.action === "save" ? await saveManualExit(input, auth.user) : null
    if (!result) return NextResponse.json({ error: "Acțiune invalidă." }, { status: 400 })
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    if (e instanceof ManualExitError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.status })
    console.error("[manual-lpr-exit] Failed", e)
    return NextResponse.json({ error: "Nu am putut salva sau verifica ieșirea. Încearcă din nou." }, { status: 503 })
  }
}
