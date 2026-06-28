const API_CONFIG = {
  url: process.env.PARKING_API_URL || "http://localhost:7001/MultiparkWeb_eServices/booking_submit",
  username: process.env.PARKING_API_USERNAME || "",
  password: process.env.PARKING_API_PASSWORD || "",
  multiparkId: process.env.PARKING_MULTIPARK_ID || "001#002",
}

export type MultiparkBookingInput = {
  bookingNumber?: string
  licensePlate: string
  startDate: string
  startTime: string
  durationMinutes: number
  clientName?: string
  clientTitle?: string
}

export type MultiparkBookingResult = {
  success: boolean
  message: string
  bookingNumber?: string | null
  apiErrorCode?: string | null
  apiPayload: string
  apiResponse: string
  httpStatus?: number
}

function maskUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return value.replace(/\/\/([^/@]+)@/, "//***@")
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function formatMultiparkStartDate(startDate: string, startTime: string): string {
  return new Date(`${startDate}T${startTime}:00`)
    .toISOString()
    .replace(/T/, " ")
    .replace(/-/g, "/")
    .replace(/\.\d+Z$/, "")
}

function generateBookingNumber() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function postMultiparkXml(
  operation: "create" | "cancel",
  bookingNumber: string,
  xmlPayload: string,
  meta: Record<string, unknown>
): Promise<MultiparkBookingResult> {
  const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45000)

  console.info("[multipark-bookings] request_sent", {
    operation,
    bookingNumber,
    endpoint: maskUrl(API_CONFIG.url),
    hasUsername: Boolean(API_CONFIG.username),
    hasPassword: Boolean(API_CONFIG.password),
    multiparkId: API_CONFIG.multiparkId,
    ...meta,
  })

  try {
    const response = await fetch(API_CONFIG.url, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "text/xml",
      },
      body: xmlPayload,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    const responseText = await response.text()
    const errorCode = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)?.[1] || null
    const message = responseText.match(/<Message>(.+?)<\/Message>/)?.[1] || "Răspuns necunoscut de la Multipark"
    const success = response.ok && errorCode === "1"

    console.info("[multipark-bookings] response_received", {
      operation,
      bookingNumber,
      httpStatus: response.status,
      ok: response.ok,
      apiErrorCode: errorCode,
      success,
      message,
      ...meta,
    })

    return {
      success,
      message: success
        ? operation === "create"
          ? "Rezervarea a fost creată în Multipark."
          : "Rezervarea a fost anulată în Multipark."
        : `Eroare Multipark: ${message}`,
      bookingNumber: operation === "create" && success ? bookingNumber : null,
      apiErrorCode: errorCode,
      apiPayload: xmlPayload,
      apiResponse: responseText,
      httpStatus: response.status,
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.error("[multipark-bookings] request_exception", {
      operation,
      bookingNumber,
      message: error instanceof Error ? error.message : "Unknown error",
      name: error instanceof Error ? error.name : undefined,
      ...meta,
    })
    return {
      success: false,
      message: error instanceof Error ? error.message : "Eroare la apelul Multipark",
      bookingNumber: null,
      apiPayload: xmlPayload,
      apiResponse: "",
    }
  }
}

export async function createMultiparkBooking(input: MultiparkBookingInput): Promise<MultiparkBookingResult> {
  const bookingNumber = input.bookingNumber || generateBookingNumber()
  const formattedStartDate = formatMultiparkStartDate(input.startDate, input.startTime)
  const xmlPayload = `
    <WSRequestBookingSubmitV1>
      <MultiparkId>${escapeXml(API_CONFIG.multiparkId)}</MultiparkId>
      <OperationType>N</OperationType>
      <BookingNumber>${escapeXml(bookingNumber)}</BookingNumber>
      <LicensePlate>${escapeXml(input.licensePlate)}</LicensePlate>
      <StartDate>${formattedStartDate}</StartDate>
      <Duration>${input.durationMinutes}</Duration>
      ${input.clientTitle ? `<ClientTitle>${escapeXml(input.clientTitle)}</ClientTitle>` : ""}
      ${input.clientName ? `<ClientName>${escapeXml(input.clientName)}</ClientName>` : ""}
      <AccessMode>0</AccessMode>
    </WSRequestBookingSubmitV1>
  `.trim()

  return postMultiparkXml("create", bookingNumber, xmlPayload, {
    licensePlate: input.licensePlate,
    startDate: input.startDate,
    startTime: input.startTime,
    formattedStartDate,
    durationMinutes: input.durationMinutes,
  })
}

export async function cancelMultiparkBooking(bookingNumber: string): Promise<MultiparkBookingResult> {
  const xmlPayload = `
    <WSRequestBookingSubmitV1>
      <MultiparkId>${escapeXml(API_CONFIG.multiparkId)}</MultiparkId>
      <OperationType>D</OperationType>
      <BookingNumber>${escapeXml(bookingNumber)}</BookingNumber>
    </WSRequestBookingSubmitV1>
  `.trim()

  return postMultiparkXml("cancel", bookingNumber, xmlPayload, {})
}
