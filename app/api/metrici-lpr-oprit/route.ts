import { withLprRequest, lprLog, lprFields, lprError } from "@/lib/lpr-log.server"
import { NextRequest, NextResponse } from "next/server"

async function POSTHandler(request: NextRequest) {
  // Verifică dacă LPR este activat
  if (process.env.LPR_ENABLED === 'false') {
    lprFields({reason:'disabled',outcome:'disabled'})

    return new Response("LPR disabled", { status: 503 })
  }

  const startTime = Date.now()
  const requestId = `LPR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const debugMode = process.env.LPR_DEBUG_MODE === 'true'
  const autoOpenBarrier = process.env.LPR_AUTO_OPEN_BARRIER !== 'false'

  try {
    // Verifică autentificare (opțional)
    if (process.env.LPR_AUTH_SECRET) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${process.env.LPR_AUTH_SECRET}`) {
      lprFields({reason:"unauthorized",outcome:"skipped"}); lprLog("auth_rejected",{reason:"unauthorized"},"warn")

        return new Response("Unauthorized", { status: 401 })
      }

    }

    // Parse multipart/form-data
    const formData = await request.formData()

    // Extract all text fields - TOATE sunt OPȚIONALE
    const lprData: any = {}
    let imageCount = 0

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        imageCount++
      } else {
        // It's a text field
        lprData[key] = value.toString()

      }
    }

    // Verifică datele MINIME necesare
    lprFields({plate:lprData.number?.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),receivedDirection:lprData.direction,deviceId:lprData.id,outcome:"receipt_only"})
    const hasLicensePlate = lprData.number && lprData.number.length > 0

    // Determine response based on Metrici documentation and environment
    let responseText = "bb1e8f805814a0b8e46560134687237" // Default reporting response
    const defaultAction = process.env.LPR_DEFAULT_ACTION || 'allow'

    // LOGICA MINIMĂ: Doar dacă avem numărul de înmatriculare și e intrare
    if (hasLicensePlate && (lprData.direction === "1" || lprData.direction === 1)) {
      if (defaultAction === 'allow' && autoOpenBarrier) {
        responseText = "fbd782b5b1f90875a9773ef20bcc16aa open_barrier"

      } else if (defaultAction === 'allow') {
        responseText = "fbd782b5b1f90875a9773ef20bcc16aa"
      }
    }

    lprLog("metrici_response",{outcome:"receipt_only",imageCount,textFieldCount:Object.keys(lprData).length,barrierCommand:responseText.endsWith(" open_barrier"),responseRequestId:requestId})
    const processingTime = Date.now() - startTime

    return new Response(responseText, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Request-ID': requestId,
        'X-Processing-Time': processingTime.toString(),
        'X-LPR-Mode': debugMode ? 'debug' : 'production',
        'X-Data-Fields': Object.keys(lprData).length.toString(),
        'X-Images-Count': imageCount.toString()
      }
    })

  } catch (error) {
    lprError("metrici_failed",error); lprFields({reason:"processing_failed",outcome:"error"})

    // Return success anyway to avoid breaking Metrici
    return new Response("bb1e8f805814a0b8e46560134687237", {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}
export const POST = withLprRequest(POSTHandler)
