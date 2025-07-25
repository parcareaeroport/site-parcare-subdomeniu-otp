import Stripe from "stripe"
import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createBookingWithFirestore } from "@/app/actions/booking-actions" // Folosim versiunea extinsă


// Inițializăm clientul Stripe cu cheia secretă
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-05-28.basil", // Versiune actualizată
})

export async function POST(req: Request) {
  const body = await req.text()
  const headersList = await headers()
  const signature = headersList.get("Stripe-Signature") as string
  const webhookProcessId = `WEBHOOK_${Date.now()}`

  console.log(`🔗 [${webhookProcessId}] ===== STRIPE WEBHOOK RECEIVED =====`)
  console.log(`🔗 [${webhookProcessId}] Timestamp: ${new Date().toISOString()}`)
  console.log(`🔗 [${webhookProcessId}] Signature present: ${signature ? 'YES' : 'NO'}`)
  console.log(`🔗 [${webhookProcessId}] Body length: ${body.length} chars`)

  let event: Stripe.Event

  try {
    console.log(`🔐 [${webhookProcessId}] Verifying webhook signature...`)
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)
    console.log(`✅ [${webhookProcessId}] Webhook signature verified successfully`)
    console.log(`🔗 [${webhookProcessId}] Event type: ${event.type}`)
    console.log(`🔗 [${webhookProcessId}] Event ID: ${event.id}`)
  } catch (error: any) {
    console.error(`❌ [${webhookProcessId}] Webhook signature verification failed:`)
    console.error(`❌ [${webhookProcessId}] Error message: ${error.message}`)
    console.error(`❌ [${webhookProcessId}] Webhook secret present: ${process.env.STRIPE_WEBHOOK_SECRET ? 'YES' : 'NO'}`)
    console.error(`❌ [${webhookProcessId}] Error type: ${error.constructor.name}`)
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 })
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    
    console.log(`💳 [${webhookProcessId}] ===== PAYMENT SUCCEEDED =====`)
    console.log(`💳 [${webhookProcessId}] PaymentIntent ID: ${paymentIntent.id}`)
    console.log(`💳 [${webhookProcessId}] Amount: ${paymentIntent.amount / 100} RON`)
    console.log(`💳 [${webhookProcessId}] Currency: ${paymentIntent.currency}`)
    console.log(`💳 [${webhookProcessId}] Status: ${paymentIntent.status}`)
    console.log(`💳 [${webhookProcessId}] Payment method: ${paymentIntent.payment_method}`)
    console.log(`💳 [${webhookProcessId}] Customer email: ${paymentIntent.receipt_email || 'N/A'}`)

    // Extrage datele necesare pentru `createBooking` din metadata PaymentIntent-ului
    const bookingMetadata = paymentIntent.metadata
    
    console.log(`📋 [${webhookProcessId}] Checking booking metadata...`)
    console.log(`📋 [${webhookProcessId}] Metadata keys: ${Object.keys(bookingMetadata || {}).join(', ')}`)
    
    if (bookingMetadata) {
      console.log(`📋 [${webhookProcessId}] Booking metadata:`)
      console.log(`📋 [${webhookProcessId}]   License Plate: ${bookingMetadata.licensePlate || 'MISSING'}`)
      console.log(`📋 [${webhookProcessId}]   Start Date: ${bookingMetadata.startDate || 'MISSING'}`)
      console.log(`📋 [${webhookProcessId}]   End Date: ${bookingMetadata.endDate || 'MISSING'}`)
      console.log(`📋 [${webhookProcessId}]   Customer Name: ${bookingMetadata.customerName || 'MISSING'}`)
      console.log(`📋 [${webhookProcessId}]   Customer Email: ${bookingMetadata.customerEmail || 'MISSING'}`)
      console.log(`📋 [${webhookProcessId}]   Customer Phone: ${bookingMetadata.customerPhone || 'MISSING'}`)
      console.log(`📋 [${webhookProcessId}]   Company: ${bookingMetadata.company || 'N/A'}`)
      console.log(`📋 [${webhookProcessId}]   Need Invoice: ${bookingMetadata.needInvoice || 'N/A'}`)
    }

    if (
      !bookingMetadata ||
      !bookingMetadata.licensePlate ||
      !bookingMetadata.startDate ||
      !bookingMetadata.endDate
    ) {
      console.error(`❌ [${webhookProcessId}] ===== METADATA VALIDATION FAILED =====`)
      console.error(`❌ [${webhookProcessId}] Missing required booking data in PaymentIntent metadata`)
      console.error(`❌ [${webhookProcessId}] Required fields: licensePlate, startDate, endDate`)
      console.error(`❌ [${webhookProcessId}] Available metadata:`, bookingMetadata)
      console.error(`❌ [${webhookProcessId}] PaymentIntent ID: ${paymentIntent.id}`)
      
      return NextResponse.json({ 
        success: false, 
        error: "Lipsă metadata pentru rezervare",
        paymentIntentId: paymentIntent.id,
        webhookProcessId 
      }, { status: 200 })
    }

    console.log(`✅ [${webhookProcessId}] Metadata validation passed`)

    try {
      console.log(`🏗️ [${webhookProcessId}] ===== PREPARING BOOKING DATA =====`)
      
      // Pregătim FormData pentru API-ul de parcare
      const formData = new FormData()
      formData.append("licensePlate", bookingMetadata.licensePlate)
      
      // Extragem data și ora din startDate și endDate (format: YYYY-MM-DDTHH:mm:00)
      const startDateParts = bookingMetadata.startDate.split('T')
      const endDateParts = bookingMetadata.endDate.split('T')
      
      formData.append("startDate", startDateParts[0]) // YYYY-MM-DD
      formData.append("startTime", startDateParts[1]?.slice(0, 5) || "08:00") // HH:mm
      formData.append("endDate", endDateParts[0]) // YYYY-MM-DD  
      formData.append("endTime", endDateParts[1]?.slice(0, 5) || "08:00") // HH:mm

      if (bookingMetadata.customerName) {
        formData.append("clientName", bookingMetadata.customerName)
      }

      // Calculăm zilele și suma din metadata sau din diferența de date
      const startDate = new Date(bookingMetadata.startDate)
      const endDate = new Date(bookingMetadata.endDate)
      const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) || 1
      const amount = paymentIntent.amount / 100 // Stripe folosește cenți

      console.log(`🏗️ [${webhookProcessId}] Booking data prepared:`)
      console.log(`🏗️ [${webhookProcessId}]   License Plate: ${bookingMetadata.licensePlate}`)
      console.log(`🏗️ [${webhookProcessId}]   Start: ${startDateParts[0]} ${startDateParts[1]?.slice(0, 5)}`)
      console.log(`🏗️ [${webhookProcessId}]   End: ${endDateParts[0]} ${endDateParts[1]?.slice(0, 5)}`)
      console.log(`🏗️ [${webhookProcessId}]   Days: ${days}`)
      console.log(`🏗️ [${webhookProcessId}]   Amount: ${amount} RON`)
      console.log(`🏗️ [${webhookProcessId}]   Customer Email: ${bookingMetadata.customerEmail}`)
      console.log(`🏗️ [${webhookProcessId}]   Customer Phone: ${bookingMetadata.customerPhone || 'N/A'}`)

      console.log(`🚀 [${webhookProcessId}] Starting booking creation process...`)
      console.log(`🚀 [${webhookProcessId}] Calling createBookingWithFirestore...`)
      
      const bookingStartTime = Date.now()

      // Folosim noua funcție care salvează totul în Firestore
      const bookingResult = await createBookingWithFirestore(formData, {
        clientEmail: bookingMetadata.customerEmail,
        clientPhone: bookingMetadata.customerPhone || undefined,
        paymentIntentId: paymentIntent.id,
        paymentStatus: "paid",
        amount: amount,
        days: days,
        source: "webhook",
        // Date pentru facturare și adresă din metadata
        company: bookingMetadata.company || undefined,
        companyVAT: bookingMetadata.companyVAT || undefined,
        companyReg: bookingMetadata.companyReg || undefined,
        companyAddress: bookingMetadata.companyAddress || undefined,
        needInvoice: bookingMetadata.needInvoice ? bookingMetadata.needInvoice === 'true' : undefined,
        address: bookingMetadata.address || undefined,
        city: bookingMetadata.city || undefined,
        county: bookingMetadata.county || undefined,
        postalCode: bookingMetadata.postalCode || undefined,
        country: bookingMetadata.country || undefined,
        orderNotes: bookingMetadata.orderNotes || undefined,
        // Termeni și condiții
        termsAccepted: bookingMetadata.termsAccepted ? bookingMetadata.termsAccepted === 'true' : undefined
      })
      
      const bookingDuration = Date.now() - bookingStartTime
      console.log(`🚀 [${webhookProcessId}] Booking creation completed in ${bookingDuration}ms`)

      // Verificăm dacă au reușit ambele operațiuni
      const hasFirestoreSuccess = 'firestoreSuccess' in bookingResult ? bookingResult.firestoreSuccess : false
      const bookingNumber = 'bookingNumber' in bookingResult ? bookingResult.bookingNumber : null
      const firestoreId = 'firestoreId' in bookingResult ? bookingResult.firestoreId : null
      const firestoreError = 'firestoreError' in bookingResult ? bookingResult.firestoreError : null

      console.log(`📊 [${webhookProcessId}] Booking result analysis:`)
      console.log(`📊 [${webhookProcessId}]   API Success: ${bookingResult.success}`)
      console.log(`📊 [${webhookProcessId}]   API Message: ${bookingResult.message}`)
      console.log(`📊 [${webhookProcessId}]   Firestore Success: ${hasFirestoreSuccess}`)
      console.log(`📊 [${webhookProcessId}]   Booking Number: ${bookingNumber || 'N/A'}`)
      console.log(`📊 [${webhookProcessId}]   Firestore ID: ${firestoreId || 'N/A'}`)
      console.log(`📊 [${webhookProcessId}]   Firestore Error: ${firestoreError || 'N/A'}`)

      if (bookingResult.success && hasFirestoreSuccess) {
        console.log(`✅ [${webhookProcessId}] ===== BOOKING CREATED SUCCESSFULLY =====`)
        console.log(`✅ [${webhookProcessId}] API Booking Number: ${bookingNumber}`)
        console.log(`✅ [${webhookProcessId}] Firestore Document ID: ${firestoreId}`)
        console.log(`✅ [${webhookProcessId}] PaymentIntent ID: ${paymentIntent.id}`)
        console.log(`✅ [${webhookProcessId}] Customer Email: ${bookingMetadata.customerEmail}`)
        console.log(`✅ [${webhookProcessId}] Amount Paid: ${amount} RON`)
        console.log(`✅ [${webhookProcessId}] Success Timestamp: ${new Date().toISOString()}`)
        console.log(`✅ [${webhookProcessId}] NOTE: Email will be sent in background process`)

        return NextResponse.json({ 
          success: true, 
          bookingNumber: bookingNumber,
          firestoreId: firestoreId,
          webhookProcessId,
          message: "Booking created successfully"
        }, { status: 200 })
        
      } else {
        console.error(`❌ [${webhookProcessId}] ===== BOOKING CREATION FAILED =====`)
        console.error(`❌ [${webhookProcessId}] API Success: ${bookingResult.success}`)
        console.error(`❌ [${webhookProcessId}] API Message: ${bookingResult.message}`)
        console.error(`❌ [${webhookProcessId}] Firestore Success: ${hasFirestoreSuccess}`)
        console.error(`❌ [${webhookProcessId}] Firestore Error: ${firestoreError || 'Unknown'}`)
        console.error(`❌ [${webhookProcessId}] PaymentIntent: ${paymentIntent.id}`)
        console.error(`❌ [${webhookProcessId}] Customer Email: ${bookingMetadata.customerEmail}`)
        console.error(`❌ [${webhookProcessId}] Failed Timestamp: ${new Date().toISOString()}`)
        
        return NextResponse.json({ 
          success: false, 
          error: `API: ${bookingResult.message}, Firestore: ${firestoreError || 'OK'}`,
          webhookProcessId,
          paymentIntentId: paymentIntent.id
        }, { status: 200 })
      }
      
    } catch (error: any) {
      console.error(`❌ [${webhookProcessId}] ===== WEBHOOK PROCESSING ERROR =====`)
      console.error(`❌ [${webhookProcessId}] Error Type: ${error.constructor.name}`)
      console.error(`❌ [${webhookProcessId}] Error Message: ${error.message}`)
      console.error(`❌ [${webhookProcessId}] Error Stack:`, error.stack)
      console.error(`❌ [${webhookProcessId}] PaymentIntent ID: ${paymentIntent.id}`)
      console.error(`❌ [${webhookProcessId}] Customer Email: ${bookingMetadata?.customerEmail || 'N/A'}`)
      console.error(`❌ [${webhookProcessId}] License Plate: ${bookingMetadata?.licensePlate || 'N/A'}`)
      console.error(`❌ [${webhookProcessId}] Error Timestamp: ${new Date().toISOString()}`)
      
      return NextResponse.json({ 
        success: false, 
        error: error.message,
        webhookProcessId,
        paymentIntentId: paymentIntent.id
      }, { status: 200 })
    }
  }
  
  // Alte tipuri de evenimente Stripe
  else if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object as Stripe.PaymentIntent
    
    console.log(`💳❌ [${webhookProcessId}] ===== PAYMENT FAILED =====`)
    console.log(`💳❌ [${webhookProcessId}] PaymentIntent ID: ${paymentIntent.id}`)
    console.log(`💳❌ [${webhookProcessId}] Error Message: ${paymentIntent.last_payment_error?.message || 'Unknown error'}`)
    console.log(`💳❌ [${webhookProcessId}] Error Code: ${paymentIntent.last_payment_error?.code || 'N/A'}`)
    console.log(`💳❌ [${webhookProcessId}] Error Type: ${paymentIntent.last_payment_error?.type || 'N/A'}`)
    console.log(`💳❌ [${webhookProcessId}] Customer Email: ${paymentIntent.receipt_email || 'N/A'}`)
    console.log(`💳❌ [${webhookProcessId}] Amount: ${paymentIntent.amount / 100} RON`)
    console.log(`💳❌ [${webhookProcessId}] Failed Timestamp: ${new Date().toISOString()}`)
    
    // Gestionează eșecul plății (ex: notifică utilizatorul, anulează comanda etc.)
  } else {
    console.log(`🔗 [${webhookProcessId}] Unhandled event type: ${event.type}`)
    console.log(`🔗 [${webhookProcessId}] Event ID: ${event.id}`)
    console.log(`🔗 [${webhookProcessId}] Timestamp: ${new Date().toISOString()}`)
  }

  console.log(`🔗 [${webhookProcessId}] ===== WEBHOOK PROCESSING COMPLETED =====`)
  console.log(`🔗 [${webhookProcessId}] Response: received=true`)
  console.log(`🔗 [${webhookProcessId}] End Timestamp: ${new Date().toISOString()}`)

  return NextResponse.json({ received: true, webhookProcessId })
}
