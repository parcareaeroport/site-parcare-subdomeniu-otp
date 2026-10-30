import { withLprRequest, lprLog, lprFields, lprError } from "@/lib/lpr-log.server"
import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { reviewLprEvent } from "@/lib/lpr-review.server"
import { ManualExitError } from "@/lib/manual-lpr-exit.server"
async function POSTHandler(request:Request) {
  const auth = await authorizeAdminRequest(request,["admin"])
  if (!auth.ok) return auth.response
  lprFields({actorUid:auth.user.uid})
  try {
    const input = await request.json()
    if (input && typeof input === "object") lprFields({action:input.action,bookingId:input.bookingId,eventId:input.eventId,
      confirmOverwrite:input.confirmOverwrite,confirmDuplicates:input.confirmDuplicates,confirmMissingArrival:input.confirmMissingArrival,
      confirmReentry:input.confirmReentry,confirmed:input.confirmed,useServerNow:input.useServerNow,entryMode:input.entryMode})
    if (typeof input.eventId !== "string" || !input.eventId || input.eventId.includes("/")) { lprFields({reason:"invalid_event"}); return NextResponse.json({error:"Eveniment invalid."},{status:400}) }
    return NextResponse.json(await reviewLprEvent(input,auth.user),{headers:{"Cache-Control":"no-store"}})
  } catch(e) {
    if (e instanceof ManualExitError) { lprFields({reason:e.code}); lprLog("review_rejected",{reason:e.code,explanation:e.message},"warn") }
    else lprError("review_failed",e)
    return NextResponse.json({error:e instanceof ManualExitError ? e.message : "Verificarea nu a reușit.",code:e instanceof ManualExitError ? e.code : undefined},{status:e instanceof ManualExitError ? e.status : 503})
  }
}

export const POST = withLprRequest(POSTHandler)
