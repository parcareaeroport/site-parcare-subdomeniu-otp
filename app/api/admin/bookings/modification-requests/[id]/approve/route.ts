import { NextResponse } from "next/server"
import { authorizeAdminRequest } from "@/lib/admin-api-auth"
import { approveBookingModificationRequest } from "@/lib/booking-modifications"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(req, ["admin"])
  if (!auth.ok) return auth.response

  try {
    const { id } = await params
    console.info("[booking-modification] admin_approve_endpoint_called", {
      modificationRequestId: id,
      actorEmail: auth.user.email || null,
    })
    const result = await approveBookingModificationRequest(id, auth.user.email)
    console.info("[booking-modification] admin_approve_endpoint_completed", {
      modificationRequestId: id,
      actorEmail: auth.user.email || null,
      result,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error("[booking-modification] admin_approve_endpoint_failed", {
      message: error instanceof Error ? error.message : "Approve failed",
    })
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Approve failed" },
      { status: 400 }
    )
  }
}
