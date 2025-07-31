import { NextRequest, NextResponse } from "next/server"
import { runQueueProcessor, cleanupOldQueueItems } from "@/lib/queue-system"

/**
 * API endpoint pentru procesarea queue-ului de email-uri
 * Poate fi apelat de cron jobs (Vercel Cron, GitHub Actions, etc.)
 * 
 * GET /api/cron/process-queue - Procesează queue-ul
 * GET /api/cron/process-queue?cleanup=true - Procesează + cleanup
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const shouldCleanup = searchParams.get('cleanup') === 'true'
    
    // Verifică că request-ul vine de la un cron job autorizat
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" }, 
        { status: 401 }
      )
    }
    
    console.log("🔄 Cron job triggered: processing queue...")
    
    // Procesează queue-ul
    await runQueueProcessor()
    
    let cleanupResult = 0
    if (shouldCleanup) {
      console.log("🧹 Running cleanup...")
      cleanupResult = await cleanupOldQueueItems(7) // Șterge items mai vechi de 7 zile
    }
    
    const response = {
      success: true,
      message: "Queue processed successfully",
      timestamp: new Date().toISOString(),
      cleanedItems: shouldCleanup ? cleanupResult : 0
    }
    
    console.log("✅ Cron job completed:", response)
    
    return NextResponse.json(response)
    
  } catch (error) {
    console.error("❌ Cron job failed:", error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString()
      }, 
      { status: 500 }
    )
  }
}

/**
 * Endpoint pentru verificarea statusului queue-ului
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    if (body.action === "status") {
      // Aici poți adăuga logică pentru a returna statusul queue-ului
      return NextResponse.json({
        message: "Queue status endpoint - not implemented yet",
        timestamp: new Date().toISOString()
      })
    }
    
    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    )
    
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    )
  }
} 