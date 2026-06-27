const API_CONFIG = {
  url: process.env.PARKING_API_URL || "http://localhost:7001/MultiparkWeb_eServices/booking_submit",
  username: process.env.PARKING_API_USERNAME || "",
  password: process.env.PARKING_API_PASSWORD || "",
  multiparkId: process.env.PARKING_MULTIPARK_ID || "001#002",
}

function maskUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return value.replace(/\/\/([^/@]+)@/, "//***@")
  }
}

export type MultiparkUpdateInput = {
  bookingNumber: string
  licensePlate: string
  startDate: string
  startTime: string
  durationMinutes: number
  clientName?: string
  clientTitle?: string
}

function formatMultiparkStartDate(startDate: string, startTime: string): string {
  return new Date(`${startDate}T${startTime}:00`)
    .toISOString()
    .replace(/T/, " ")
    .replace(/-/g, "/")
    .replace(/\.\d+Z$/, "")
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

export async function updateMultiparkBooking(input: MultiparkUpdateInput): Promise<{
  success: boolean
  message: string
  apiErrorCode?: string
  apiPayload: string
  apiResponse: string
  httpStatus?: number
}> {
  const formattedStartDate = formatMultiparkStartDate(input.startDate, input.startTime)
  console.info("[multipark-update] multipark_update_prepare", {
    bookingNumber: input.bookingNumber,
    licensePlate: input.licensePlate,
    startDate: input.startDate,
    startTime: input.startTime,
    formattedStartDate,
    durationMinutes: input.durationMinutes,
    endpoint: maskUrl(API_CONFIG.url),
    hasUsername: Boolean(API_CONFIG.username),
    hasPassword: Boolean(API_CONFIG.password),
    multiparkId: API_CONFIG.multiparkId,
  })
  const xmlPayload = `
    <WSRequestBookingSubmitV1>
      <MultiparkId>${escapeXml(API_CONFIG.multiparkId)}</MultiparkId>
      <OperationType>N</OperationType>
      <BookingNumber>${escapeXml(input.bookingNumber)}</BookingNumber>
      <LicensePlate>${escapeXml(input.licensePlate)}</LicensePlate>
      <StartDate>${formattedStartDate}</StartDate>
      <Duration>${input.durationMinutes}</Duration>
      ${input.clientTitle ? `<ClientTitle>${escapeXml(input.clientTitle)}</ClientTitle>` : ""}
      ${input.clientName ? `<ClientName>${escapeXml(input.clientName)}</ClientName>` : ""}
      <AccessMode>0</AccessMode>
    </WSRequestBookingSubmitV1>
  `.trim()

  const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45000)

  try {
    console.info("[multipark-update] multipark_update_request_sent", {
      bookingNumber: input.bookingNumber,
      licensePlate: input.licensePlate,
      durationMinutes: input.durationMinutes,
      endpoint: maskUrl(API_CONFIG.url),
    })
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
    const errorCode = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)?.[1]
    const message = responseText.match(/<Message>(.+?)<\/Message>/)?.[1] || "Răspuns necunoscut de la Multipark"
    const success = response.ok && errorCode === "1"

    console.info("[multipark-update] multipark_update_response", {
      bookingNumber: input.bookingNumber,
      licensePlate: input.licensePlate,
      httpStatus: response.status,
      ok: response.ok,
      apiErrorCode: errorCode || null,
      success,
      message,
    })

    return {
      success,
      message: errorCode === "1" ? "Rezervarea a fost modificată în Multipark." : `Eroare Multipark: ${message}`,
      apiErrorCode: errorCode,
      apiPayload: xmlPayload,
      apiResponse: responseText,
      httpStatus: response.status,
    }
  } catch (error) {
    clearTimeout(timeoutId)
    console.error("[multipark-update] multipark_update_exception", {
      bookingNumber: input.bookingNumber,
      licensePlate: input.licensePlate,
      message: error instanceof Error ? error.message : "Unknown error",
      name: error instanceof Error ? error.name : undefined,
    })
    return {
      success: false,
      message: error instanceof Error ? error.message : "Eroare la modificarea rezervării în Multipark",
      apiPayload: xmlPayload,
      apiResponse: "",
    }
  }
}
