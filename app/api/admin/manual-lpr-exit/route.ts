import { withLprRequest, lprLog, lprFields, lprError } from "@/lib/lpr-log.server"
import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { ManualExitError, prepareManualExit, saveManualExit } from "@/lib/manual-lpr-exit.server"
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
async function POSTHandler(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin", "employee", "entriesOperator"])
  if (!auth.ok) return auth.response
  lprFields({actorUid:auth.user.uid})
  try {
    const input = await request.json().catch(() => null)
    if (input && typeof input === "object") lprFields({action:input.action,bookingId:input.bookingId,eventId:input.eventId,
      confirmOverwrite:input.confirmOverwrite,confirmDuplicates:input.confirmDuplicates,confirmMissingArrival:input.confirmMissingArrival,
      confirmReentry:input.confirmReentry,confirmed:input.confirmed,useServerNow:input.useServerNow,entryMode:input.entryMode})
    if (!input || typeof input !== "object" || typeof input.bookingId !== "string" || !input.bookingId || input.bookingId.includes("/")) { lprFields({reason:"invalid_booking"}); return NextResponse.json({ error: "Rezervare invalidă." }, { status: 400 }) }
    const result = input.action === "prepare" ? await prepareManualExit(input.bookingId) : input.action === "save" ? await saveManualExit(input, auth.user) : null
    if (!result) { lprFields({reason:"invalid_action"}); return NextResponse.json({ error: "Acțiune invalidă." }, { status: 400 }) }
    lprLog(input.action === "prepare" ? "manual_prepared" : "manual_saved",{eventId:(result as any).lprEventId,visitId:(result as any).visitId})
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    if (e instanceof ManualExitError) { lprFields({reason:e.code}); lprLog("manual_rejected",{reason:e.code,explanation:e.message},"warn") }
    else lprError("manual_failed",e)
    if (e instanceof ManualExitError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.status })

    return NextResponse.json({ error: "Nu am putut salva sau verifica ieșirea. Încearcă din nou." }, { status: 503 })
  }
}

export const POST = withLprRequest(POSTHandler)
