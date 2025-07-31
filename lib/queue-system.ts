// Sistem simplu de queue pentru email-uri (opțional pentru robustețe suplimentară)

import { collection, addDoc, getDocs, query, where, updateDoc, doc, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { sendBookingConfirmationEmail } from "./email-service"
import { generateMultiparkQR } from "./qr-generator"

interface QueueItem {
  id?: string
  type: "email" | "qr" | "both"
  bookingNumber: string
  clientEmail: string
  bookingData: any
  attempts: number
  maxAttempts: number
  status: "pending" | "processing" | "completed" | "failed"
  createdAt: any
  lastAttempt?: any
  nextRetry?: any
}

/**
 * Adaugă un task în queue pentru procesare background
 */
export async function addToQueue(
  type: "email" | "qr" | "both",
  bookingNumber: string, 
  clientEmail: string,
  bookingData: any
): Promise<{ success: boolean, queueId?: string }> {
  try {
    const queueItem: QueueItem = {
      type,
      bookingNumber,
      clientEmail,
      bookingData,
      attempts: 0,
      maxAttempts: 3,
      status: "pending",
      createdAt: serverTimestamp(),
      nextRetry: new Date() // Procesează imediat
    }
    
    const docRef = await addDoc(collection(db, "processing_queue"), queueItem)
    console.log(`📋 Added to queue: ${docRef.id} for booking ${bookingNumber}`)
    
    return { success: true, queueId: docRef.id }
  } catch (error) {
    console.error("❌ Failed to add to queue:", error)
    return { success: false }
  }
}

/**
 * Procesează toate task-urile pending din queue
 * Poate fi apelată de un cron job sau manual
 */
export async function processQueue(): Promise<{ processed: number, failed: number }> {
  let processed = 0
  let failed = 0
  
  try {
    // Găsește toate task-urile pending care sunt gata pentru retry
    const q = query(
      collection(db, "processing_queue"),
      where("status", "in", ["pending", "failed"]),
      where("nextRetry", "<=", new Date())
    )
    
    const querySnapshot = await getDocs(q)
    
    for (const docSnapshot of querySnapshot.docs) {
      const item = docSnapshot.data() as QueueItem
      
      if (item.attempts >= item.maxAttempts) {
        // Marchează ca eșuat definitiv
        await updateDoc(doc(db, "processing_queue", docSnapshot.id), {
          status: "failed",
          lastAttempt: serverTimestamp()
        })
        failed++
        continue
      }
      
      try {
        // Marchează ca în procesare
        await updateDoc(doc(db, "processing_queue", docSnapshot.id), {
          status: "processing",
          attempts: item.attempts + 1,
          lastAttempt: serverTimestamp()
        })
        
        console.log(`🔄 Processing queue item for booking ${item.bookingNumber}`)
        
        // Procesează în funcție de tip
        if (item.type === "email" || item.type === "both") {
          const emailResult = await sendBookingConfirmationEmail({
            clientName: item.bookingData.clientName || 'Client',
            clientEmail: item.clientEmail,
            clientPhone: item.bookingData.clientPhone,
            licensePlate: item.bookingData.licensePlate,
            startDate: item.bookingData.startDate,
            startTime: item.bookingData.startTime,
            endDate: item.bookingData.endDate,
            endTime: item.bookingData.endTime,
            days: item.bookingData.days || 1,
            amount: item.bookingData.amount || 0,
            bookingNumber: item.bookingNumber,
            status: item.bookingData.status,
            source: item.bookingData.source,
            createdAt: new Date()
          })
          
          if (!emailResult.success) {
            throw new Error(`Email failed: ${emailResult.error}`)
          }
        }
        
        if (item.type === "qr" || item.type === "both") {
          await generateMultiparkQR(item.bookingNumber)
        }
        
        // Marchează ca complet
        await updateDoc(doc(db, "processing_queue", docSnapshot.id), {
          status: "completed",
          lastAttempt: serverTimestamp()
        })
        
        console.log(`✅ Queue item completed for booking ${item.bookingNumber}`)
        processed++
        
      } catch (error) {
        console.error(`❌ Queue processing failed for booking ${item.bookingNumber}:`, error)
        
        // Calculează următorul retry (exponential backoff)
        const nextRetryMinutes = Math.pow(2, item.attempts) * 5 // 5, 10, 20 minute
        const nextRetry = new Date()
        nextRetry.setMinutes(nextRetry.getMinutes() + nextRetryMinutes)
        
        await updateDoc(doc(db, "processing_queue", docSnapshot.id), {
          status: "pending",
          nextRetry,
          lastError: error instanceof Error ? error.message : String(error)
        })
        
        failed++
      }
    }
    
    return { processed, failed }
    
  } catch (error) {
    console.error("❌ Queue processing error:", error)
    return { processed, failed }
  }
}

/**
 * Funcție pentru a fi apelată de un cron job
 */
export async function runQueueProcessor(): Promise<void> {
  console.log("🔄 Starting queue processor...")
  const result = await processQueue()
  console.log(`📊 Queue processing complete: ${result.processed} processed, ${result.failed} failed`)
}

/**
 * Cleanup pentru task-urile vechi completed
 */
export async function cleanupOldQueueItems(daysOld: number = 7): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysOld)
  
  const q = query(
    collection(db, "processing_queue"),
    where("status", "==", "completed"),
    where("createdAt", "<=", cutoffDate)
  )
  
  const querySnapshot = await getDocs(q)
  let cleaned = 0
  
  for (const docSnapshot of querySnapshot.docs) {
    await updateDoc(doc(db, "processing_queue", docSnapshot.id), {
      status: "archived"
    })
    cleaned++
  }
  
  console.log(`🧹 Cleaned up ${cleaned} old queue items`)
  return cleaned
} 