import { NextRequest, NextResponse } from "next/server"
import { cleanupExpiredBookings } from "@/app/actions/booking-actions"

/**
 * API endpoint pentru cleanup-ul automat al rezervărilor expirate
 * Poate fi apelat de cron jobs (Vercel Cron, GitHub Actions, etc.)
 * 
 * GET /api/cron/cleanup-expired-bookings - Curăță rezervările expirate
 */
export async function GET(request: NextRequest) {
  try {
    // Verifică că request-ul vine de la un cron job autorizat
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" }, 
        { status: 401 }
      )
    }
    
    console.log("🧹 Cron job triggered: cleaning up expired bookings...")
    
    // Cleanup rezervări expirate
    const result = await cleanupExpiredBookings()
    
    const response = {
      success: true,
      message: "Expired bookings cleanup completed",
      timestamp: new Date().toISOString(),
      cleanedCount: result.cleanedCount,
      errors: result.errors
    }
    
    console.log("✅ Cleanup cron job completed:", response)
    
    return NextResponse.json(response)
    
  } catch (error) {
    console.error("❌ Cleanup cron job failed:", error)
    
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