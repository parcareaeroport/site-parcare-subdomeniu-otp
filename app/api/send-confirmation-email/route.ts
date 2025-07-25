import { NextRequest, NextResponse } from 'next/server'
import { sendBookingConfirmationEmail } from '@/lib/email-service'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { bookingData, firestoreId } = body
    
    const emailProcessId = `API_EMAIL_${bookingData.bookingNumber}_${Date.now()}`
    
    console.log(`📧 [${emailProcessId}] ===== EMAIL API ENDPOINT CALLED =====`)
    console.log(`📧 [${emailProcessId}] Booking Number: ${bookingData.bookingNumber}`)
    console.log(`📧 [${emailProcessId}] Client Email: ${bookingData.clientEmail}`)
    console.log(`📧 [${emailProcessId}] Source: ${bookingData.source}`)
    console.log(`📧 [${emailProcessId}] Firestore ID: ${firestoreId}`)
    
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
    
    console.log(`📧 [${emailProcessId}] Calling sendBookingConfirmationEmail...`)
    
    // Trimite email-ul
    const emailResult = await sendBookingConfirmationEmail(emailData)
    
    console.log(`📧 [${emailProcessId}] Email result: ${emailResult.success ? 'SUCCESS' : 'FAILED'}`)
    
    if (emailResult.success) {
      // Actualizează statusul în Firestore
      if (firestoreId) {
        try {
          await updateDoc(doc(db, "bookings", firestoreId), {
            emailSentAt: serverTimestamp(),
            emailStatus: "sent",
            emailSentViaAPI: true,
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
        message: 'Email sent successfully' 
      })
    } else {
      // Actualizează statusul de eșec în Firestore
      if (firestoreId) {
        try {
          await updateDoc(doc(db, "bookings", firestoreId), {
            emailStatus: "failed",
            emailError: emailResult.error,
            emailFailedAt: serverTimestamp(),
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
        error: emailResult.error 
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