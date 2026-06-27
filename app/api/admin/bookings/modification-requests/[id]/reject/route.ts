import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { rejectBookingModificationRequest } from "@/lib/booking-modifications"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(req, ["admin"])
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    console.info("[booking-modification] admin_reject_endpoint_called", {
      modificationRequestId: id,
      actorEmail: auth.user.email || null,
      hasReason: Boolean(String(body?.reason || "").trim()),
    })
    await rejectBookingModificationRequest(id, auth.user.email, String(body?.reason || "").trim() || undefined)
    console.info("[booking-modification] admin_reject_endpoint_completed", {
      modificationRequestId: id,
      actorEmail: auth.user.email || null,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[booking-modification] admin_reject_endpoint_failed", {
      message: error instanceof Error ? error.message : "Reject failed",
    })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Reject failed" },
      { status: 400 }
    )
  }
}
