import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Importăm funcția de generare HTML din email service
    const { generateBookingEmailHTML } = await import('@/lib/email-service')
    
    // Date test pentru rezervare pay-on-site
    const testBookingData = {
      clientName: 'Test Client',
      clientEmail: 'test@example.com',
      clientPhone: '0712345678',
      licensePlate: 'B123TST',
      startDate: '2024-01-15',
      startTime: '10:00',
      endDate: '2024-01-17',
      endTime: '10:00',
      days: 2,
      amount: 100,
      bookingNumber: '123456',
      status: 'confirmed_pay_on_site',
      source: 'pay_on_site' as const,
      createdAt: new Date()
    }
    
    // Generează HTML-ul email-ului
    const emailHTML = generateBookingEmailHTML(testBookingData)
    
    // Returnează HTML-ul pentru preview
    return new Response(emailHTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    })
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ Test email error:', errorMessage)
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 })
  }
} 