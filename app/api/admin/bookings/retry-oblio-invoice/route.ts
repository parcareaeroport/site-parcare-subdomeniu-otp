import { NextResponse } from "next/server"
import { db } from "@/lib/firebase"
import { doc, getDoc, increment, serverTimestamp, updateDoc } from "firebase/firestore"
import { generateOblioInvoice } from "@/lib/oblio-integration"
import { classifyOblioError, recordOblioFailure } from "@/lib/oblio-alerting"

const OBLIO_INVOICE_TIMEOUT_MS = 25000

function isCancelledStatus(status: string): boolean {
  return String(status || "").toLowerCase().includes("cancelled")
}

function isEligibleForManualRetry(booking: any): { ok: boolean; reason?: string } {
  const source = String(booking?.source || "")
  const paymentStatus = String(booking?.paymentStatus || "")
  const status = String(booking?.status || "")

  if (paymentStatus !== "paid") {
    return { ok: false, reason: "Doar rezervările paid online pot fi re-facturate manual." }
  }
  if (source !== "webhook" && source !== "test_mode") {
    return { ok: false, reason: "Re-facturarea manuală este permisă doar pentru source webhook/test_mode." }
  }
  if (isCancelledStatus(status)) {
    return { ok: false, reason: "Rezervările anulate nu pot fi re-facturate." }
  }
  return { ok: true }
}

export async function POST(req: Request) {
  let bookingId = ""
  let bookingRef: any = null
  let bookingData: any = null
  let invoiceBookingId = ""

  try {
    const body = await req.json().catch(() => null)
    bookingId = String(body?.bookingId || "").trim()
    if (!bookingId) {
      return NextResponse.json(
        { success: false, error: "Missing bookingId", errorKind: "invalid_state" },
        { status: 400 },
      )
    }

    bookingRef = doc(db, "bookings", bookingId)
    const bookingSnap = await getDoc(bookingRef)
    if (!bookingSnap.exists()) {
      return NextResponse.json(
        { success: false, error: "Booking not found", errorKind: "invalid_state" },
        { status: 404 },
      )
    }

    bookingData = bookingSnap.data()
    const eligibility = isEligibleForManualRetry(bookingData)
    if (!eligibility.ok) {
      return NextResponse.json(
        {
          success: false,
          error: eligibility.reason || "Booking not eligible for manual Oblio retry",
          errorKind: "invalid_state",
        },
        { status: 400 },
      )
    }

    invoiceBookingId = bookingData?.apiBookingNumber ? String(bookingData.apiBookingNumber) : bookingId

    await updateDoc(bookingRef, {
      "oblio.status": "pending",
      "oblio.lastAttemptAt": serverTimestamp(),
      "oblio.attempts": increment(1),
      "oblio.lastSource": "manual",
      "oblio.lastUpdatedAt": serverTimestamp(),
    })

    const oblioInvoiceData = {
      bookingId: invoiceBookingId,
      clientName: String(bookingData?.clientName || "Client Site Parcări"),
      clientEmail: String(bookingData?.clientEmail || ""),
      clientPhone: bookingData?.clientPhone ? String(bookingData.clientPhone) : undefined,
      licensePlate: String(bookingData?.licensePlate || "N/A"),
      startDate: String(bookingData?.startDate || ""),
      endDate: String(bookingData?.endDate || ""),
      location: "Site Parcări",
      parkingSpot: invoiceBookingId,
      totalCost: Number(bookingData?.amount || 0) || 0,
      billingType: bookingData?.company ? "corporate" : "individual",
      company: bookingData?.company ? String(bookingData.company) : undefined,
      companyVAT: bookingData?.companyVAT ? String(bookingData.companyVAT) : undefined,
      companyReg: bookingData?.companyReg ? String(bookingData.companyReg) : undefined,
      companyAddress: bookingData?.companyAddress ? String(bookingData.companyAddress) : undefined,
      clientAddress: bookingData?.address ? String(bookingData.address) : undefined,
      clientCity: bookingData?.city ? String(bookingData.city) : undefined,
      clientCounty: bookingData?.county ? String(bookingData.county) : undefined,
      clientCountry: bookingData?.country ? String(bookingData.country) : undefined,
    }

    const oblioPromise = generateOblioInvoice(oblioInvoiceData as any)
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Oblio timeout")), OBLIO_INVOICE_TIMEOUT_MS),
    )
    const invoiceResult: any = await Promise.race([oblioPromise, timeoutPromise])

    if (invoiceResult?.success) {
      await updateDoc(bookingRef, {
        "oblio.status": "success",
        "oblio.invoiceNumber": invoiceResult.invoiceNumber || null,
        "oblio.invoiceUrl": invoiceResult.invoiceUrl || null,
        "oblio.lastError": null,
        "oblio.lastSuccessAt": serverTimestamp(),
        "oblio.lastSource": "manual",
        "oblio.lastUpdatedAt": serverTimestamp(),
      })

      return NextResponse.json({
        success: true,
        invoiceNumber: invoiceResult.invoiceNumber,
        invoiceUrl: invoiceResult.invoiceUrl,
      })
    }

    const errorMessage = String(invoiceResult?.error || "Oblio invoice failed")
    const errorKind = classifyOblioError(errorMessage)

    await updateDoc(bookingRef, {
      "oblio.status": "failed",
      "oblio.lastError": errorMessage,
      "oblio.lastFailureAt": serverTimestamp(),
      "oblio.lastSource": "manual",
      "oblio.lastUpdatedAt": serverTimestamp(),
    })

    await recordOblioFailure({
      bookingId: invoiceBookingId,
      bookingOrigin: bookingData?.bookingOrigin ? String(bookingData.bookingOrigin) : undefined,
      source: "manual",
      message: errorMessage,
      errorKind,
    })

    return NextResponse.json({ success: false, error: errorMessage, errorKind }, { status: 502 })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorKind = classifyOblioError(errorMessage)

    if (bookingRef) {
      try {
        await updateDoc(bookingRef, {
          "oblio.status": "failed",
          "oblio.lastError": errorMessage,
          "oblio.lastFailureAt": serverTimestamp(),
          "oblio.lastSource": "manual",
          "oblio.lastUpdatedAt": serverTimestamp(),
        })
      } catch (trackingError) {
        console.error("Failed to persist manual Oblio retry error", trackingError)
      }
    }

    if (bookingId) {
      await recordOblioFailure({
        bookingId: invoiceBookingId || bookingId,
        bookingOrigin: bookingData?.bookingOrigin ? String(bookingData.bookingOrigin) : undefined,
        source: "manual",
        message: errorMessage,
        errorKind,
      })
    }

    return NextResponse.json({ success: false, error: errorMessage, errorKind }, { status: 500 })
  }
}
