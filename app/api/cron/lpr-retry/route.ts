import { withLprRequest, lprFields, lprError } from "@/lib/lpr-log.server"
import { NextResponse } from "next/server"
import { retryPendingLprEvents } from "@/lib/lpr-service"
import { validSecret } from "@/lib/lpr-camera-config.server"
export const dynamic = "force-dynamic"
export const maxDuration = 60
async function GETHandler(request: Request) {
  if (!process.env.CRON_SECRET) { lprFields({reason:"worker_not_configured"}); return NextResponse.json({error:"Worker not configured"},{status:503}) }
  if (!validSecret(request.headers.get("authorization"),process.env.CRON_SECRET)) return NextResponse.json({error:"Unauthorized"},{status:401})
  try { return NextResponse.json(await retryPendingLprEvents()) }
  catch (error) { lprError("retry_failed",error); lprFields({reason:"retry_unavailable"}); return NextResponse.json({error:"Retry unavailable"},{status:503}) }
}

export const GET = withLprRequest(GETHandler)
