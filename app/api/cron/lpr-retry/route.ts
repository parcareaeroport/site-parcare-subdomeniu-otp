import { NextResponse } from "next/server"
import { retryPendingLprEvents } from "@/lib/lpr-service"
import { validSecret } from "@/lib/lpr-camera-config.server"
export const dynamic = "force-dynamic"
export const maxDuration = 60
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({error:"Worker not configured"},{status:503})
  if (!validSecret(request.headers.get("authorization"),process.env.CRON_SECRET)) return NextResponse.json({error:"Unauthorized"},{status:401})
  try { return NextResponse.json(await retryPendingLprEvents()) }
  catch { return NextResponse.json({error:"Retry unavailable"},{status:503}) }
}
