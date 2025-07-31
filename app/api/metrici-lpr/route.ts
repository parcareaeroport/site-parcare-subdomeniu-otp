import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  // Verifică dacă LPR este activat
  if (process.env.LPR_ENABLED === 'false') {
    console.log('🚫 LPR is disabled via environment variable')
    return new Response("LPR disabled", { status: 503 })
  }

  const startTime = Date.now()
  const requestId = `LPR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const debugMode = process.env.LPR_DEBUG_MODE === 'true'
  const autoOpenBarrier = process.env.LPR_AUTO_OPEN_BARRIER !== 'false'
  
  console.log(`🚗 [${requestId}] ===== METRICI LPR REQUEST RECEIVED =====`)
  console.log(`🚗 [${requestId}] Timestamp: ${new Date().toISOString()}`)
  
  if (debugMode) {
    console.log(`🐛 [${requestId}] Debug mode enabled`)
    console.log(`🐛 [${requestId}] Headers:`, Object.fromEntries(request.headers.entries()))
  }

  try {
    // Verifică autentificare (opțional)
    if (process.env.LPR_AUTH_SECRET) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${process.env.LPR_AUTH_SECRET}`) {
        console.log(`🔒 [${requestId}] Invalid LPR authentication`)
        return new Response("Unauthorized", { status: 401 })
      }
      console.log(`🔐 [${requestId}] Authentication successful`)
    }

    // Parse multipart/form-data
    const formData = await request.formData()
    
    console.log(`📋 [${requestId}] Form Data Keys:`, Array.from(formData.keys()))

    // Extract all text fields
    const lprData: any = {}
    const imageInfo: any = {}

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        // It's a file (image) - just log info, don't save
        console.log(`🖼️ [${requestId}] Image: ${key} - ${value.name} (${value.size} bytes, ${value.type})`)
        imageInfo[key] = {
          name: value.name,
          size: value.size,
          type: value.type
        }
      } else {
        // It's a text field
        lprData[key] = value.toString()
        console.log(`📝 [${requestId}] ${key}: ${value}`)
      }
    }

    // Log complete data structure în debug mode
    if (debugMode) {
      console.log(`📊 [${requestId}] Complete LPR Text Data:`, JSON.stringify(lprData, null, 2))
      console.log(`📊 [${requestId}] Image Info:`, JSON.stringify(imageInfo, null, 2))
    }

    // Parse specific Metrici fields if present
    if (lprData.number) {
      console.log(`🔍 [${requestId}] ===== PARSED METRICI DATA =====`)
      console.log(`🔍 [${requestId}] License Plate: ${lprData.number}`)
      console.log(`🔍 [${requestId}] Country Code: ${lprData.country_code || 'N/A'}`)
      console.log(`🔍 [${requestId}] Direction: ${lprData.direction || 'N/A'} (1=incoming, 2=leaving, 3=unknown)`)
      console.log(`🔍 [${requestId}] Probability: ${lprData.probability || 'N/A'}`)
      console.log(`🔍 [${requestId}] First Seen: ${lprData.first_seen || 'N/A'}`)
      console.log(`🔍 [${requestId}] Last Seen: ${lprData.last_seen || 'N/A'}`)
      console.log(`🔍 [${requestId}] Camera ID: ${lprData.id || 'N/A'}`)
      console.log(`🔍 [${requestId}] Vehicle Class: ${lprData.vehicle_class || 'N/A'}`)
      console.log(`🔍 [${requestId}] Vehicle Color: ${lprData.vehicle_color || 'N/A'}`)
      console.log(`🔍 [${requestId}] Vehicle Maker: ${lprData.vehicle_maker || 'N/A'}`)
      console.log(`🔍 [${requestId}] Transaction Key: ${lprData.transactionkey || 'N/A'}`)
      console.log(`🔍 [${requestId}] Auth Hash: ${lprData.auth || 'N/A'}`)
    }

    // Determine response based on Metrici documentation and environment
    let responseText = "bb1e8f805814a0b8e46560134687237" // Default reporting response
    const defaultAction = process.env.LPR_DEFAULT_ACTION || 'allow'
    
    // If this is a check action (when Metrici asks for permission)
    if (lprData.number && (lprData.direction === "1" || lprData.direction === 1)) {
      if (defaultAction === 'allow' && autoOpenBarrier) {
        responseText = "fbd782b5b1f90875a9773ef20bcc16aa open_barrier"
        console.log(`🚪 [${requestId}] RESPONSE: Allowing access and opening barrier (auto-open: ${autoOpenBarrier})`)
      } else if (defaultAction === 'allow') {
        responseText = "fbd782b5b1f90875a9773ef20bcc16aa"
        console.log(`🚪 [${requestId}] RESPONSE: Allowing access (no auto-open)`)
      } else {
        console.log(`🛑 [${requestId}] RESPONSE: Default action is '${defaultAction}' - standard acknowledgment`)
      }
    } else {
      console.log(`📊 [${requestId}] RESPONSE: Standard reporting acknowledgment`)
    }

    const processingTime = Date.now() - startTime
    console.log(`✅ [${requestId}] Processing completed in ${processingTime}ms`)
    console.log(`✅ [${requestId}] Response: ${responseText}`)
    console.log(`🚗 [${requestId}] ===== END METRICI LPR REQUEST =====\n`)

    return new Response(responseText, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'X-Request-ID': requestId,
        'X-Processing-Time': processingTime.toString(),
        'X-LPR-Mode': debugMode ? 'debug' : 'production'
      }
    })

  } catch (error) {
    console.error(`❌ [${requestId}] ERROR processing LPR request:`, error)
    
    // Return success anyway to avoid breaking Metrici
    return new Response("bb1e8f805814a0b8e46560134687237", {
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
} 