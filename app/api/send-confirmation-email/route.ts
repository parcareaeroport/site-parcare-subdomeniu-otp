import { NextRequest, NextResponse } from 'next/server'
import { sendBookingConfirmationEmail } from '@/lib/email-service'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { bookingData, firestoreId } = body
    
    const incomingReqId =
      request.headers.get("x-email-request-id") ||
      request.headers.get("x-request-id") ||
      undefined
    const bookingRef = bookingData.bookingNumber || `pay_on_site_${bookingData.licensePlate || "unknown"}`
    const emailProcessId = `API_EMAIL_${bookingRef}_${Date.now()}`
    
    console.log(`📧 [${emailProcessId}] ===== EMAIL API ENDPOINT CALLED =====`)
    if (incomingReqId) {
      console.log(`📧 [${emailProcessId}] Correlation request id: ${incomingReqId}`)
    }
    console.log(`📧 [${emailProcessId}] Booking Number: ${bookingData.bookingNumber}`)
    console.log(`📧 [${emailProcessId}] Client Email: ${bookingData.clientEmail}`)
    console.log(`📧 [${emailProcessId}] Source: ${bookingData.source}`)
    console.log(`📧 [${emailProcessId}] Firestore ID: ${firestoreId}`)
    const willIncludeQr = bookingData.source !== "pay_on_site" && !!bookingData.bookingNumber
    console.log(`📧 [${emailProcessId}] Will include QR: ${willIncludeQr}`)
    if (!willIncludeQr && bookingData.source !== "pay_on_site") {
      console.warn(`⚠️ [${emailProcessId}] No bookingNumber provided for non-pay_on_site source. This will fail validation.`)
    }
    
    // Validează că avem toate datele necesare
    // Pentru pay-on-site nu avem bookingNumber, dar tot trimitem email
    if (!bookingData.clientEmail || (!bookingData.bookingNumber && bookingData.source !== "pay_on_site")) {
      console.error(`❌ [${emailProcessId}] Missing required data`)
      return NextResponse.json({ 
        success: false, 
        error: 'Missing email or booking number' 
      }, { status: 400 })
    }
    
    // Pregătește datele pentru email
    const emailData = {
      clientName: bookingData.clientName || 'Client',
      clientEmail: bookingData.clientEmail,
      clientPhone: bookingData.clientPhone,
      licensePlate: bookingData.licensePlate,
      startDate: bookingData.startDate,
      startTime: bookingData.startTime,
      endDate: bookingData.endDate,
      endTime: bookingData.endTime,
      days: bookingData.days || 1,
      amount: bookingData.amount || 0,
      bookingNumber: bookingData.bookingNumber,
      status: bookingData.status,
      source: bookingData.source,
      createdAt: new Date()
    }
    
    console.log(`📧 [${emailProcessId}] Calling sendBookingConfirmationEmail... (QR: ${willIncludeQr ? "YES" : "NO"})`)
    
    // Trimite email-ul
    const emailResult = await sendBookingConfirmationEmail(emailData)
    
    console.log(`📧 [${emailProcessId}] Email result: ${emailResult.success ? 'SUCCESS' : 'FAILED'}`)
    console.log(`📧 [${emailProcessId}] Email meta: messageId=${(emailResult as any)?.messageId || 'N/A'}, qrIncluded=${(emailResult as any)?.qrIncluded ?? 'N/A'}, qrBytes=${(emailResult as any)?.qrBytes ?? 'N/A'}`)
    
    if (emailResult.success) {
      // Actualizează statusul în Firestore
      if (firestoreId) {
        try {
          await updateDoc(doc(db, "bookings", firestoreId), {
            emailSentAt: serverTimestamp(),
            emailStatus: "sent",
            emailSentViaAPI: true,
            emailMessageId: (emailResult as any)?.messageId || null,
            emailQrIncluded: (emailResult as any)?.qrIncluded ?? null,
            emailQrBytes: (emailResult as any)?.qrBytes ?? null,
            emailTransportResponse: (emailResult as any)?.response || null,
            lastUpdated: serverTimestamp()
          })
          console.log(`📊 [${emailProcessId}] Firestore updated successfully`)
        } catch (error) {
          console.error(`⚠️ [${emailProcessId}] Failed to update Firestore:`, error)
        }
      }
      
      console.log(`✅ [${emailProcessId}] Email sent successfully`)
      return NextResponse.json({ 
        success: true, 
        message: 'Email sent successfully',
        correlationId: incomingReqId || null,
        emailMessageId: (emailResult as any)?.messageId || null,
        qrIncluded: (emailResult as any)?.qrIncluded ?? null,
        qrBytes: (emailResult as any)?.qrBytes ?? null,
      })
    } else {
      // Actualizează statusul de eșec în Firestore
      if (firestoreId) {
        try {
          await updateDoc(doc(db, "bookings", firestoreId), {
            emailStatus: "failed",
            emailError: emailResult.error,
            emailFailedAt: serverTimestamp(),
            emailMessageId: (emailResult as any)?.messageId || null,
            emailQrIncluded: (emailResult as any)?.qrIncluded ?? null,
            emailQrBytes: (emailResult as any)?.qrBytes ?? null,
            emailTransportResponse: (emailResult as any)?.response || null,
            lastUpdated: serverTimestamp()
          })
          console.log(`📊 [${emailProcessId}] Firestore updated with failure`)
        } catch (error) {
          console.error(`⚠️ [${emailProcessId}] Failed to update Firestore:`, error)
        }
      }
      
      console.error(`❌ [${emailProcessId}] Email failed: ${emailResult.error}`)
      return NextResponse.json({ 
        success: false, 
        error: emailResult.error,
        correlationId: incomingReqId || null,
        emailMessageId: (emailResult as any)?.messageId || null,
        qrIncluded: (emailResult as any)?.qrIncluded ?? null,
        qrBytes: (emailResult as any)?.qrBytes ?? null,
      }, { status: 500 })
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`❌ Email API error:`, errorMessage)
    return NextResponse.json({ 
      success: false, 
      error: errorMessage 
    }, { status: 500 })
  }
} 