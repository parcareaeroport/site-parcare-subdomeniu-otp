import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { reviewLprEvent } from "@/lib/lpr-review.server"
import { ManualExitError } from "@/lib/manual-lpr-exit.server"
export async function POST(request:Request) {
  const auth = await authorizeAdminRequest(request,["admin"])
  if (!auth.ok) return auth.response
  try {
    const input = await request.json()
    if (typeof input.eventId !== "string" || !input.eventId || input.eventId.includes("/")) return NextResponse.json({error:"Eveniment invalid."},{status:400})
    return NextResponse.json(await reviewLprEvent(input,auth.user),{headers:{"Cache-Control":"no-store"}})
  } catch(e) {
    return NextResponse.json({error:e instanceof ManualExitError ? e.message : "Verificarea nu a reușit.",code:e instanceof ManualExitError ? e.code : undefined},{status:e instanceof ManualExitError ? e.status : 503})
  }
}
