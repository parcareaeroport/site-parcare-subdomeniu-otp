import { verifyMobileUser } from "@/lib/mobile-api-auth"
import { mobileJsonResponse, mobileOptionsResponse } from "@/lib/mobile-cors"
import {
  collection,
  db,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "@/lib/server-firestore"

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
    console.info("[netopia-status] Verification requested", {
      orderId,
      userId: auth.user.uid,
      isGuest: auth.user.isGuest,
    })
    const pendingSnap = await getDoc(doc(db, "pendingPayments", orderId))

    if (!pendingSnap.exists()) {
      console.warn("[netopia-status] Pending payment document not found", {
        orderId,
        userId: auth.user.uid,
      })
      const bookingsRef = collection(db, "bookings")
      const byOrderId = query(bookingsRef, where("paymentOrderId", "==", orderId))
      const byOrderIdSnap = await getDocs(byOrderId)
      if (!byOrderIdSnap.empty) {
        const bookingDoc = byOrderIdSnap.docs[0]
        const bookingData = bookingDoc.data() as { apiBookingNumber?: string }
        console.info("[netopia-status] Booking found even though pending payment is missing", {
          orderId,
          bookingId: bookingDoc.id,
          bookingNumber: bookingData.apiBookingNumber,
        })
        return mobileJsonResponse({
          success: true,
          status: "paid" as const,
          orderId,
          bookingId: bookingDoc.id,
          bookingNumber: bookingData.apiBookingNumber || undefined,
        })
      }
      return mobileJsonResponse({
        success: true,
        status: "pending" as const,
        orderId,
      })
    }

    const data = pendingSnap.data() as {
      status: string
      ntpID?: string
      bookingId?: string
      bookingNumber?: string
      bookingSuccess?: boolean
      bookingError?: string
      refundRequired?: boolean
      paymentType?: string
      modificationRequestId?: string
    }

    if (data.bookingSuccess && data.bookingId) {
      console.info("[netopia-status] Pending payment already linked to booking", {
        orderId,
        status: data.status,
        bookingId: data.bookingId,
        bookingNumber: data.bookingNumber,
      })
      return mobileJsonResponse({
        success: true,
        status: "paid" as const,
        orderId,
        bookingId: data.bookingId,
        bookingNumber: data.bookingNumber || undefined,
        paymentType: data.paymentType || undefined,
        modificationRequestId: data.modificationRequestId || undefined,
      })
    }

    if (data.status !== "paid" && data.status !== "completed") {
      const bookingsRef = collection(db, "bookings")
      const byOrderId = query(bookingsRef, where("paymentOrderId", "==", orderId))
      const byOrderIdSnap = await getDocs(byOrderId)

      if (!byOrderIdSnap.empty) {
        const bookingDoc = byOrderIdSnap.docs[0]
        const bookingData = bookingDoc.data() as { apiBookingNumber?: string }
        console.info("[netopia-status] Booking found by paymentOrderId fallback", {
          orderId,
          bookingId: bookingDoc.id,
          bookingNumber: bookingData.apiBookingNumber,
        })
        await updateDoc(doc(db, "pendingPayments", orderId), {
          status: "paid",
          bookingId: bookingDoc.id,
          bookingNumber: bookingData.apiBookingNumber || null,
          bookingSuccess: true,
          updatedAt: serverTimestamp(),
        })
        return mobileJsonResponse({
          success: true,
          status: "paid" as const,
          orderId,
          bookingId: bookingDoc.id,
          bookingNumber: bookingData.apiBookingNumber || undefined,
        })
      }

      if (data.ntpID) {
        const byPaymentIntentId = query(bookingsRef, where("paymentIntentId", "==", data.ntpID))
        const byPaymentIntentIdSnap = await getDocs(byPaymentIntentId)

        if (!byPaymentIntentIdSnap.empty) {
          const bookingDoc = byPaymentIntentIdSnap.docs[0]
          const bookingData = bookingDoc.data() as { apiBookingNumber?: string }
          console.info("[netopia-status] Booking found by ntpID fallback", {
            orderId,
            ntpID: data.ntpID,
            bookingId: bookingDoc.id,
            bookingNumber: bookingData.apiBookingNumber,
          })
          await updateDoc(doc(db, "pendingPayments", orderId), {
            status: "paid",
            bookingId: bookingDoc.id,
            bookingNumber: bookingData.apiBookingNumber || null,
            bookingSuccess: true,
            updatedAt: serverTimestamp(),
          })
          return mobileJsonResponse({
            success: true,
            status: "paid" as const,
            orderId,
            bookingId: bookingDoc.id,
            bookingNumber: bookingData.apiBookingNumber || undefined,
          })
        }
      }
    }

    const status =
      data.status === "paid" || data.status === "completed"
        ? "paid"
        : data.status === "failed" || data.status === "booking_failed_refund_required"
          ? "failed"
          : "pending"

    console.info("[netopia-status] Returning pending payment status", {
      orderId,
      storedStatus: data.status,
      resolvedStatus: status,
      bookingId: data.bookingId,
      bookingNumber: data.bookingNumber,
      bookingSuccess: data.bookingSuccess,
      refundRequired: data.refundRequired,
    })
    return mobileJsonResponse({
      success: true,
      status,
      orderId,
      bookingId: data.bookingId || undefined,
      bookingNumber: data.bookingNumber || undefined,
      paymentType: data.paymentType || undefined,
      modificationRequestId: data.modificationRequestId || undefined,
      error: data.bookingError || undefined,
      refundRequired: data.refundRequired || undefined,
    })
  } catch (error) {
    console.error("[netopia-status] Error during verification", {
      orderId,
      userId: auth.user.uid,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return mobileJsonResponse({
      success: true,
      status: "pending" as const,
      orderId,
    })
  }
}
