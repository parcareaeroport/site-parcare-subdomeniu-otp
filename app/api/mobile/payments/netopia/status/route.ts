import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import { db, doc, getDoc } from "@/lib/server-firestore"

export async function OPTIONS() {
  return mobileOptionsResponse()
}

/** Poll payment status after redirect — reads from pendingPayments collection. */
export async function GET(request: Request) {
  const auth = await verifyMobileUser(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const orderId = searchParams.get("orderId")?.trim()

  if (!orderId) {
    return mobileJsonResponse({ success: false, error: "orderId is required" }, 400)
  }

  try {
    const pendingSnap = await getDoc(doc(db, "pendingPayments", orderId))

    if (!pendingSnap.exists()) {
      return mobileJsonResponse({
        success: true,
        status: "pending" as const,
        orderId,
      })
    }

    const data = pendingSnap.data() as {
      status: string
      bookingId?: string
      bookingNumber?: string
      bookingSuccess?: boolean
    }

    const status =
      data.status === "paid" || data.status === "completed"
        ? "paid"
        : data.status === "failed"
          ? "failed"
          : "pending"

    return mobileJsonResponse({
      success: true,
      status,
      orderId,
      bookingId: data.bookingId || undefined,
      bookingNumber: data.bookingNumber || undefined,
    })
  } catch (error) {
    console.error("[netopia-status] Error:", error)
    return mobileJsonResponse({
      success: true,
      status: "pending" as const,
      orderId,
    })
  }
}
