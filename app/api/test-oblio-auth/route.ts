import { NextRequest, NextResponse } from 'next/server'
import { oblioService } from '@/lib/oblio-integration'

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 [TEST-OBLIO] ===== STARTING AUTHENTICATION TEST =====')
    console.log('🧪 [TEST-OBLIO] Timestamp:', new Date().toISOString())
    
    // Verifică variabilele de mediu
    const envCheck = {
      OBLIO_EMAIL: !!process.env.OBLIO_EMAIL,
      OBLIO_SECRET: !!process.env.OBLIO_SECRET,
      OBLIO_CIF: !!process.env.OBLIO_CIF,
      OBLIO_SERIES: !!process.env.OBLIO_SERIES,
    }
    
    console.log('🧪 [TEST-OBLIO] Environment variables check:', envCheck)
    
    // Verifică dacă toate variabilele sunt setate
    const missingVars = Object.entries(envCheck)
      .filter(([key, value]) => !value)
      .map(([key]) => key)
    
    if (missingVars.length > 0) {
      console.error('❌ [TEST-OBLIO] Missing environment variables:', missingVars)
      return NextResponse.json({
        success: false,
        error: 'Missing environment variables',
        missingVars,
        envCheck
      }, { status: 500 })
    }
    
    console.log('✅ [TEST-OBLIO] All environment variables are set')
    
    // Testează autentificarea
    console.log('🔐 [TEST-OBLIO] Testing Oblio authentication...')
    
    // Apelează direct metoda de autentificare (trebuie să o facem publică temporar)
    // Sau testăm prin generarea unei facturi dummy
    
    const testInvoiceData = {
      bookingId: 'TEST_' + Date.now(),
      clientName: 'Test Client',
      clientEmail: 'test@example.com',
      clientPhone: '0123456789',
      licensePlate: 'B123TST',
      startDate: '2024-01-01',
      endDate: '2024-01-02',
      location: 'Test Location',
      parkingSpot: 'TEST_001',
      totalCost: 1, // 1 RON pentru test
      billingType: 'individual' as const,
      clientAddress: 'Test Address',
      clientCity: 'Test City',
      clientCounty: 'Test County',
      clientCountry: 'Romania',
    }
    
    console.log('🧾 [TEST-OBLIO] Attempting to generate test invoice...')
    
    const result = await oblioService.generateInvoice(testInvoiceData)
    
    console.log('🧪 [TEST-OBLIO] Test result:', result)
    
    if (result.success) {
      console.log('✅ [TEST-OBLIO] Authentication and invoice generation successful!')
      return NextResponse.json({
        success: true,
        message: 'Oblio authentication successful',
        invoiceNumber: result.invoiceNumber,
        invoiceUrl: result.invoiceUrl,
        testData: testInvoiceData,
        envCheck,
        timestamp: new Date().toISOString()
      })
    } else {
      console.error('❌ [TEST-OBLIO] Authentication or invoice generation failed:', result.error)
      return NextResponse.json({
        success: false,
        error: result.error,
        testData: testInvoiceData,
        envCheck,
        timestamp: new Date().toISOString()
      }, { status: 400 })
    }
    
  } catch (error) {
    console.error('❌ [TEST-OBLIO] Critical error during test:', error)
    
    const errorDetails = {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'UnknownError'
    }
    
    return NextResponse.json({
      success: false,
      error: 'Critical error during authentication test',
      errorDetails,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
} 