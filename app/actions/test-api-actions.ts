"use server"

import { z } from "zod"
import { normalizeLicensePlate } from "@/lib/utils"

// Schema de validare pentru testarea creării unei rezervări
const testCreateBookingSchema = z.object({
  licensePlate: z.string().min(1, "Numărul de înmatriculare este obligatoriu"),
  startDate: z.string().min(1, "Data de intrare este obligatorie"),
  startTime: z.string().min(1, "Ora de intrare este obligatorie"),
  durationMinutes: z.number().min(1, "Durata este obligatorie"),
  clientName: z.string().optional(),
  clientTitle: z.string().optional(),
})

// Schema de validare pentru testarea anulării unei rezervări
const testCancelBookingSchema = z.object({
  bookingNumber: z.string().min(1, "Numărul de rezervare este obligatoriu"),
})

// Configurare API
const API_CONFIG = {
  url: process.env.PARKING_API_URL || "http://89.45.23.61:7001/MultiparkWeb_eServices/booking_submit",
  username: process.env.PARKING_API_USERNAME || "MWBooking",
  password: process.env.PARKING_API_PASSWORD || "AUTOPENI2025",
  multiparkId: process.env.PARKING_MULTIPARK_ID || "001#001",
}

/**
 * Funcție pentru testarea conectivității la API
 */
export async function testApiConnectivity() {
  try {
    console.log("Testing API connectivity to:", API_CONFIG.url)

    // Creare header Basic Auth
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    // Testăm conectivitatea folosind POST cu un payload minim
    // API-ul acceptă doar metoda POST, nu HEAD
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 secunde timeout

    // Creăm un payload minim doar pentru a testa conectivitatea
    // Folosim un BookingNumber invalid pentru a nu afecta datele reale
    const minimalPayload = `
      <WSRequestBookingSubmitV1>
        <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
        <OperationType>N</OperationType>
        <BookingNumber>TEST</BookingNumber>
        <StartDate>2099/01/01 00:00:00</StartDate>
        <Duration>1</Duration>
      </WSRequestBookingSubmitV1>
    `.trim()

    const response = await fetch(API_CONFIG.url, {
      method: "POST", // API-ul acceptă doar POST
      headers: {
        Authorization: authHeader,
        "Content-Type": "text/xml",
      },
      body: minimalPayload,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    const responseText = await response.text()
    console.log("Connectivity Test Response:", responseText)

    // Verificăm dacă am primit un răspuns XML valid
    const isValidResponse = responseText.includes("<WSResponseBookingSubmitV1>")

    return {
      success: response.ok && isValidResponse,
      status: response.status,
      statusText: response.statusText,
      message: `Conectare reușită la API. Status: ${response.status} ${response.statusText}`,
      details: isValidResponse
        ? "API-ul a răspuns cu un format XML valid."
        : "API-ul a răspuns, dar formatul răspunsului nu este cel așteptat.",
      rawResponse: responseText,
    }
  } catch (error) {
    console.error("API Connectivity Test - Error:", error)

    // Extragem informații detaliate despre eroare
    let errorMessage = "Eroare la conectarea cu API-ul"
    let errorDetails = ""

    if (error instanceof Error) {
      errorMessage = error.message

      // Verificăm dacă eroarea are o cauză (de ex. timeout)
      if ("cause" in error && error.cause instanceof Error) {
        errorDetails = error.cause.message
      }
    }

    return {
      success: false,
      status: 0,
      statusText: "Error",
      message: errorMessage,
      details: errorDetails,
    }
  }
}

/**
 * Funcție pentru testarea creării unei rezervări
 */
export async function testCreateBooking(formData: FormData) {
  try {
    console.log("Form data received:", {
      licensePlate: formData.get("licensePlate"),
      startDate: formData.get("startDate"),
      startTime: formData.get("startTime"),
      durationMinutes: formData.get("durationMinutes"),
      clientName: formData.get("clientName"),
      clientTitle: formData.get("clientTitle"),
    })

    // Parsare și validare date formular
    const rawData = {
      licensePlate: normalizeLicensePlate(formData.get("licensePlate") as string),
      startDate: formData.get("startDate") as string,
      startTime: formData.get("startTime") as string,
      durationMinutes: Number.parseInt(formData.get("durationMinutes") as string) || 120,
      clientName: (formData.get("clientName") as string) || "",
      clientTitle: (formData.get("clientTitle") as string) || "",
    }

    // Verificare manuală pentru câmpurile obligatorii
    if (!rawData.licensePlate) {
      return {
        success: false,
        message: "Numărul de înmatriculare este obligatoriu",
      }
    }

    if (!rawData.startDate) {
      return {
        success: false,
        message: "Data de intrare este obligatorie",
      }
    }

    if (!rawData.startTime) {
      return {
        success: false,
        message: "Ora de intrare este obligatorie",
      }
    }

    const validatedData = testCreateBookingSchema.parse(rawData)

    // Formatare dată de început în formatul cerut: YYYY/MM/DD HH:mm:SS
    const startDateObj = new Date(`${validatedData.startDate}T${validatedData.startTime}:00`)
    const formattedStartDate = startDateObj
      .toISOString()
      .replace(/T/, " ")
      .replace(/-/g, "/")
      .replace(/\.\d+Z$/, "")

    // Generare număr de rezervare aleatoriu de 6 cifre
    const bookingNumber = Math.floor(100000 + Math.random() * 900000).toString()

    // Creare payload XML conform documentației
    const xmlPayload = `
      <WSRequestBookingSubmitV1>
        <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
        <OperationType>N</OperationType>
        <BookingNumber>${bookingNumber}</BookingNumber>
        <LicensePlate>${validatedData.licensePlate}</LicensePlate>
        <StartDate>${formattedStartDate}</StartDate>
        <Duration>${validatedData.durationMinutes}</Duration>
        ${validatedData.clientTitle ? `<ClientTitle>${validatedData.clientTitle}</ClientTitle>` : ""}
        ${validatedData.clientName ? `<ClientName>${validatedData.clientName}</ClientName>` : ""}
        <AccessMode>0</AccessMode>
      </WSRequestBookingSubmitV1>
    `.trim()

    // Creare header Basic Auth
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    console.log("Test Create Booking - Request:", {
      url: API_CONFIG.url,
      auth: `${API_CONFIG.username}:***`,
      payload: xmlPayload,
    })

    // Setăm un timeout mai mare (30 secunde)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    // Apel API
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

    console.log("Test Create Booking - Response:", {
      status: response.status,
      statusText: response.statusText,
      body: responseText,
    })

    // Parsare răspuns XML
    const errorCodeMatch = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
    const messageMatch = responseText.match(/<Message>(.+?)<\/Message>/)

    const errorCode = errorCodeMatch ? errorCodeMatch[1] : null
    const message = messageMatch ? messageMatch[1] : "Răspuns necunoscut de la server"

    return {
      success: errorCode === "1",
      statusCode: response.status,
      errorCode,
      message,
      bookingNumber: errorCode === "1" ? bookingNumber : null,
      rawResponse: responseText,
      requestPayload: xmlPayload,
    }
  } catch (error) {
    console.error("Test Create Booking - Error:", error)

    // Extragem informații detaliate despre eroare
    let errorMessage = "Eroare la conectarea cu API-ul"
    let errorDetails = ""

    if (error instanceof Error) {
      errorMessage = error.message

      // Verificăm dacă eroarea are o cauză (de ex. timeout)
      if ("cause" in error && error.cause instanceof Error) {
        errorDetails = error.cause.message
      }
    }

    return {
      success: false,
      message: errorMessage,
      details: errorDetails,
      rawResponse: null,
      requestPayload: null,
    }
  }
}

/**
 * Funcție pentru testarea actualizării unei rezervări
 */
export async function testUpdateBooking(formData: FormData) {
  try {
    console.log("Form data received for update:", {
      bookingNumber: formData.get("bookingNumber"),
      licensePlate: formData.get("licensePlate"),
      startDate: formData.get("startDate"),
      startTime: formData.get("startTime"),
      durationMinutes: formData.get("durationMinutes"),
      clientName: formData.get("clientName"),
      clientTitle: formData.get("clientTitle"),
    })

    // Parsare și validare date formular
    const rawData = {
      bookingNumber: formData.get("bookingNumber") as string,
      licensePlate: normalizeLicensePlate(formData.get("licensePlate") as string || ""),
      startDate: formData.get("startDate") as string,
      startTime: formData.get("startTime") as string,
      durationMinutes: Number.parseInt(formData.get("durationMinutes") as string) || 120,
      clientName: (formData.get("clientName") as string) || "",
      clientTitle: (formData.get("clientTitle") as string) || "",
    }

    // Verificare manuală pentru câmpurile obligatorii
    if (!rawData.bookingNumber) {
      return {
        success: false,
        message: "Numărul de rezervare este obligatoriu pentru actualizare",
      }
    }

    if (!rawData.startDate) {
      return {
        success: false,
        message: "Data de intrare este obligatorie",
      }
    }

    if (!rawData.startTime) {
      return {
        success: false,
        message: "Ora de intrare este obligatorie",
      }
    }

    // Formatare dată de început în formatul cerut: YYYY/MM/DD HH:mm:SS
    const startDateObj = new Date(`${rawData.startDate}T${rawData.startTime}:00`)
    const formattedStartDate = startDateObj
      .toISOString()
      .replace(/T/, " ")
      .replace(/-/g, "/")
      .replace(/\.\d+Z$/, "")

    // Creare payload XML pentru actualizare - folosim OperationType="N" cu BookingNumber existent
    const xmlPayload = `
      <WSRequestBookingSubmitV1>
        <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
        <OperationType>N</OperationType>
        <BookingNumber>${rawData.bookingNumber}</BookingNumber>
        ${rawData.licensePlate ? `<LicensePlate>${rawData.licensePlate}</LicensePlate>` : ""}
        <StartDate>${formattedStartDate}</StartDate>
        <Duration>${rawData.durationMinutes}</Duration>
        ${rawData.clientTitle ? `<ClientTitle>${rawData.clientTitle}</ClientTitle>` : ""}
        ${rawData.clientName ? `<ClientName>${rawData.clientName}</ClientName>` : ""}
        <AccessMode>0</AccessMode>
      </WSRequestBookingSubmitV1>
    `.trim()

    // Creare header Basic Auth
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    console.log("Test Update Booking - Request:", {
      url: API_CONFIG.url,
      auth: `${API_CONFIG.username}:***`,
      payload: xmlPayload,
    })

    // Setăm un timeout mai mare (30 secunde)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    // Apel API
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

    console.log("Test Update Booking - Response:", {
      status: response.status,
      statusText: response.statusText,
      body: responseText,
    })

    // Parsare răspuns XML
    const errorCodeMatch = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
    const messageMatch = responseText.match(/<Message>(.+?)<\/Message>/)

    const errorCode = errorCodeMatch ? errorCodeMatch[1] : null
    const message = messageMatch ? messageMatch[1] : "Răspuns necunoscut de la server"

    return {
      success: errorCode === "1",
      statusCode: response.status,
      errorCode,
      message,
      bookingNumber: rawData.bookingNumber,
      rawResponse: responseText,
      requestPayload: xmlPayload,
    }
  } catch (error) {
    console.error("Test Update Booking - Error:", error)

    // Extragem informații detaliate despre eroare
    let errorMessage = "Eroare la conectarea cu API-ul"
    let errorDetails = ""

    if (error instanceof Error) {
      errorMessage = error.message

      // Verificăm dacă eroarea are o cauză (de ex. timeout)
      if ("cause" in error && error.cause instanceof Error) {
        errorDetails = error.cause.message
      }
    }

    return {
      success: false,
      message: errorMessage,
      details: errorDetails,
      rawResponse: null,
      requestPayload: null,
    }
  }
}

/**
 * Funcție pentru testarea anulării unei rezervări
 */
export async function testCancelBooking(formData: FormData) {
  try {
    // Parsare și validare date formular
    const rawData = {
      bookingNumber: formData.get("bookingNumber") as string,
    }

    const validatedData = testCancelBookingSchema.parse(rawData)

    // Creare payload XML conform documentației
    const xmlPayload = `
      <WSRequestBookingSubmitV1>
        <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
        <OperationType>D</OperationType>
        <BookingNumber>${validatedData.bookingNumber}</BookingNumber>
      </WSRequestBookingSubmitV1>
    `.trim()

    // Creare header Basic Auth
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    console.log("Test Cancel Booking - Request:", {
      url: API_CONFIG.url,
      auth: `${API_CONFIG.username}:***`,
      payload: xmlPayload,
    })

    // Setăm un timeout mai mare (30 secunde)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    // Apel API
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

    console.log("Test Cancel Booking - Response:", {
      status: response.status,
      statusText: response.statusText,
      body: responseText,
    })

    // Parsare răspuns XML
    const errorCodeMatch = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
    const messageMatch = responseText.match(/<Message>(.+?)<\/Message>/)

    const errorCode = errorCodeMatch ? errorCodeMatch[1] : null
    const message = messageMatch ? messageMatch[1] : "Răspuns necunoscut de la server"

    return {
      success: errorCode === "1",
      statusCode: response.status,
      errorCode,
      message,
      rawResponse: responseText,
      requestPayload: xmlPayload,
    }
  } catch (error) {
    console.error("Test Cancel Booking - Error:", error)

    // Extragem informații detaliate despre eroare
    let errorMessage = "Eroare la conectarea cu API-ul"
    let errorDetails = ""

    if (error instanceof Error) {
      errorMessage = error.message

      // Verificăm dacă eroarea are o cauză (de ex. timeout)
      if ("cause" in error && error.cause instanceof Error) {
        errorDetails = error.cause.message
      }
    }

    return {
      success: false,
      message: errorMessage,
      details: errorDetails,
      rawResponse: null,
      requestPayload: null,
    }
  }
}
