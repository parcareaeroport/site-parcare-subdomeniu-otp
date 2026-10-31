import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { preparePlateChange, savePlateChange } from "@/lib/booking-plate.server"
import { ManualExitError } from "@/lib/manual-lpr-exit.server"
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request, ["admin", "employee", "entriesOperator"])
  if (!auth.ok) return auth.response
  try {
    const input = await request.json()
    if (typeof input?.bookingId !== "string" || !input.bookingId || input.bookingId.includes("/") || typeof input.plate !== "string") return NextResponse.json({error:"Date invalide."},{status:400})
    const result = input.action === "prepare" ? await preparePlateChange(input.bookingId, input.plate) : input.action === "save" ? await savePlateChange(input, auth.user) : null
    return NextResponse.json(result || {error:"Acțiune invalidă."}, {status:result ? 200 : 400, headers:{"Cache-Control":"no-store"}})
  } catch(e) {
    return NextResponse.json({error:e instanceof ManualExitError ? e.message : "Verificarea/salvarea a eșuat.", code:e instanceof ManualExitError ? e.code : undefined},{status:e instanceof ManualExitError ? e.status : 503})
  }
}
