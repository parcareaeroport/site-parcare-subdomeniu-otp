import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { applyBookingModificationRequest } from "@/lib/booking-modifications"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(req, ["admin"])
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    console.info("[booking-modification] admin_retry_endpoint_called", {
      modificationRequestId: id,
      actorEmail: auth.user.email || null,
    })
    const result = await applyBookingModificationRequest(id, {
      actorEmail: auth.user.email,
      reason: "retry",
    })
    console.info("[booking-modification] admin_retry_endpoint_completed", {
      modificationRequestId: id,
      actorEmail: auth.user.email || null,
      result,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[booking-modification] admin_retry_endpoint_failed", {
      message: error instanceof Error ? error.message : "Retry failed",
    })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Retry failed" },
      { status: 400 }
    )
  }
}
