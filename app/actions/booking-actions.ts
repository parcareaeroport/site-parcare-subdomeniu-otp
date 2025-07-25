"use server"

import { z } from "zod"
// Adăugăm Firestore pentru salvarea completă a datelor
import { collection, addDoc, serverTimestamp, doc, updateDoc, increment, getDoc, setDoc, query, where, getDocs } from "firebase/firestore"
import { db } from "@/lib/firebase"
// Importăm serviciile pentru QR și email
import { generateMultiparkQR } from "@/lib/qr-generator"
import { sendBookingConfirmationEmail } from "@/lib/email-service"
import { normalizeLicensePlate } from "@/lib/utils"

// Define validation schema for the form data
const bookingFormSchema = z.object({
  licensePlate: z.string().min(1, "Numărul de înmatriculare este obligatoriu"),
  startDate: z.string().min(1, "Data de intrare este obligatorie"),
  startTime: z.string().min(1, "Ora de intrare este obligatorie"),
  endDate: z.string().min(1, "Data de ieșire este obligatorie"),
  endTime: z.string().min(1, "Ora de ieșire este obligatorie"),
  clientName: z.string().nullable().optional(),
  clientTitle: z.string().nullable().optional(),
})

type BookingFormData = z.infer<typeof bookingFormSchema>

// Configuration for the API
const API_CONFIG = {
  url: process.env.PARKING_API_URL || "http://localhost:7001/MultiparkWeb_eServices/booking_submit",
  username: process.env.PARKING_API_USERNAME || "",
  password: process.env.PARKING_API_PASSWORD || "",
  multiparkId: process.env.PARKING_MULTIPARK_ID || "001#002", // Default value, should be configured in env
}

// Interfață pentru datele complete de rezervare
interface CompleteBookingData {
  // Date de bază
  licensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  clientName?: string
  clientEmail?: string
  clientPhone?: string
  numberOfPersons?: number
  clientTitle?: string
  
  // Date calculate
  durationMinutes: number
  multiparkDurationMinutes?: number // Minutele rotunjite trimise la Multipark API
  days?: number
  amount?: number
  
  // Date pentru facturare (persoană juridică)
  company?: string
  companyVAT?: string // CUI/CIF
  companyReg?: string // Număr Registrul Comerțului
  companyAddress?: string
  needInvoice?: boolean
  orderNotes?: string
  
  // Date adresă personală
  address?: string
  city?: string
  county?: string
  postalCode?: string
  country?: string
  
  // Date plată
  paymentIntentId?: string
  paymentStatus: "paid" | "n/a" | "pending" | "refunded"
  
  // Termeni și condiții
  termsAccepted?: boolean
  termsAcceptedAt?: any // serverTimestamp
  
  // Date API
  apiBookingNumber?: string
  apiSuccess: boolean
  apiErrorCode?: string
  apiMessage: string
  apiRequestPayload: string
  apiResponseRaw: string
  apiRequestTimestamp: any // serverTimestamp
  
  // Status intern
  status: "confirmed_paid" | "confirmed_test" | "api_error" | "cancelled_by_admin" | "cancelled_by_api" | "confirmed_pay_on_site"
  source: "webhook" | "test_mode" | "manual" | "pay_on_site"
  
  // Metadata
  createdAt: any // serverTimestamp
  lastUpdated?: any
}

/**
 * Procesează generarea QR code-ului și trimiterea email-ului în background
 * Funcția rulează asincron fără să blocheze confirmarea rezervării
 */
async function processQRAndEmailAsync(
  bookingData: CompleteBookingData, 
  initialDebugLogs: string[]
): Promise<void> {
  const backgroundLogs: string[] = [...initialDebugLogs]
  const processId = `BGEMAIL_${bookingData.apiBookingNumber}_${Date.now()}`
  
  try {
    console.log(`🔄 [${processId}] ===== BACKGROUND EMAIL PROCESSING STARTED =====`)
    console.log(`🔄 [${processId}] Booking Number: ${bookingData.apiBookingNumber}`)
    console.log(`🔄 [${processId}] Client Email: ${bookingData.clientEmail}`)
    console.log(`🔄 [${processId}] License Plate: ${bookingData.licensePlate}`)
    console.log(`🔄 [${processId}] Source: ${bookingData.source}`)
    console.log(`🔄 [${processId}] Status: ${bookingData.status}`)
    console.log(`🔄 [${processId}] Payment Status: ${bookingData.paymentStatus}`)
    console.log(`🔄 [${processId}] Amount: ${bookingData.amount} RON`)
    console.log(`🔄 [${processId}] Start Time: ${new Date().toISOString()}`)
    
    // Generează QR code-ul pentru Multipark
    backgroundLogs.push(`🔲 Generating QR code: MPK_RES=${bookingData.apiBookingNumber?.padStart(6, '0')}`)
    console.log(`🔲 [${processId}] Generating QR code: MPK_RES=${bookingData.apiBookingNumber?.padStart(6, '0')}`)
    
    const qrStartTime = Date.now()
    const qrCodeDataUrl = await generateMultiparkQR(bookingData.apiBookingNumber!)
    const qrDuration = Date.now() - qrStartTime
    
    backgroundLogs.push(`✅ QR code generated successfully`)
    console.log(`✅ [${processId}] QR code generated successfully in ${qrDuration}ms`)
    console.log(`✅ [${processId}] QR Data URL length: ${qrCodeDataUrl.length} chars`)
    
    // Pregătește datele pentru email
    const emailData = {
      clientName: bookingData.clientName || 'Client',
      clientEmail: bookingData.clientEmail!,
      clientPhone: bookingData.clientPhone,
      licensePlate: bookingData.licensePlate,
      startDate: bookingData.startDate,
      startTime: bookingData.startTime,
      endDate: bookingData.endDate,
      endTime: bookingData.endTime,
      days: bookingData.days || 1,
      amount: bookingData.amount || 0,
      bookingNumber: bookingData.apiBookingNumber!,
      status: bookingData.status,
      source: bookingData.source,
      createdAt: new Date()
    }
    
    backgroundLogs.push(`📧 Email data prepared for ${emailData.clientEmail}`)
    console.log(`📧 [${processId}] Email data prepared:`)
    console.log(`📧 [${processId}]   Client: ${emailData.clientName}`)
    console.log(`📧 [${processId}]   Email: ${emailData.clientEmail}`)
    console.log(`📧 [${processId}]   Phone: ${emailData.clientPhone || 'N/A'}`)
    console.log(`📧 [${processId}]   Booking: ${emailData.bookingNumber}`)
    console.log(`📧 [${processId}]   Amount: ${emailData.amount} RON`)
    console.log(`📧 [${processId}]   Days: ${emailData.days}`)
    console.log(`📧 [${processId}]   Source: ${emailData.source}`)
    console.log(`📧 [${processId}]   Status: ${emailData.status}`)
    
    // Trimite email-ul de confirmare
    backgroundLogs.push(`📧 Sending confirmation email to ${bookingData.clientEmail}`)
    console.log(`📧 [${processId}] Starting email send process...`)
    console.log(`📧 [${processId}] Target email: ${bookingData.clientEmail}`)
    console.log(`📧 [${processId}] Email send timestamp: ${new Date().toISOString()}`)
    
    const emailStartTime = Date.now()
    const emailResult = await sendBookingConfirmationEmail(emailData)
    const emailDuration = Date.now() - emailStartTime
    
    console.log(`📧 [${processId}] Email send attempt completed in ${emailDuration}ms`)
    console.log(`📧 [${processId}] Email result success: ${emailResult.success}`)
    
    if (emailResult.success) {
      backgroundLogs.push(`✅ Confirmation email sent successfully`)
      console.log(`✅ [${processId}] ===== EMAIL SENT SUCCESSFULLY =====`)
      console.log(`✅ [${processId}] Email delivered to: ${bookingData.clientEmail}`)
      console.log(`✅ [${processId}] Booking number: ${bookingData.apiBookingNumber}`)
      console.log(`✅ [${processId}] Total duration: ${emailDuration}ms`)
      console.log(`✅ [${processId}] Success timestamp: ${new Date().toISOString()}`)
      
      // Opțional: Actualizează statusul în Firestore pentru tracking
      try {
        console.log(`📊 [${processId}] Updating Firestore with email success status...`)
        
        // Găsește documentul rezervării și actualizează statusul email-ului
        const bookingsRef = collection(db, "bookings")
        const q = query(bookingsRef, 
          where("apiBookingNumber", "==", bookingData.apiBookingNumber),
          where("source", "==", bookingData.source)
        )
        const querySnapshot = await getDocs(q)
        
        if (!querySnapshot.empty) {
          const bookingDoc = querySnapshot.docs[0]
          await updateDoc(doc(db, "bookings", bookingDoc.id), {
            emailSentAt: serverTimestamp(),
            emailStatus: "sent",
            qrCodeGenerated: true,
            emailSendDuration: emailDuration,
            lastUpdated: serverTimestamp()
          })
          console.log(`📊 [${processId}] Firestore updated successfully with email status`)
          console.log(`📊 [${processId}] Document ID: ${bookingDoc.id}`)
        } else {
          console.warn(`⚠️ [${processId}] Booking document not found in Firestore for update`)
          console.warn(`⚠️ [${processId}] Search criteria: apiBookingNumber=${bookingData.apiBookingNumber}, source=${bookingData.source}`)
        }
      } catch (firestoreError) {
        console.error(`⚠️ [${processId}] Failed to update email status in Firestore:`, firestoreError)
        console.error(`⚠️ [${processId}] Firestore error details:`, {
          message: firestoreError instanceof Error ? firestoreError.message : String(firestoreError),
          apiBookingNumber: bookingData.apiBookingNumber,
          source: bookingData.source
        })
        // Nu eșuăm procesul de email din cauza erorii Firestore
      }
      
    } else {
      backgroundLogs.push(`⚠️ Email failed: ${emailResult.error}`)
      console.error(`❌ [${processId}] ===== EMAIL SEND FAILED =====`)
      console.error(`❌ [${processId}] Error message: ${emailResult.error}`)
      console.error(`❌ [${processId}] Target email: ${bookingData.clientEmail}`)
      console.error(`❌ [${processId}] Booking number: ${bookingData.apiBookingNumber}`)
      console.error(`❌ [${processId}] Attempt duration: ${emailDuration}ms`)
      console.error(`❌ [${processId}] Failed timestamp: ${new Date().toISOString()}`)
      console.error(`❌ [${processId}] Email data:`, {
        clientName: emailData.clientName,
        clientEmail: emailData.clientEmail,
        bookingNumber: emailData.bookingNumber,
        amount: emailData.amount,
        source: emailData.source,
        status: emailData.status
      })
      
      // Opțional: Actualizează statusul de eșec în Firestore pentru retry later
      try {
        console.log(`📊 [${processId}] Updating Firestore with email failure status...`)
        
        const bookingsRef = collection(db, "bookings")
        const q = query(bookingsRef, 
          where("apiBookingNumber", "==", bookingData.apiBookingNumber),
          where("source", "==", bookingData.source)
        )
        const querySnapshot = await getDocs(q)
        
        if (!querySnapshot.empty) {
          const bookingDoc = querySnapshot.docs[0]
          await updateDoc(doc(db, "bookings", bookingDoc.id), {
            emailStatus: "failed",
            emailError: emailResult.error,
            emailFailedAt: serverTimestamp(),
            emailSendDuration: emailDuration,
            qrCodeGenerated: true, // QR a reușit
            lastUpdated: serverTimestamp()
          })
          console.log(`📊 [${processId}] Firestore updated with email failure status`)
          console.log(`📊 [${processId}] Document ID: ${bookingDoc.id}`)
        } else {
          console.warn(`⚠️ [${processId}] Booking document not found for failure update`)
        }
      } catch (firestoreError) {
        console.error(`⚠️ [${processId}] Failed to update email failure status in Firestore:`, firestoreError)
      }
    }
    
    const totalDuration = Date.now() - (Date.now() - emailDuration - qrDuration)
    console.log(`🏁 [${processId}] Background processing completed`)
    console.log(`🏁 [${processId}] Total process duration: ${totalDuration}ms`)
    console.log(`🏁 [${processId}] QR generation: ${qrDuration}ms`)
    console.log(`🏁 [${processId}] Email sending: ${emailDuration}ms`)
    console.log(`🏁 [${processId}] Final status: ${emailResult.success ? 'SUCCESS' : 'FAILED'}`)
    console.log(`🏁 [${processId}] End timestamp: ${new Date().toISOString()}`)
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    backgroundLogs.push(`❌ QR/Email background error: ${errorMessage}`)
    
    console.error(`❌ [${processId}] ===== BACKGROUND PROCESSING FAILED =====`)
    console.error(`❌ [${processId}] Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`)
    console.error(`❌ [${processId}] Error Message: ${errorMessage}`)
    console.error(`❌ [${processId}] Error Stack:`, error instanceof Error ? error.stack : 'N/A')
    console.error(`❌ [${processId}] Booking Number: ${bookingData.apiBookingNumber}`)
    console.error(`❌ [${processId}] Client Email: ${bookingData.clientEmail}`)
    console.error(`❌ [${processId}] Source: ${bookingData.source}`)
    console.error(`❌ [${processId}] Failed timestamp: ${new Date().toISOString()}`)
    
    throw error // Re-throw pentru catch-ul din funcția principală
  }
}

/**
 * Funcție centralizată pentru salvarea completă a rezervării în Firestore
 */
async function saveCompleteBookingToFirestore(bookingData: CompleteBookingData): Promise<{ success: boolean, firestoreId?: string, error?: string }> {
  try {
    console.log("💾 Saving booking to Firestore:", {
      licensePlate: bookingData.licensePlate,
      status: bookingData.status,
      apiSuccess: bookingData.apiSuccess,
      amount: bookingData.amount
    })
    
    // Filtrează câmpurile undefined pentru a fi compatibil cu Firestore
    const cleanedData = Object.fromEntries(
      Object.entries({
        ...bookingData,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      }).filter(([_, value]) => value !== undefined)
    )
    
    const docRef = await addDoc(collection(db, "bookings"), cleanedData)
    console.log("✅ Booking saved with ID:", docRef.id)
    
    // Incrementează contorul de rezervări active doar dacă rezervarea a reușit
    if (bookingData.apiSuccess) {
      try {
        const statsDocRef = doc(db, "config", "reservationStats")
        
        // Verifică dacă documentul există
        const statsDoc = await getDoc(statsDocRef)
        
        if (!statsDoc.exists()) {
          // Creează documentul cu valori inițiale
          await setDoc(statsDocRef, {
            activeBookingsCount: 1,
            totalBookingsCount: 1,
            lastUpdated: serverTimestamp(),
            createdAt: serverTimestamp()
          })
          console.log("📊 Created reservationStats document with initial values")
        } else {
          // Documentul există, îl actualizăm
          await updateDoc(statsDocRef, { 
            activeBookingsCount: increment(1),
            totalBookingsCount: increment(1),
            lastUpdated: serverTimestamp()
          })
          console.log("📊 Updated reservationStats - incremented counters")
        }
      } catch (statsError) {
        console.error("⚠️ Stats update failed (non-critical):", statsError)
        // Nu eșuează salvarea booking-ului din cauza erorii de stats
      }
    }
    
    return { success: true, firestoreId: docRef.id }
  } catch (error) {
    console.error("❌ Firestore save error:", error)
    return { success: false, error: error instanceof Error ? error.message : "Eroare necunoscută" }
  }
}

/**
 * Funcție pentru retry email-uri eșuate (poate fi apelată din admin dashboard)
 */
export async function retryFailedEmails(bookingId?: string): Promise<{ success: boolean, processed: number, errors: string[] }> {
  const errors: string[] = []
  let processed = 0
  
  try {
    const bookingsRef = collection(db, "bookings")
    let q
    
    if (bookingId) {
      // Retry pentru o rezervare specifică
      q = query(bookingsRef, where("__name__", "==", bookingId))
    } else {
      // Retry pentru toate email-urile eșuate din ultimele 24 ore
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      
      q = query(bookingsRef, 
        where("emailStatus", "==", "failed"),
        where("createdAt", ">=", yesterday)
      )
    }
    
    const querySnapshot = await getDocs(q)
    
    for (const docSnapshot of querySnapshot.docs) {
      const bookingData = docSnapshot.data() as CompleteBookingData
      
      if (bookingData.apiBookingNumber && bookingData.clientEmail) {
        try {
          console.log(`🔄 Retrying email for booking ${bookingData.apiBookingNumber}`)
          
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
            bookingNumber: bookingData.apiBookingNumber,
            status: bookingData.status,
            source: bookingData.source,
            createdAt: bookingData.createdAt?.toDate() || new Date()
          }
          
          const emailResult = await sendBookingConfirmationEmail(emailData)
          
          if (emailResult.success) {
            await updateDoc(doc(db, "bookings", docSnapshot.id), {
              emailSentAt: serverTimestamp(),
              emailStatus: "sent",
              emailRetryCount: increment(1),
              lastUpdated: serverTimestamp()
            })
            console.log(`✅ Email retry successful for booking ${bookingData.apiBookingNumber}`)
            processed++
          } else {
            await updateDoc(doc(db, "bookings", docSnapshot.id), {
              emailRetryCount: increment(1),
              lastEmailError: emailResult.error,
              lastUpdated: serverTimestamp()
            })
            errors.push(`Booking ${bookingData.apiBookingNumber}: ${emailResult.error}`)
          }
          
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          errors.push(`Booking ${bookingData.apiBookingNumber}: ${errorMessage}`)
        }
      }
    }
    
    return { success: true, processed, errors }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, processed, errors: [errorMessage] }
  }
}

export async function createBooking(formData: FormData) {
  try {
    // Parse and validate form data
    const rawData = {
      licensePlate: normalizeLicensePlate(formData.get("licensePlate") as string),
      startDate: formData.get("startDate") as string,
      startTime: formData.get("startTime") as string,
      endDate: formData.get("endDate") as string,
      endTime: formData.get("endTime") as string,
      clientName: (formData.get("clientName") as string) || "",
      clientTitle: (formData.get("clientTitle") as string) || "",
    }

    const validatedData = bookingFormSchema.parse(rawData)

    // Calculate duration in minutes (real duration)
    const startDateTime = new Date(`${validatedData.startDate}T${validatedData.startTime}:00`)
    const endDateTime = new Date(`${validatedData.endDate}T${validatedData.endTime}:00`)
    const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60))

    if (durationMinutes <= 0) {
      return { success: false, message: "Perioada de rezervare trebuie să fie pozitivă" }
    }

    // Calculate duration for Multipark API (rounded up to full days)
    // Dacă avem 25 ore → 2 zile → 2880 minute pentru Multipark
    const actualHours = durationMinutes / 60
    const roundedUpDays = Math.ceil(actualHours / 24)
    const multiparkDurationMinutes = roundedUpDays * 24 * 60
    
    console.log(`⏱️ Duration calculation for Multipark:`)
    console.log(`   📏 Real duration: ${durationMinutes} minutes (${actualHours.toFixed(1)} hours)`)
    console.log(`   📅 Rounded up to: ${roundedUpDays} days`)
    console.log(`   🎯 Multipark duration: ${multiparkDurationMinutes} minutes (${multiparkDurationMinutes/60} hours)`)

    // Generate a random 6-digit booking number
    const bookingNumber = Math.floor(100000 + Math.random() * 900000).toString()

    // Format the start date in the required format: YYYY/MM/DD HH:mm:SS
    const formattedStartDate = startDateTime
      .toISOString()
      .replace(/T/, " ")
      .replace(/-/g, "/")
      .replace(/\.\d+Z$/, "")

    // Create XML payload according to API documentation
    const xmlPayload = `
      <WSRequestBookingSubmitV1>
        <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
        <OperationType>N</OperationType>
        <BookingNumber>${bookingNumber}</BookingNumber>
        <LicensePlate>${validatedData.licensePlate}</LicensePlate>
        <StartDate>${formattedStartDate}</StartDate>
        <Duration>${multiparkDurationMinutes}</Duration>
        ${validatedData.clientTitle ? `<ClientTitle>${validatedData.clientTitle}</ClientTitle>` : ""}
        ${validatedData.clientName ? `<ClientName>${validatedData.clientName}</ClientName>` : ""}
        <AccessMode>0</AccessMode>
      </WSRequestBookingSubmitV1>
    `.trim()

    // Create Basic Auth header
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    // Make API request with extended timeout (45 seconds for webhook compatibility)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 45000) // 45 secunde timeout

    let response: Response
    try {
      response = await fetch(API_CONFIG.url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "text/xml",
        },
        body: xmlPayload,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
    } catch (fetchError) {
      clearTimeout(timeoutId)
      console.error("API Fetch Error:", fetchError)
      throw fetchError
    }

    // Parse XML response
    const responseText = await response.text()

    // Simple XML parsing - in production, use a proper XML parser
    const errorCodeMatch = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
    const messageMatch = responseText.match(/<Message>(.+?)<\/Message>/)

    const errorCode = errorCodeMatch ? errorCodeMatch[1] : null
    const message = messageMatch ? messageMatch[1] : "Răspuns necunoscut de la server"
    const isSuccess = errorCode === "1"

    // Returnăm rezultatul standard PLUS salvăm totul în Firestore
    const result = {
      success: isSuccess,
      message: isSuccess ? "Rezervarea a fost creată cu succes!" : `Eroare: ${message}`,
      bookingNumber: isSuccess ? bookingNumber : null,
      // Date suplimentare pentru debugging
      apiErrorCode: errorCode,
      apiResponse: responseText,
      apiPayload: xmlPayload,
      httpStatus: response.status
    }

    return result

  } catch (error) {
    console.error("Booking error:", error)
    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: `Validare eșuată: ${error.errors.map((e) => e.message).join(", ")}`,
      }
    }
    return {
      success: false,
      message: "A apărut o eroare la procesarea rezervării. Vă rugăm să încercați din nou.",
    }
  }
}

/**
 * Versiune extinsă a createBooking care salvează totul în Firestore
 * Folosită pentru cazurile când avem toate datele disponibile (webhook, test mode)
 */
export async function createBookingWithFirestore(
  formData: FormData, 
  additionalData?: {
    clientEmail?: string
    clientPhone?: string
    numberOfPersons?: number
    paymentIntentId?: string
    paymentStatus?: "paid" | "n/a" | "pending"
    amount?: number
    days?: number
    source?: "webhook" | "test_mode" | "manual" | "pay_on_site"
    // Date pentru facturare și adresă
    company?: string
    companyVAT?: string
    companyReg?: string
    companyAddress?: string
    needInvoice?: boolean
    address?: string
    city?: string
    county?: string
    postalCode?: string
    country?: string
    orderNotes?: string
    // Termeni și condiții
    termsAccepted?: boolean
  }
) {
  const debugLogs: string[] = []
  
  try {
    debugLogs.push(`🚀 Starting booking process for ${formData.get("licensePlate")} (${additionalData?.source || "manual"})`)
    
    let apiResult: any
    
    // Pentru pay on site: NU merge la Multipark, se procesează doar local
    if (additionalData?.source === "pay_on_site") {
      debugLogs.push(`💰 PAY ON SITE: Skipping Multipark API - no booking number will be generated`)
      
      // Mock un rezultat de succes fără a apela Multipark - NU generăm booking number fals
      apiResult = {
        success: true,
        message: "Rezervare pay on site creată cu succes (procesare locală)",
        bookingNumber: undefined, // Nu mai generăm numere false!
        apiPayload: "N/A - Pay on site (local processing)",
        apiResponse: "N/A - Pay on site (local processing)"
      }
      
      debugLogs.push(`📞 PAY ON SITE: LOCAL SUCCESS - ${apiResult.message}`)
    } else {
      // Pentru toate celelalte: merge la Multipark normal (webhook, test_mode, manual)
      apiResult = await createBooking(formData)
      debugLogs.push(`📞 MULTIPARK API: ${apiResult.success ? "SUCCESS" : "FAILED"} - ${apiResult.message}`)
    }
    
    // Verifică că amount-ul este corect calculat
    if (additionalData?.amount) {
      debugLogs.push(`💰 Amount: ${additionalData.amount} RON for ${additionalData.days || 1} day(s)`)
      
      // Validare suplimentară pentru consistența prețului
      if (additionalData.days && additionalData.amount > 0) {
        const pricePerDay = additionalData.amount / additionalData.days
        if (pricePerDay < 10 || pricePerDay > 200) {
          debugLogs.push(`⚠️ Unusual price per day: ${pricePerDay.toFixed(2)} RON`)
        }
      }
    }
    
    // Pregătește datele complete pentru Firestore
    const completeBookingData: CompleteBookingData = {
      // Date de bază din formData
      licensePlate: normalizeLicensePlate(formData.get("licensePlate") as string),
      startDate: formData.get("startDate") as string,
      startTime: formData.get("startTime") as string,
      endDate: formData.get("endDate") as string,
      endTime: formData.get("endTime") as string,
      clientName: formData.get("clientName") as string || "",
      clientTitle: formData.get("clientTitle") as string || "",
      
      // Date suplimentare
      clientEmail: additionalData?.clientEmail,
      clientPhone: additionalData?.clientPhone,
      numberOfPersons: additionalData?.numberOfPersons,
      
      // Date calculate
      durationMinutes: Math.round(
        (new Date(`${formData.get("endDate")}T${formData.get("endTime")}:00`).getTime() - 
         new Date(`${formData.get("startDate")}T${formData.get("startTime")}:00`).getTime()) / (1000 * 60)
      ),
      multiparkDurationMinutes: (() => {
        // Calculează minutele rotunjite pentru Multipark (doar dacă nu e pay-on-site)
        if (additionalData?.source === "pay_on_site") return undefined
        const realMinutes = Math.round(
          (new Date(`${formData.get("endDate")}T${formData.get("endTime")}:00`).getTime() - 
           new Date(`${formData.get("startDate")}T${formData.get("startTime")}:00`).getTime()) / (1000 * 60)
        )
        const actualHours = realMinutes / 60
        const roundedUpDays = Math.ceil(actualHours / 24)
        return roundedUpDays * 24 * 60
      })(),
      days: additionalData?.days,
      amount: additionalData?.amount,
      
      // Date plată
      paymentIntentId: additionalData?.paymentIntentId,
      paymentStatus: additionalData?.paymentStatus || "n/a",
      
      // Date API - safe access
      apiBookingNumber: (apiResult as any).bookingNumber || undefined,
      apiSuccess: apiResult.success,
      apiErrorCode: (apiResult as any).apiErrorCode || undefined,
      apiMessage: apiResult.message,
      apiRequestPayload: (apiResult as any).apiPayload || "",
      apiResponseRaw: (apiResult as any).apiResponse || "",
      apiRequestTimestamp: serverTimestamp(),
      
      // Status intern
      status: apiResult.success 
        ? (additionalData?.paymentStatus === "paid" ? "confirmed_paid" : 
           additionalData?.source === "pay_on_site" ? "confirmed_pay_on_site" : "confirmed_test")
        : "api_error",
      source: additionalData?.source || "manual",
      
      // Metadata
      createdAt: serverTimestamp()
    }
    
    // Adăugăm datele pentru facturare și adresă
    if (additionalData) {
      completeBookingData.company = additionalData.company
      completeBookingData.companyVAT = additionalData.companyVAT
      completeBookingData.companyReg = additionalData.companyReg
      completeBookingData.companyAddress = additionalData.companyAddress
      completeBookingData.needInvoice = additionalData.needInvoice
      completeBookingData.orderNotes = additionalData.orderNotes
      completeBookingData.address = additionalData.address
      completeBookingData.city = additionalData.city
      completeBookingData.county = additionalData.county
      completeBookingData.postalCode = additionalData.postalCode
      completeBookingData.country = additionalData.country
      // Termeni și condiții
      completeBookingData.termsAccepted = additionalData.termsAccepted
      if (additionalData.termsAccepted) {
        completeBookingData.termsAcceptedAt = serverTimestamp()
      }
    }
    
    if (apiResult.success) {
      debugLogs.push(`🎟️ Booking number: ${completeBookingData.apiBookingNumber}`)
    }
    debugLogs.push(`📊 Status: ${completeBookingData.status}`)
    
    // Salvează în Firestore
    const firestoreResult = await saveCompleteBookingToFirestore(completeBookingData)
    
    if (firestoreResult.success) {
      debugLogs.push(`✅ Saved to Firestore: ${firestoreResult.firestoreId}`)
      
      // Dacă rezervarea a reușit și avem email client, trimite email prin API endpoint
      // Pentru pay-on-site nu avem apiBookingNumber, dar tot trimitem email
      if (apiResult.success && completeBookingData.clientEmail && 
          (completeBookingData.apiBookingNumber || completeBookingData.source === "pay_on_site")) {
        // Log diferit pentru pay-on-site (fără booking number) vs normal (cu booking number)
        const bookingReference = completeBookingData.apiBookingNumber || `${completeBookingData.source}-${completeBookingData.licensePlate}`
        debugLogs.push(`📧 Starting email processing for ${bookingReference}`)
        debugLogs.push(`📧 Email will be sent to: ${completeBookingData.clientEmail}`)
        
        // ⚡ SINCRON: Trimite email prin API endpoint pentru a funcționa pe Vercel
        try {
          console.log(`📧 Calling email API endpoint for ${bookingReference}`)
          
          const emailApiUrl = process.env.NODE_ENV === 'development' 
            ? 'http://localhost:3000/api/send-confirmation-email'
            : 'https://parcare-aeroport.ro/api/send-confirmation-email'
          
          const emailResponse = await fetch(emailApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              bookingData: {
                bookingNumber: completeBookingData.apiBookingNumber,
                clientName: completeBookingData.clientName || 'Client',
                clientEmail: completeBookingData.clientEmail,
                clientPhone: completeBookingData.clientPhone,
                licensePlate: completeBookingData.licensePlate,
                startDate: completeBookingData.startDate,
                startTime: completeBookingData.startTime,
                endDate: completeBookingData.endDate,
                endTime: completeBookingData.endTime,
                days: additionalData?.days || 1,
                amount: additionalData?.amount || 0,
                status: completeBookingData.status,
                source: completeBookingData.source
              },
              firestoreId: firestoreResult.firestoreId
            })
          })
          
          if (emailResponse.ok) {
            const emailResult = await emailResponse.json()
            if (emailResult.success) {
              debugLogs.push(`✅ Email sent successfully to ${completeBookingData.clientEmail}`)
              console.log(`✅ Email API success for ${bookingReference}`)
            } else {
              debugLogs.push(`⚠️ Email API failed: ${emailResult.error}`)
              console.error(`⚠️ Email API failed for ${bookingReference}:`, emailResult.error)
            }
          } else {
            debugLogs.push(`⚠️ Email API HTTP error: ${emailResponse.status}`)
            console.error(`⚠️ Email API HTTP error for ${bookingReference}:`, emailResponse.status)
          }
        } catch (emailError) {
          debugLogs.push(`⚠️ Email API exception: ${emailError instanceof Error ? emailError.message : String(emailError)}`)
          console.error(`⚠️ Email API exception for ${bookingReference}:`, emailError)
          // Nu eșuăm întreaga rezervare din cauza erorii de email
        }
        
        debugLogs.push(`⚡ Email processing completed - reservation confirmed`)
        
      } else {
        if (!completeBookingData.clientEmail) {
          debugLogs.push(`⚠️ No email provided, skipping email notification`)
        }
        if (!completeBookingData.apiBookingNumber && completeBookingData.source !== "pay_on_site") {
          debugLogs.push(`⚠️ No booking number, skipping QR generation`)
        }
        if (!apiResult.success) {
          debugLogs.push(`⚠️ API failed, skipping QR/email generation`)
        }
      }

      console.log("✅ Rezervare confirmată:", firestoreResult.firestoreId)
      
      // Generează factură OBLIO automată pentru TOATE rezervările plătite ȘI în test mode
      if (additionalData?.paymentStatus === 'paid' || additionalData?.source === 'webhook' || additionalData?.source === 'test_mode') {
        try {
          console.log(`🧾 Starting Oblio invoice generation for booking ${completeBookingData.apiBookingNumber}`)
          
          const { generateOblioInvoice } = await import('@/lib/oblio-integration')
          
          const oblioInvoiceData = {
            bookingId: completeBookingData.apiBookingNumber!,
            clientName: completeBookingData.clientName || 'Client Site Parcări',
            clientEmail: additionalData.clientEmail || '',
            clientPhone: additionalData.clientPhone,
            licensePlate: completeBookingData.licensePlate,
            startDate: completeBookingData.startDate,
            endDate: completeBookingData.endDate,
            location: 'Site Parcări', // Ai putea să îl faci dinamic
            parkingSpot: completeBookingData.apiBookingNumber || '',
            totalCost: additionalData.amount || 0,
            billingType: (additionalData.company ? 'corporate' : 'individual') as 'corporate' | 'individual',
            company: additionalData.company,
            companyVAT: additionalData.companyVAT,
            companyReg: additionalData.companyReg,
            companyAddress: additionalData.companyAddress,
            // Date adresă client individual pentru ANAF
            clientAddress: additionalData.address,
            clientCity: additionalData.city,
            clientCounty: additionalData.county,
            clientCountry: additionalData.country,
          }

          // Timeout pentru Oblio (max 10 secunde)
          const oblioPromise = generateOblioInvoice(oblioInvoiceData)
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Oblio timeout')), 10000)
          )
          
          const invoiceResult = await Promise.race([oblioPromise, timeoutPromise]) as any
          
          if (invoiceResult.success) {
            console.log('✅ Factură Oblio generată cu succes:', invoiceResult.invoiceNumber, '- Link:', invoiceResult.invoiceUrl)
          } else {
            console.error('❌ Eroare la generarea facturii Oblio:', invoiceResult.error)
          }
        } catch (error) {
          console.error('❌ Eroare critică la generarea facturii Oblio:', error)
          console.error('⚠️ Factura Oblio a fost omisă - rezervarea continuă normal')
          // Nu oprim procesul pentru erori la facturare - rezervarea trebuie să continue
        }
      } else {
        console.log("ℹ️ Factură Oblio nu se generează - rezervare fără plată")
      }

      // Convertește Firestore timestamps în Date objects pentru serializare
      const serializableReservationData = {
        ...completeBookingData,
        createdAt: new Date().toISOString(),
        termsAcceptedAt: completeBookingData.termsAcceptedAt ? new Date().toISOString() : undefined,
        apiRequestTimestamp: new Date().toISOString(),
        lastUpdated: undefined // Remove serverTimestamp fields
      }

      return {
        firestoreId: firestoreResult.firestoreId,
        firestoreSuccess: true,
        firestoreError: undefined,
        debugLogs,
        success: true,
        message: `Rezervare confirmată cu numărul ${completeBookingData.apiBookingNumber}`,
        bookingNumber: completeBookingData.apiBookingNumber,
        reservationData: serializableReservationData,
        qrData: `MPK_RES=${completeBookingData.apiBookingNumber}`,
        bookingDetails: {
          bookingNumber: completeBookingData.apiBookingNumber,
          licensePlate: completeBookingData.licensePlate,
          startDateTime: `${completeBookingData.startDate} ${completeBookingData.startTime}`,
          endDateTime: `${completeBookingData.endDate} ${completeBookingData.endTime}`,
          customerName: completeBookingData.clientName || 'N/A',
          customerEmail: additionalData?.clientEmail || '',
          amount: additionalData?.amount || 0,
          paymentStatus: additionalData?.paymentStatus || 'n/a'
        }
      }
    } else {
      debugLogs.push(`❌ Firestore failed: ${firestoreResult.error}`)
      return {
        firestoreId: undefined,
        firestoreSuccess: false,
        firestoreError: firestoreResult.error,
        debugLogs,
        success: false,
        message: `Eroare la salvarea în Firestore: ${firestoreResult.error}`,
        bookingNumber: null,
        reservationData: null,
        qrData: null,
        bookingDetails: null
      }
    }
    
  } catch (error) {
    debugLogs.push(`💥 Exception: ${error instanceof Error ? error.message : String(error)}`)
    console.error("Error in createBookingWithFirestore:", error)
    return {
      firestoreId: undefined,
      firestoreSuccess: false,
      firestoreError: error instanceof Error ? error.message : "Eroare necunoscută",
      debugLogs,
      success: false,
      message: "Eroare la procesarea rezervării complete",
      bookingNumber: null,
      reservationData: null,
      qrData: null,
      bookingDetails: null
    }
  }
}

export async function cancelBooking(bookingNumber: string) {
  try {
    // Create XML payload for cancellation
    const xmlPayload = `
      <WSRequestBookingSubmitV1>
        <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
        <OperationType>D</OperationType>
        <BookingNumber>${bookingNumber}</BookingNumber>
      </WSRequestBookingSubmitV1>
    `.trim()

    // Create Basic Auth header
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    // Make API request with extended timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 45000) // 45 secunde timeout

    let response: Response
    try {
      response = await fetch(API_CONFIG.url, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "text/xml",
        },
        body: xmlPayload,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          success: false,
          message: `Eroare de server: ${response.status} ${response.statusText}`,
        }
      }
    } catch (fetchError) {
      clearTimeout(timeoutId)
      console.error("API Cancel Fetch Error:", fetchError)
      throw fetchError
    }

    // Parse XML response
    const responseText = await response.text()

    // Simple XML parsing
    const errorCodeMatch = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
    const messageMatch = responseText.match(/<Message>(.+?)<\/Message>/)

    const errorCode = errorCodeMatch ? errorCodeMatch[1] : null
    const message = messageMatch ? messageMatch[1] : "Răspuns necunoscut de la server"

    if (errorCode === "1") {
      // Success code according to documentation
      return {
        success: true,
        message: "Rezervarea a fost anulată cu succes!",
      }
    } else {
      return {
        success: false,
        message: `Eroare: ${message}`,
      }
    }
  } catch (error) {
    console.error("Cancellation error:", error)
    return {
      success: false,
      message: "A apărut o eroare la anularea rezervării. Vă rugăm să încercați din nou.",
    }
  }
}

/**
 * Funcție publică pentru curățarea rezervărilor expirate
 * Poate fi apelată manual sau programatic din alte părți ale aplicației
 */
export async function cleanupExpiredBookings(): Promise<{ cleanedCount: number, errors: string[] }> {
  const errors: string[] = []
  let cleanedCount = 0
  
  try {
    const now = new Date()
    const currentDateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
    
    console.log('🧹 Starting cleanup of expired bookings at:', currentDateStr)
    
    const bookingsRef = collection(db, 'bookings')
    
    // Query pentru rezervările care ar trebui să fie active dar poate au expirat
    const potentiallyExpiredQuery = query(
      bookingsRef,
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid']),
      where('endDate', '<=', currentDateStr) // Toate rezervările care se termină astăzi sau în trecut
    )
    
    const snapshot = await getDocs(potentiallyExpiredQuery)
    const expiredBookings = []
    
    for (const docSnapshot of snapshot.docs) {
      try {
        const booking = docSnapshot.data()
        const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
        
        if (endDateTime <= now) {
          // Marchează rezervarea ca expirată
          await updateDoc(docSnapshot.ref, {
            status: 'expired',
            expiredAt: serverTimestamp(),
            lastUpdated: serverTimestamp()
          })
          
          expiredBookings.push({
            id: docSnapshot.id,
            licensePlate: booking.licensePlate,
            endDate: booking.endDate,
            endTime: booking.endTime
          })
          
          cleanedCount++
          console.log('⏰ Marked booking as expired:', {
            id: docSnapshot.id,
            licensePlate: booking.licensePlate,
            endDate: booking.endDate,
            endTime: booking.endTime
          })
        }
      } catch (error) {
        const errorMessage = `Failed to update booking ${docSnapshot.id}: ${error instanceof Error ? error.message : String(error)}`
        errors.push(errorMessage)
        console.error('❌ Error updating individual booking:', errorMessage)
      }
    }
    
    if (cleanedCount > 0) {
      try {
        // Actualizează statisticile - scade numărul de rezervări active
        const statsDocRef = doc(db, "config", "reservationStats")
        await updateDoc(statsDocRef, {
          activeBookingsCount: increment(-cleanedCount),
          lastUpdated: serverTimestamp()
        })
        console.log(`✅ Updated stats: decreased active count by ${cleanedCount}`)
      } catch (error) {
        const errorMessage = `Failed to update reservation stats: ${error instanceof Error ? error.message : String(error)}`
        errors.push(errorMessage)
        console.error('❌ Error updating stats:', errorMessage)
      }
    }
    
    console.log(`🧹 Cleanup completed: ${cleanedCount} bookings marked as expired, ${errors.length} errors`)
    
    return { cleanedCount, errors }
    
  } catch (error) {
    const errorMessage = `Cleanup failed: ${error instanceof Error ? error.message : String(error)}`
    errors.push(errorMessage)
    console.error('❌ Critical error during cleanup:', errorMessage)
    return { cleanedCount: 0, errors }
  }
}

/**
 * Adaugă o rezervare manual de către admin (fără plată)
 * Această funcție va crea rezervarea în Firestore și o va trimite la API-ul de parcare
 */
export async function createManualBooking(formData: FormData) {
  const manualProcessId = `MANUAL_${Date.now()}`
  
  try {
    console.log(`🔧 [${manualProcessId}] ===== MANUAL BOOKING CREATION STARTED =====`)
    console.log(`🔧 [${manualProcessId}] Timestamp: ${new Date().toISOString()}`)
    
    // Extrage datele din FormData
    const licensePlate = formData.get('licensePlate') as string
    const startDate = formData.get('startDate') as string
    const startTime = formData.get('startTime') as string
    const endDate = formData.get('endDate') as string
    const endTime = formData.get('endTime') as string
    const clientName = formData.get('clientName') as string || ''
    const clientPhone = formData.get('clientPhone') as string || ''
    const clientEmail = formData.get('clientEmail') as string || ''
    const numberOfPersons = parseInt(formData.get('numberOfPersons') as string) || 1

    console.log(`🔧 [${manualProcessId}] Form data extracted:`)
    console.log(`🔧 [${manualProcessId}]   License Plate: ${licensePlate}`)
    console.log(`🔧 [${manualProcessId}]   Period: ${startDate} ${startTime} - ${endDate} ${endTime}`)
    console.log(`🔧 [${manualProcessId}]   Client Name: ${clientName || 'N/A'}`)
    console.log(`🔧 [${manualProcessId}]   Client Phone: ${clientPhone || 'N/A'}`)
    console.log(`🔧 [${manualProcessId}]   Client Email: ${clientEmail || 'N/A'}`)
    console.log(`🔧 [${manualProcessId}]   Number of Persons: ${numberOfPersons}`)

    // Validări de bază
    if (!licensePlate || !startDate || !startTime || !endDate || !endTime) {
      console.error(`❌ [${manualProcessId}] Validation failed - missing required fields`)
      console.error(`❌ [${manualProcessId}] Missing: ${[
        !licensePlate && 'licensePlate',
        !startDate && 'startDate', 
        !startTime && 'startTime',
        !endDate && 'endDate',
        !endTime && 'endTime'
      ].filter(Boolean).join(', ')}`)
      
      return {
        success: false,
        message: 'Toate câmpurile obligatorii trebuie completate'
      }
    }

    console.log(`✅ [${manualProcessId}] Basic validation passed`)

    // Calculează durata în minute
    const startDateTime = new Date(`${startDate}T${startTime}:00`)
    const endDateTime = new Date(`${endDate}T${endTime}:00`)
    const durationMinutes = Math.round((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60))

    console.log(`⏱️ [${manualProcessId}] Duration calculation:`)
    console.log(`⏱️ [${manualProcessId}]   Start DateTime: ${startDateTime.toISOString()}`)
    console.log(`⏱️ [${manualProcessId}]   End DateTime: ${endDateTime.toISOString()}`)
    console.log(`⏱️ [${manualProcessId}]   Duration Minutes: ${durationMinutes}`)

    if (durationMinutes <= 0) {
      console.error(`❌ [${manualProcessId}] Invalid duration: ${durationMinutes} minutes`)
      return {
        success: false,
        message: 'Data și ora de ieșire trebuie să fie după data și ora de intrare'
      }
    }

    // Calculează numărul de zile
    const days = Math.ceil(durationMinutes / (24 * 60))
    console.log(`📅 [${manualProcessId}] Calculated days: ${days}`)

    // Calculează minutele pentru Multipark (rotunjit la zile complete)
    const manualActualHours = durationMinutes / 60
    const manualRoundedUpDays = Math.ceil(manualActualHours / 24)
    const multiparkDurationMinutes = manualRoundedUpDays * 24 * 60
    console.log(`⏱️ [${manualProcessId}] Multipark duration: ${multiparkDurationMinutes} minutes (${manualRoundedUpDays} days)`)

    // Generare număr de rezervare aleatoriu
    const bookingNumber = Math.floor(100000 + Math.random() * 900000).toString()
    console.log(`🎲 [${manualProcessId}] Generated booking number: ${bookingNumber}`)

    console.log(`💾 [${manualProcessId}] ===== SAVING TO FIRESTORE =====`)

    // 1. CREEAZĂ REZERVAREA ÎN FIRESTORE MAI ÎNTÂI
    const bookingData = {
      licensePlate: normalizeLicensePlate(licensePlate),
      clientName,
      clientEmail,
      clientPhone,
      startDate,
      startTime,
      endDate,
      endTime,
      durationMinutes,
      multiparkDurationMinutes,
      days,
      amount: 0, // Fără cost - adăugată manual de operator
      status: 'confirmed_paid', // Status pentru rezervări reale manuale
      paymentStatus: 'n/a', // Nu este relevantă pentru rezervările manuale
      manualPaymentStatus: 'not_paid', // Inițial nu este plătită - va fi actualizată manual
      source: 'manual',
      numberOfPersons,
      apiSuccess: false, // Se va actualiza după apelul API
      createdAt: serverTimestamp(),
      lastUpdated: serverTimestamp()
      // Câmpurile API se vor adăuga după apelul API
    }

    console.log(`💾 [${manualProcessId}] Firestore data prepared:`)
    console.log(`💾 [${manualProcessId}]   License Plate: ${bookingData.licensePlate}`)
    console.log(`💾 [${manualProcessId}]   Status: ${bookingData.status}`)
    console.log(`💾 [${manualProcessId}]   Payment Status: ${bookingData.paymentStatus}`)
    console.log(`💾 [${manualProcessId}]   Source: ${bookingData.source}`)
    console.log(`💾 [${manualProcessId}]   Duration: ${bookingData.durationMinutes} minutes (${bookingData.days} days)`)

    // Salvează în Firestore
    const bookingsRef = collection(db, 'bookings')
    const firestoreStartTime = Date.now()
    
    console.log(`💾 [${manualProcessId}] Saving to Firestore...`)
    const bookingDocRef = await addDoc(bookingsRef, bookingData)
    const firestoreDuration = Date.now() - firestoreStartTime

    console.log(`✅ [${manualProcessId}] Firestore save successful:`)
    console.log(`✅ [${manualProcessId}]   Document ID: ${bookingDocRef.id}`)
    console.log(`✅ [${manualProcessId}]   Save Duration: ${firestoreDuration}ms`)

    console.log(`🌐 [${manualProcessId}] ===== CALLING PARKING API =====`)

    // 2. TRIMITE LA API-UL DE PARCARE (folosește același format ca test API)
    
    // Formatare dată de început în formatul cerut: YYYY/MM/DD HH:mm:SS
    const startDateObj = new Date(`${startDate}T${startTime}:00`)
    const formattedStartDate = startDateObj
        .toISOString()
        .replace(/T/, " ")
        .replace(/-/g, "/")
        .replace(/\.\d+Z$/, "")

         // Calculează durata în minute pentru API (rotunjit în sus la zile complete)
     const apiStartDateTime = new Date(`${startDate}T${startTime}:00`)
     const apiEndDateTime = new Date(`${endDate}T${endTime}:00`)
     const realApiDurationMinutes = Math.round((apiEndDateTime.getTime() - apiStartDateTime.getTime()) / (1000 * 60))
     
     // Rotunjire în sus la zile complete pentru Multipark
     const actualHours = realApiDurationMinutes / 60
     const roundedUpDays = Math.ceil(actualHours / 24)
     const apiDurationMinutes = roundedUpDays * 24 * 60
     
     console.log(`⏱️ [${manualProcessId}] Duration calculation for Multipark:`)
     console.log(`⏱️ [${manualProcessId}]   📏 Real duration: ${realApiDurationMinutes} minutes (${actualHours.toFixed(1)} hours)`)
     console.log(`⏱️ [${manualProcessId}]   📅 Rounded up to: ${roundedUpDays} days`)
     console.log(`⏱️ [${manualProcessId}]   🎯 Multipark duration: ${apiDurationMinutes} minutes (${apiDurationMinutes/60} hours)`)

     // XML payload în același format ca test API (format care funcționează)
      const xmlPayload = `
        <WSRequestBookingSubmitV1>
         <MultiparkId>${API_CONFIG.multiparkId}</MultiparkId>
          <OperationType>N</OperationType>
          <BookingNumber>${bookingNumber}</BookingNumber>
          <LicensePlate>${normalizeLicensePlate(licensePlate)}</LicensePlate>
          <StartDate>${formattedStartDate}</StartDate>
         <Duration>${apiDurationMinutes}</Duration>
          ${clientName ? `<ClientName>${clientName}</ClientName>` : ""}
          <AccessMode>0</AccessMode>
        </WSRequestBookingSubmitV1>
      `.trim()

    // Creare header Basic Auth (același ca în test API)
    const authHeader = `Basic ${Buffer.from(`${API_CONFIG.username}:${API_CONFIG.password}`).toString("base64")}`

    console.log(`🌐 [${manualProcessId}] API Configuration:`)
    console.log(`🌐 [${manualProcessId}]   URL: ${API_CONFIG.url}`)
    console.log(`🌐 [${manualProcessId}]   Username: ${API_CONFIG.username ? 'SET' : 'NOT SET'}`)
    console.log(`🌐 [${manualProcessId}]   Password: ${API_CONFIG.password ? 'SET' : 'NOT SET'}`)
    console.log(`🌐 [${manualProcessId}]   Multipark ID: ${API_CONFIG.multiparkId}`)
    console.log(`🌐 [${manualProcessId}]   Booking Number: ${bookingNumber}`)
    console.log(`🌐 [${manualProcessId}]   XML Payload Length: ${xmlPayload.length} chars`)
    console.log(`🌐 [${manualProcessId}]   Formatted Start Date: ${formattedStartDate}`)
    console.log(`🌐 [${manualProcessId}]   Duration Minutes: ${apiDurationMinutes}`)

    // Declare timeout variable outside try block
    let timeoutId: NodeJS.Timeout | undefined

    try {
      console.log(`🌐 [${manualProcessId}] Sending API request...`)
      const apiStartTime = Date.now()

      // Setăm un timeout consistent cu test API (30 secunde)
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), 30000)

      const apiResponse = await fetch(API_CONFIG.url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'text/xml',
        },
        body: xmlPayload,
        signal: controller.signal,
      })

      if (timeoutId) clearTimeout(timeoutId)

      const apiDuration = Date.now() - apiStartTime
      console.log(`🌐 [${manualProcessId}] API Response received in ${apiDuration}ms`)
      console.log(`🌐 [${manualProcessId}] Response Status: ${apiResponse.status} ${apiResponse.statusText}`)
      console.log(`🌐 [${manualProcessId}] Response Headers:`, Object.fromEntries(apiResponse.headers.entries()))

      if (!apiResponse.ok) {
        console.error(`❌ [${manualProcessId}] API HTTP Error: ${apiResponse.status} ${apiResponse.statusText}`)
        throw new Error(`HTTP ${apiResponse.status}: ${apiResponse.statusText}`)
      }

      const responseText = await apiResponse.text()
      console.log(`🌐 [${manualProcessId}] Raw API Response:`)
      console.log(`🌐 [${manualProcessId}] ${responseText}`)

      // Parsare răspuns XML
      const errorCodeMatch = responseText.match(/<ErrorCode>(\d+)<\/ErrorCode>/)
      const messageMatch = responseText.match(/<Message>(.+?)<\/Message>/)

      const errorCode = errorCodeMatch ? errorCodeMatch[1] : null
      const apiMessage = messageMatch ? messageMatch[1] : "Răspuns necunoscut de la server"
      const apiSuccess = errorCode === "1"

      console.log(`📊 [${manualProcessId}] API Response Analysis:`)
      console.log(`📊 [${manualProcessId}]   Error Code: ${errorCode}`)
      console.log(`📊 [${manualProcessId}]   API Message: ${apiMessage}`)
      console.log(`📊 [${manualProcessId}]   API Success: ${apiSuccess}`)
      console.log(`📊 [${manualProcessId}] Request Details:`)
      console.log(`📊 [${manualProcessId}]   Formatted Start Date: ${formattedStartDate}`)
      console.log(`📊 [${manualProcessId}]   Duration Minutes: ${apiDurationMinutes}`)
      console.log(`📊 [${manualProcessId}]   XML Format: WSRequestBookingSubmitV1 (same as test API)`)

      console.log(`💾 [${manualProcessId}] ===== UPDATING FIRESTORE WITH API RESULT =====`)

             // 3. ACTUALIZEAZĂ REZERVAREA CU REZULTATUL API
       const updateData: any = {
         apiSuccess,
         apiErrorCode: errorCode,
         apiMessage,
         apiRequestPayload: xmlPayload,
         apiResponseRaw: responseText,
         apiRequestTimestamp: serverTimestamp(),
         lastUpdated: serverTimestamp(),
         status: apiSuccess ? 'confirmed_paid' : 'api_error'
       }

       // Adaugă apiBookingNumber doar dacă API-ul a fost succes
       if (apiSuccess) {
         updateData.apiBookingNumber = bookingNumber
        console.log(`🎟️ [${manualProcessId}] Adding API booking number: ${bookingNumber}`)
      }

      console.log(`💾 [${manualProcessId}] Update data prepared:`)
      console.log(`💾 [${manualProcessId}]   API Success: ${updateData.apiSuccess}`)
      console.log(`💾 [${manualProcessId}]   API Error Code: ${updateData.apiErrorCode}`)
      console.log(`💾 [${manualProcessId}]   API Message: ${updateData.apiMessage}`)
      console.log(`💾 [${manualProcessId}]   New Status: ${updateData.status}`)

      const updateStartTime = Date.now()
       await updateDoc(bookingDocRef, updateData)
      const updateDuration = Date.now() - updateStartTime

      console.log(`✅ [${manualProcessId}] Firestore update completed in ${updateDuration}ms`)

      if (apiSuccess) {
        console.log(`📊 [${manualProcessId}] ===== UPDATING STATISTICS =====`)
        
        // 4. ACTUALIZEAZĂ STATISTICILE
        const statsDocRef = doc(db, "config", "reservationStats")
        const statsStartTime = Date.now()
        
        await updateDoc(statsDocRef, {
          activeBookingsCount: increment(1),
          lastUpdated: serverTimestamp()
        })

        const statsDuration = Date.now() - statsStartTime
        console.log(`📊 [${manualProcessId}] Statistics updated in ${statsDuration}ms`)

        console.log(`🎉 [${manualProcessId}] ===== MANUAL BOOKING COMPLETED SUCCESSFULLY =====`)
        console.log(`🎉 [${manualProcessId}] Firestore ID: ${bookingDocRef.id}`)
        console.log(`🎉 [${manualProcessId}] API Booking Number: ${bookingNumber}`)
        console.log(`🎉 [${manualProcessId}] Status: confirmed_paid`)
        console.log(`🎉 [${manualProcessId}] Email Available: ${clientEmail ? 'YES' : 'NO'}`)
        console.log(`🎉 [${manualProcessId}] Success Timestamp: ${new Date().toISOString()}`)

        return {
          success: true,
          message: `Rezervarea a fost creată cu succes! Număr rezervare: ${bookingNumber}`,
          bookingId: bookingDocRef.id,
          apiBookingNumber: bookingNumber,
          apiDetails: {
            request: {
              url: API_CONFIG.url,
              payload: xmlPayload,
              timestamp: new Date().toISOString()
            },
            response: {
              status: apiResponse.status,
              body: responseText,
              success: apiSuccess,
              errorCode: errorCode,
              message: apiMessage,
              timestamp: new Date().toISOString()
            }
          }
        }
      } else {
        console.log(`⚠️ [${manualProcessId}] ===== API FAILED BUT BOOKING SAVED =====`)
        console.log(`⚠️ [${manualProcessId}] Firestore ID: ${bookingDocRef.id}`)
        console.log(`⚠️ [${manualProcessId}] API Error: ${apiMessage}`)
        console.log(`⚠️ [${manualProcessId}] Status: api_error`)
        console.log(`⚠️ [${manualProcessId}] Note: Booking saved locally for manual processing`)

        return {
          success: true,
          message: `Rezervarea a fost salvată local dar API-ul a eșuat: ${apiMessage}. ID: ${bookingDocRef.id}`,
          bookingId: bookingDocRef.id,
          apiError: apiMessage,
          apiDetails: {
            request: {
              url: API_CONFIG.url,
              payload: xmlPayload,
              timestamp: new Date().toISOString()
            },
            response: {
              status: apiResponse.status,
              body: responseText,
              success: apiSuccess,
              errorCode: errorCode,
              message: apiMessage,
              timestamp: new Date().toISOString()
            }
          }
        }
      }

    } catch (apiError) {
      if (timeoutId) clearTimeout(timeoutId) // Asigură că timeout-ul este curățat
      
      console.error(`❌ [${manualProcessId}] ===== API ERROR =====`)
      console.error(`❌ [${manualProcessId}] Error Type: ${apiError instanceof Error ? apiError.constructor.name : typeof apiError}`)
      console.error(`❌ [${manualProcessId}] Error Message: ${apiError instanceof Error ? apiError.message : String(apiError)}`)
      console.error(`❌ [${manualProcessId}] Error Stack:`, apiError instanceof Error ? apiError.stack : 'N/A')
      console.error(`❌ [${manualProcessId}] API URL: ${API_CONFIG.url}`)
      console.error(`❌ [${manualProcessId}] Booking Number: ${bookingNumber}`)
      console.error(`❌ [${manualProcessId}] License Plate: ${licensePlate}`)
      console.error(`❌ [${manualProcessId}] Request Payload:`, xmlPayload)
      console.error(`❌ [${manualProcessId}] Auth Header: ${API_CONFIG.username ? 'SET' : 'MISSING'}`)

      console.log(`💾 [${manualProcessId}] Updating Firestore with API error...`)

             // Actualizează rezervarea cu eroarea API
      try {
       await updateDoc(bookingDocRef, {
         apiSuccess: false,
         apiMessage: apiError instanceof Error ? apiError.message : 'Eroare necunoscută API',
          apiRequestPayload: xmlPayload,
         lastUpdated: serverTimestamp(),
         status: 'api_error'
       })
        console.log(`✅ [${manualProcessId}] Firestore updated with API error status`)
      } catch (updateError) {
        console.error(`❌ [${manualProcessId}] Failed to update Firestore with API error:`, updateError)
      }

      return {
        success: true,
        message: `Rezervarea a fost salvată local dar a eșuat trimiterea la API. ID: ${bookingDocRef.id}`,
        bookingId: bookingDocRef.id,
        apiError: apiError instanceof Error ? apiError.message : 'Eroare necunoscută API',
        apiDetails: {
          request: {
            url: API_CONFIG.url,
            payload: xmlPayload,
            timestamp: new Date().toISOString()
          },
          response: {
            status: 0,
            body: `FETCH ERROR: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
            success: false,
            errorCode: 'FETCH_ERROR',
            message: apiError instanceof Error ? apiError.message : 'Eroare necunoscută API',
            timestamp: new Date().toISOString()
          }
        }
      }
    }

  } catch (error) {
    console.error(`❌ [${manualProcessId}] ===== CRITICAL ERROR =====`)
    console.error(`❌ [${manualProcessId}] Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`)
    console.error(`❌ [${manualProcessId}] Error Message: ${error instanceof Error ? error.message : String(error)}`)
    console.error(`❌ [${manualProcessId}] Error Stack:`, error instanceof Error ? error.stack : 'N/A')
    console.error(`❌ [${manualProcessId}] Failed Timestamp: ${new Date().toISOString()}`)
    console.error(`❌ [${manualProcessId}] Form Data:`, {
      licensePlate: formData.get('licensePlate'),
      startDate: formData.get('startDate'),
      startTime: formData.get('startTime'),
      endDate: formData.get('endDate'),
      endTime: formData.get('endTime'),
      clientName: formData.get('clientName'),
      clientEmail: formData.get('clientEmail')
    })

    return {
      success: false,
      message: error instanceof Error ? error.message : 'Eroare necunoscută la procesarea rezervării'
    }
  }
}

/**
 * Trimite manual email cu QR code pentru o rezervare existentă
 */
export async function sendManualBookingEmail(bookingId: string): Promise<{ success: boolean, message: string, error?: string }> {
  const manualEmailProcessId = `MANUAL_EMAIL_${bookingId}_${Date.now()}`
  
  try {
    console.log(`📧 [${manualEmailProcessId}] ===== MANUAL EMAIL SEND STARTED =====`)
    console.log(`📧 [${manualEmailProcessId}] Booking ID: ${bookingId}`)
    console.log(`📧 [${manualEmailProcessId}] Timestamp: ${new Date().toISOString()}`)
    
    console.log(`🔍 [${manualEmailProcessId}] Searching for booking in Firestore...`)
    
    // Găsește rezervarea în Firestore
    const bookingDoc = await getDoc(doc(db, "bookings", bookingId))
    
    if (!bookingDoc.exists()) {
      console.error(`❌ [${manualEmailProcessId}] Booking not found in Firestore`)
      console.error(`❌ [${manualEmailProcessId}] Searched ID: ${bookingId}`)
      console.error(`❌ [${manualEmailProcessId}] Collection: bookings`)
      
      return {
        success: false,
        message: "Rezervarea nu a fost găsită",
        error: "Booking not found"
      }
    }
    
    console.log(`✅ [${manualEmailProcessId}] Booking found in Firestore`)
    
    const bookingData = bookingDoc.data() as CompleteBookingData
    
    console.log(`📋 [${manualEmailProcessId}] Booking data analysis:`)
    console.log(`📋 [${manualEmailProcessId}]   License Plate: ${bookingData.licensePlate}`)
    console.log(`📋 [${manualEmailProcessId}]   Client Name: ${bookingData.clientName || 'N/A'}`)
    console.log(`📋 [${manualEmailProcessId}]   Client Email: ${bookingData.clientEmail || 'MISSING'}`)
    console.log(`📋 [${manualEmailProcessId}]   Client Phone: ${bookingData.clientPhone || 'N/A'}`)
    console.log(`📋 [${manualEmailProcessId}]   API Booking Number: ${bookingData.apiBookingNumber || 'MISSING'}`)
    console.log(`📋 [${manualEmailProcessId}]   Status: ${bookingData.status}`)
    console.log(`📋 [${manualEmailProcessId}]   Source: ${bookingData.source}`)
    console.log(`📋 [${manualEmailProcessId}]   Amount: ${bookingData.amount || 0}`)
    console.log(`📋 [${manualEmailProcessId}]   Days: ${bookingData.days || 'N/A'}`)
    console.log(`📋 [${manualEmailProcessId}]   Period: ${bookingData.startDate} ${bookingData.startTime} - ${bookingData.endDate} ${bookingData.endTime}`)
    
    // Verifică dacă rezervarea are toate datele necesare pentru email
    if (!bookingData.clientEmail) {
      console.error(`❌ [${manualEmailProcessId}] Client email missing`)
      console.error(`❌ [${manualEmailProcessId}] Cannot send email without recipient`)
      
      return {
        success: false,
        message: "Email-ul clientului lipsește din rezervare",
        error: "Client email missing"
      }
    }
    
    if (!bookingData.apiBookingNumber) {
      // Pentru pay on site, nu avem apiBookingNumber din Multipark, dar avem booking number local
      if (bookingData.source === 'pay_on_site') {
        console.log(`💰 [${manualEmailProcessId}] Pay on site reservation - no API booking number needed`)
        console.log(`💰 [${manualEmailProcessId}] Will use local booking number for email (no QR generation)`)
      } else {
        console.error(`❌ [${manualEmailProcessId}] API booking number missing`)
        console.error(`❌ [${manualEmailProcessId}] Cannot generate QR code without booking number`)
        console.error(`❌ [${manualEmailProcessId}] API Success: ${bookingData.apiSuccess}`)
        console.error(`❌ [${manualEmailProcessId}] API Message: ${bookingData.apiMessage || 'N/A'}`)
        
        return {
          success: false,
          message: "Numărul de rezervare API lipsește - nu se poate genera QR code",
          error: "API booking number missing"
        }
      }
    }
    
    console.log(`✅ [${manualEmailProcessId}] Email validation passed`)
    console.log(`✅ [${manualEmailProcessId}] Email recipient: ${bookingData.clientEmail}`)
    
    // Pentru pay on site nu avem QR, pentru celelalte da
    if (bookingData.source === 'pay_on_site') {
      console.log(`💰 [${manualEmailProcessId}] Pay on site - email will be sent without QR code`)
    } else {
      console.log(`✅ [${manualEmailProcessId}] QR booking number: ${bookingData.apiBookingNumber}`)
    }
    
    console.log(`📧 [${manualEmailProcessId}] ===== PREPARING EMAIL DATA =====`)
    
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
      // Pentru pay on site NU folosim booking number (nu există în Multipark)
      bookingNumber: bookingData.source === 'pay_on_site' ? '' : (bookingData.apiBookingNumber || 'N/A'),
      status: bookingData.status,
      source: bookingData.source || 'manual',
      createdAt: bookingData.createdAt?.toDate() || new Date()
    }
    
    console.log(`📧 [${manualEmailProcessId}] Email data prepared:`)
    console.log(`📧 [${manualEmailProcessId}]   Client Name: ${emailData.clientName}`)
    console.log(`📧 [${manualEmailProcessId}]   Client Email: ${emailData.clientEmail}`)
    console.log(`📧 [${manualEmailProcessId}]   License Plate: ${emailData.licensePlate}`)
    console.log(`📧 [${manualEmailProcessId}]   Booking Number: ${emailData.bookingNumber}`)
    console.log(`📧 [${manualEmailProcessId}]   Amount: ${emailData.amount} RON`)
    console.log(`📧 [${manualEmailProcessId}]   Days: ${emailData.days}`)
    console.log(`📧 [${manualEmailProcessId}]   Status: ${emailData.status}`)
    console.log(`📧 [${manualEmailProcessId}]   Source: ${emailData.source}`)
    console.log(`📧 [${manualEmailProcessId}]   Period: ${emailData.startDate} ${emailData.startTime} - ${emailData.endDate} ${emailData.endTime}`)
    
    console.log(`🚀 [${manualEmailProcessId}] ===== SENDING EMAIL =====`)
    console.log(`🚀 [${manualEmailProcessId}] Calling sendBookingConfirmationEmail...`)
    
    const emailStartTime = Date.now()
    
    // Trimite email-ul
    const emailResult = await sendBookingConfirmationEmail(emailData)
    
    const emailDuration = Date.now() - emailStartTime
    console.log(`🚀 [${manualEmailProcessId}] Email send completed in ${emailDuration}ms`)
    console.log(`🚀 [${manualEmailProcessId}] Email result: ${emailResult.success ? 'SUCCESS' : 'FAILED'}`)
    
    if (emailResult.success) {
      console.log(`✅ [${manualEmailProcessId}] ===== EMAIL SENT SUCCESSFULLY =====`)
      console.log(`✅ [${manualEmailProcessId}] Recipient: ${emailData.clientEmail}`)
      console.log(`✅ [${manualEmailProcessId}] Booking Number: ${emailData.bookingNumber}`)
      console.log(`✅ [${manualEmailProcessId}] Duration: ${emailDuration}ms`)
      
      console.log(`💾 [${manualEmailProcessId}] Updating Firestore with success status...`)
      
      // Actualizează statusul în Firestore cu informații despre email-ul manual
      const updateStartTime = Date.now()
      
      await updateDoc(doc(db, "bookings", bookingId), {
        emailSentAt: serverTimestamp(),
        emailStatus: "sent",
        lastManualEmailSent: serverTimestamp(),
        manualEmailCount: increment(1),
        lastUpdated: serverTimestamp()
      })
      
      const updateDuration = Date.now() - updateStartTime
      console.log(`✅ [${manualEmailProcessId}] Firestore updated in ${updateDuration}ms`)
      
      console.log(`🎉 [${manualEmailProcessId}] Manual email process completed successfully`)
      console.log(`🎉 [${manualEmailProcessId}] Total duration: ${Date.now() - (Date.now() - emailDuration - updateDuration)}ms`)
      console.log(`🎉 [${manualEmailProcessId}] Success timestamp: ${new Date().toISOString()}`)
      
      return {
        success: true,
        message: `Email trimis cu succes către ${emailData.clientEmail}`
      }
    } else {
      console.error(`❌ [${manualEmailProcessId}] ===== EMAIL SEND FAILED =====`)
      console.error(`❌ [${manualEmailProcessId}] Error: ${emailResult.error}`)
      console.error(`❌ [${manualEmailProcessId}] Recipient: ${emailData.clientEmail}`)
      console.error(`❌ [${manualEmailProcessId}] Booking Number: ${emailData.bookingNumber}`)
      console.error(`❌ [${manualEmailProcessId}] Duration: ${emailDuration}ms`)
      
      console.log(`💾 [${manualEmailProcessId}] Updating Firestore with failure status...`)
      
      // Marchează eșecul în Firestore
      const updateStartTime = Date.now()
      
      await updateDoc(doc(db, "bookings", bookingId), {
        emailStatus: "failed",
        lastEmailError: emailResult.error,
        lastManualEmailAttempt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      })
      
      const updateDuration = Date.now() - updateStartTime
      console.log(`✅ [${manualEmailProcessId}] Firestore updated with failure in ${updateDuration}ms`)
      
      console.error(`💔 [${manualEmailProcessId}] Manual email process failed`)
      console.error(`💔 [${manualEmailProcessId}] Total duration: ${Date.now() - (Date.now() - emailDuration - updateDuration)}ms`)
      console.error(`💔 [${manualEmailProcessId}] Failed timestamp: ${new Date().toISOString()}`)
      
      return {
        success: false,
        message: `Eroare la trimiterea email-ului: ${emailResult.error}`,
        error: emailResult.error
      }
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    
    console.error(`❌ [${manualEmailProcessId}] ===== MANUAL EMAIL CRITICAL ERROR =====`)
    console.error(`❌ [${manualEmailProcessId}] Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`)
    console.error(`❌ [${manualEmailProcessId}] Error Message: ${errorMessage}`)
    console.error(`❌ [${manualEmailProcessId}] Error Stack:`, error instanceof Error ? error.stack : 'N/A')
    console.error(`❌ [${manualEmailProcessId}] Booking ID: ${bookingId}`)
    console.error(`❌ [${manualEmailProcessId}] Error Timestamp: ${new Date().toISOString()}`)
    
    return {
      success: false,
      message: `Eroare la procesarea cererii: ${errorMessage}`,
      error: errorMessage
    }
  }
}