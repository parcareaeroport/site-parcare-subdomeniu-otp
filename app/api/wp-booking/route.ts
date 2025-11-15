import { NextRequest, NextResponse } from "next/server"
import { createBookingWithFirestore } from "@/app/actions/booking-actions"
import { normalizeLicensePlate } from "@/lib/utils"

type PaymentStatus = "paid" | "pending" | "n/a"

// =========================
// CORS
// =========================
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env.WP_ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Auth-Token, Authorization",
}

// Mic helper ca să nu explodăm log-urile
function safeStringify(obj: any) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return "[unserializable]"
  }
}

// =========================
// Helper: extrage datele din payload Elementor Webhook
// (Advanced Data = Yes) sau lasă body-ul neschimbat
// =========================
function extractFromElementor(body: any): any {
  if (!body || !body.fields) {
    console.log("[WP-BOOKING] No body.fields found, assuming flat JSON payload.")
    return body || {}
  }

  console.log(
    "[WP-BOOKING] Detected Elementor Webhook payload (with fields). Normalizing..."
  )

  const fieldsArray = Array.isArray(body.fields)
    ? body.fields
    : Object.values(body.fields)

  const getVal = (id: string): any => {
    const f: any = fieldsArray.find(
      (field: any) =>
        field.id === id ||
        field.field_id === id ||
        field._id === id ||
        field.custom_id === id
    )
    return f?.value ?? f?.raw_value ?? ""
  }

  const needInvoiceRaw = getVal("needInvoice")
  const termsAcceptedRaw = getVal("termsAccepted")

  const normalized = {
    // core booking
    licensePlate: getVal("licensePlate"),
    startDate: getVal("startDate"),
    startTime: getVal("startTime"),
    endDate: getVal("endDate"),
    endTime: getVal("endTime"),

    // client
    firstName: getVal("firstName"),
    lastName: getVal("lastName"),
    clientName: getVal("clientName"),
    email: getVal("email"),
    phone: getVal("phone"),
    numberOfPersons: getVal("numberOfPersons"),

    // address
    address: getVal("address"),
    city: getVal("city"),
    county: getVal("county"),
    postalCode: getVal("postalCode"),
    country: getVal("country"),

    // invoice
    needInvoice:
      needInvoiceRaw === "yes" ||
      needInvoiceRaw === "on" ||
      needInvoiceRaw === "1" ||
      needInvoiceRaw === true,
    company: getVal("company"),
    companyVAT: getVal("companyVAT"),
    companyReg: getVal("companyReg"),
    companyAddress: getVal("companyAddress"),

    // misc
    orderNotes: getVal("orderNotes"),
    termsAccepted:
      termsAcceptedRaw === "yes" ||
      termsAcceptedRaw === "on" ||
      termsAcceptedRaw === "1" ||
      termsAcceptedRaw === true,

    // payment
    paymentMethod: getVal("paymentMethod"), // în Elementor VALUE trebuie să fie "card" / "pay_on_site"
    paymentStatus: getVal("paymentStatus"),
    amount: getVal("amount"),
    days: getVal("days"),
  }

  console.log(
    "[WP-BOOKING] Normalized Elementor body:",
    safeStringify(normalized)
  )

  return normalized
}

// =========================
// Helper: parse body from JSON, x-www-form-urlencoded, or multipart/form-data
// =========================
async function parseIncomingBody(request: NextRequest, requestId: string): Promise<any> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || ""
  console.log(`[WP-BOOKING][${requestId}] Content-Type: ${contentType || "[none]"}`)

  try {
    if (contentType.includes("application/json")) {
      const json = await request.json()
      console.log(`[WP-BOOKING][${requestId}] Parsed as JSON.`)
      return json
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await request.text()
      const params = new URLSearchParams(text)
      const obj = Object.fromEntries(params.entries())
      console.log(`[WP-BOOKING][${requestId}] Parsed as x-www-form-urlencoded. Keys:`, Object.keys(obj))
      return obj
    }
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData()
      const obj: Record<string, any> = {}
      for (const [key, value] of form.entries()) {
        // File vs string – aici avem doar câmpuri text pentru rezervare
        obj[key] = typeof value === "string" ? value : (value as File).name
      }
      console.log(`[WP-BOOKING][${requestId}] Parsed as multipart/form-data. Keys:`, Object.keys(obj))
      return obj
    }
  } catch (e) {
    console.warn(`[WP-BOOKING][${requestId}] Primary parsing failed:`, e)
  }

  // Fallbacks: încearcă JSON apoi URLSearchParams din text
  try {
    const text = await request.text()
    try {
      const json = JSON.parse(text)
      console.log(`[WP-BOOKING][${requestId}] Fallback parsed as JSON from text.`)
      return json
    } catch {
      const params = new URLSearchParams(text)
      const obj = Object.fromEntries(params.entries())
      if (Object.keys(obj).length > 0) {
        console.log(`[WP-BOOKING][${requestId}] Fallback parsed as URLSearchParams from text. Keys:`, Object.keys(obj))
        return obj
      }
      console.warn(`[WP-BOOKING][${requestId}] Fallback parsing found no usable data.`)
      return {}
    }
  } catch (e) {
    console.error(`[WP-BOOKING][${requestId}] Ultimate parsing failed:`, e)
    return {}
  }
}

// =========================
// OPTIONS (preflight CORS)
// =========================
export async function OPTIONS() {
  console.log("[WP-BOOKING] OPTIONS preflight called.")
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

// =========================
// POST
// =========================
export async function POST(request: NextRequest) {
  const requestId = `wp-booking-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  console.log(`\n[WP-BOOKING][${requestId}] New POST request received.`)

  try {
    // -------------------------
    // 1. Securitate: token opțional
    // -------------------------
    const expectedToken = process.env.EXTERNAL_BOOKING_TOKEN

    if (expectedToken) {
      console.log(
        `[WP-BOOKING][${requestId}] Token auth enabled. Checking X-Auth-Token / Authorization header...`
      )

      const providedTokenRaw =
        request.headers.get("x-auth-token") ||
        request.headers.get("authorization")

      const providedToken = providedTokenRaw?.replace(/^Bearer\s+/i, "")

      if (!providedToken || providedToken !== expectedToken) {
        console.warn(
          `[WP-BOOKING][${requestId}] Unauthorized request. Provided token: ${providedTokenRaw ? "[present]" : "[missing]"}`
        )
        return NextResponse.json(
          { success: false, error: "Unauthorized" },
          { status: 401, headers: corsHeaders }
        )
      }

      console.log(`[WP-BOOKING][${requestId}] Token auth OK.`)
    } else {
      console.log(
        `[WP-BOOKING][${requestId}] EXTERNAL_BOOKING_TOKEN not set. Skipping auth check.`
      )
    }

    // -------------------------
    // 2. Citim body-ul
    // -------------------------
    const rawBody = await parseIncomingBody(request, requestId)
    console.log(
      `[WP-BOOKING][${requestId}] Raw body from WP:`,
      safeStringify(rawBody)
    )

    const body = extractFromElementor(rawBody)

    console.log(
      `[WP-BOOKING][${requestId}] Final body used for mapping:`,
      safeStringify(body)
    )

    // -------------------------
    // 3. Câmpuri obligatorii
    // -------------------------
    const {
      licensePlate,
      startDate,
      startTime,
      endDate,
      endTime,
    } = body || {}

    console.log(
      `[WP-BOOKING][${requestId}] Required fields extracted:`,
      {
        licensePlate,
        startDate,
        startTime,
        endDate,
        endTime,
      }
    )

    if (!licensePlate || !startDate || !startTime || !endDate || !endTime) {
      const msg =
        "Missing required fields: licensePlate, startDate, startTime, endDate, endTime"
      console.warn(`[WP-BOOKING][${requestId}] ${msg}`)
      return NextResponse.json(
        { success: false, error: msg },
        { status: 400, headers: corsHeaders }
      )
    }

    // -------------------------
    // 4. Câmpuri opționale / client / facturare / plată
    // -------------------------
    const {
      firstName = "",
      lastName = "",
      clientName,
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
      paymentStatus,
      amount,
      days,
    } = body || {}

    console.log(
      `[WP-BOOKING][${requestId}] Optional fields extracted:`,
      safeStringify({
        firstName,
        lastName,
        clientName,
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
        paymentMethod,
        paymentStatus,
        amount,
        days,
      })
    )

    // -------------------------
    // 5. Construim FormData pentru createBookingWithFirestore
    // -------------------------
    const fd = new FormData()

    const normalizedPlate = normalizeLicensePlate(String(licensePlate))
    fd.append("licensePlate", normalizedPlate)
    fd.append("startDate", String(startDate))
    fd.append("startTime", String(startTime))
    fd.append("endDate", String(endDate))
    fd.append("endTime", String(endTime))

    const computedClientName =
      typeof clientName === "string" && clientName.trim().length > 0
        ? clientName
        : `${firstName || ""} ${lastName || ""}`.trim()

    if (computedClientName) fd.append("clientName", computedClientName)
    if (firstName) fd.append("firstName", String(firstName))
    if (lastName) fd.append("lastName", String(lastName))
    if (email) fd.append("email", String(email))
    if (phone) fd.append("phone", String(phone))
    if (numberOfPersons)
      fd.append("numberOfPersons", String(numberOfPersons))
    if (paymentMethod)
      fd.append("paymentMethod", String(paymentMethod))

    console.log(
      `[WP-BOOKING][${requestId}] FormData prepared (summary):`,
      {
        licensePlate: normalizedPlate,
        startDate: String(startDate),
        startTime: String(startTime),
        endDate: String(endDate),
        endTime: String(endTime),
        clientName: computedClientName,
        firstName,
        lastName,
        email,
        phone,
        numberOfPersons: String(numberOfPersons || ""),
        paymentMethod: String(paymentMethod || ""),
      }
    )

    // -------------------------
    // 6. Determinăm source + paymentStatus
    // -------------------------
    const method = String(paymentMethod || "").toLowerCase()
    const isPayOnSite =
      method === "pay_on_site" || method === "pay_on_site_cardless"

    const resolvedSource: "webhook" | "pay_on_site" = isPayOnSite
      ? "pay_on_site"
      : "webhook"

    const allowedPaymentStatuses: PaymentStatus[] = ["paid", "pending", "n/a"]
    const resolvedPaymentStatus: PaymentStatus =
      typeof paymentStatus === "string" &&
      allowedPaymentStatuses.includes(paymentStatus as PaymentStatus)
        ? (paymentStatus as PaymentStatus)
        : isPayOnSite
        ? "pending"
        : "n/a"

    console.log(
      `[WP-BOOKING][${requestId}] Payment/source resolved:`,
      {
        rawPaymentMethod: paymentMethod,
        isPayOnSite,
        resolvedSource,
        rawPaymentStatus: paymentStatus,
        resolvedPaymentStatus,
      }
    )

    // -------------------------
    // 7. Construim options pentru createBookingWithFirestore
    // -------------------------
    const numberOfPersonsResolved =
      typeof numberOfPersons === "number"
        ? numberOfPersons
        : parseInt(String(numberOfPersons || "1"), 10) || 1

    const optionsForBooking = {
      clientEmail: email,
      clientPhone: phone,
      numberOfPersons: numberOfPersonsResolved,
      paymentStatus: resolvedPaymentStatus,
      amount: typeof amount === "number" ? amount : undefined,
      days: typeof days === "number" ? days : undefined,
      source: resolvedSource,

      // billing & address
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

      // terms
      termsAccepted: !!termsAccepted,
    }

    console.log(
      `[WP-BOOKING][${requestId}] Options for createBookingWithFirestore:`,
      safeStringify(optionsForBooking)
    )

    // -------------------------
    // 8. Apelăm flow-ul existent (scriere Firestore + email)
    // -------------------------
    console.log(
      `[WP-BOOKING][${requestId}] Calling createBookingWithFirestore...`
    )

    const result = await createBookingWithFirestore(
      fd,
      optionsForBooking as any
    )

    console.log(
      `[WP-BOOKING][${requestId}] Booking created successfully. Result:`,
      safeStringify(result)
    )

    return NextResponse.json(result, {
      status: 200,
      headers: corsHeaders,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error"

    console.error(
      `[WP-BOOKING][${requestId}] ERROR while processing booking:`,
      error
    )

    return NextResponse.json(
      { success: false, error: message },
      { status: 500, headers: corsHeaders }
    )
  }
}
