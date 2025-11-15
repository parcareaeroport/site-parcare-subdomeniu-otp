import { NextRequest, NextResponse } from "next/server"
import { createBookingWithFirestore } from "@/app/actions/booking-actions"
import { normalizeLicensePlate } from "@/lib/utils"

// Basic CORS headers for external WP site calls
const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.WP_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(request: NextRequest) {
  try {
    // Optional token auth (set EXTERNAL_BOOKING_TOKEN to enforce)
    const expectedToken = process.env.EXTERNAL_BOOKING_TOKEN
    if (expectedToken) {
      const providedToken =
        request.headers.get("x-auth-token") ||
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
      if (!providedToken || providedToken !== expectedToken) {
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        )
      }
    }

    const body = await request.json()

    // Extract core fields (required)
    const {
      licensePlate,
      startDate,
      startTime,
      endDate,
      endTime,
    } = body || {}

    if (!licensePlate || !startDate || !startTime || !endDate || !endTime) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Missing required fields: licensePlate, startDate, startTime, endDate, endTime",
        },
        { status: 400, headers: corsHeaders }
      )
    }

    // Customer and optional fields (95% same as current front-end)
    const {
      firstName = "",
      lastName = "",
      clientName, // optional override
      email,
      phone,
      numberOfPersons,
      address,
      city,
      county,
      postalCode,
      country,
      needInvoice,
      company,
      companyVAT,
      companyReg,
      companyAddress,
      orderNotes,
      termsAccepted,
      paymentMethod, // "card" | "pay_on_site"
      paymentStatus, // optional override: "paid" | "pending" | "n/a"
      amount,
      days,
    } = body || {}

    // Build FormData for createBookingWithFirestore (expects FormData)
    const fd = new FormData()
    fd.append("licensePlate", normalizeLicensePlate(String(licensePlate)))
    fd.append("startDate", String(startDate))
    fd.append("startTime", String(startTime))
    fd.append("endDate", String(endDate))
    fd.append("endTime", String(endTime))

    // clientName/title similar to existing usage
    const computedClientName =
      typeof clientName === "string" && clientName.trim().length > 0
        ? clientName
        : `${firstName || ""} ${lastName || ""}`.trim()
    if (computedClientName) fd.append("clientName", computedClientName)
    if (firstName) fd.append("clientTitle", String(firstName))

    // Determine source and payment status
    const isPayOnSite = String(paymentMethod || "").toLowerCase() === "pay_on_site"
    const resolvedSource = isPayOnSite ? "pay_on_site" : "webhook"
    const resolvedPaymentStatus =
      typeof paymentStatus === "string"
        ? paymentStatus
        : isPayOnSite
        ? "pending"
        : "n/a"

    // Call existing booking flow to ensure identical Firestore schema and email behavior
    const result = await createBookingWithFirestore(fd, {
      clientEmail: email,
      clientPhone: phone,
      numberOfPersons:
        typeof numberOfPersons === "number"
          ? numberOfPersons
          : parseInt(String(numberOfPersons || "1")) || 1,
      paymentStatus: resolvedPaymentStatus,
      amount: typeof amount === "number" ? amount : undefined,
      days: typeof days === "number" ? days : undefined,
      source: resolvedSource,
      // Billing and address
      company: needInvoice ? company : undefined,
      companyVAT: needInvoice ? companyVAT : undefined,
      companyReg: needInvoice ? companyReg : undefined,
      companyAddress: needInvoice ? companyAddress : undefined,
      needInvoice: !!needInvoice,
      address,
      city,
      county,
      postalCode,
      country,
      orderNotes,
      // Terms
      termsAccepted: !!termsAccepted,
    })

    return NextResponse.json(result, { status: 200, headers: corsHeaders })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: corsHeaders }
    )
  }
}


