const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Inițializează Firebase Admin
admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function care se execută la fiecare 2 ore
 * Marchează rezervările expirate automat
 */
exports.cleanupExpiredBookings = functions.pubsub
  .schedule('0 */2 * * *') // La fiecare 2 ore
  .timeZone('Europe/Bucharest')
  .onRun(async (context) => {
    console.log('🧹 Starting automatic cleanup of expired bookings');
    
    try {
      const now = new Date();
      const currentDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      
      console.log('🕒 Checking for expired bookings at:', currentDateStr);
      
      // Query pentru rezervările care ar trebui să fie active dar poate au expirat
      const potentiallyExpiredQuery = db.collection('bookings')
        .where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid'])
        .where('endDate', '<=', currentDateStr);
      
      const snapshot = await potentiallyExpiredQuery.get();
      const batch = db.batch();
      let expiredCount = 0;
      
      snapshot.forEach((doc) => {
        const booking = doc.data();
        const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`);
        
        if (endDateTime <= now) {
          // Marchează rezervarea ca expirată
          batch.update(doc.ref, {
            status: 'expired',
            expiredAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
          });
          
          expiredCount++;
          console.log('⏰ Marking booking as expired:', {
            id: doc.id,
            licensePlate: booking.licensePlate,
            endDate: booking.endDate,
            endTime: booking.endTime
          });
        }
      });
      
      if (expiredCount > 0) {
        // Execută toate update-urile în batch
        await batch.commit();
        
        // Actualizează statisticile
        const statsDocRef = db.collection('config').doc('reservationStats');
        await statsDocRef.update({
          activeBookingsCount: admin.firestore.FieldValue.increment(-expiredCount),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`✅ Successfully marked ${expiredCount} bookings as expired`);
      } else {
        console.log('ℹ️ No expired bookings found');
      }
      
      return { success: true, expiredCount };
      
    } catch (error) {
      console.error('❌ Error in cleanup function:', error);
      throw error;
    }
  });

/**
 * Cloud Function trigger când se creează o rezervare nouă
 * Programează automat expirarea rezervării
 */
exports.scheduleBookingExpiration = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap, context) => {
    const booking = snap.data();
    const bookingId = context.params.bookingId;
    
    // Calculează timpul de expirare
    const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`);
    
    console.log(`📅 Scheduling expiration for booking ${bookingId} at ${endDateTime.toISOString()}`);
    
    // Programează o task pentru expirare
    // Folosim Cloud Tasks pentru programare precisă
    try {
      const scheduledTime = endDateTime.getTime() + (5 * 60 * 1000); // +5 minute buffer
      
      await db.collection('scheduled_tasks').add({
        type: 'expire_booking',
        bookingId: bookingId,
        scheduledFor: new Date(scheduledTime),
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      console.log(`✅ Scheduled expiration task for booking ${bookingId}`);
      
    } catch (error) {
      console.error('❌ Error scheduling expiration:', error);
    }
  });

/**
 * Cloud Function care procesează task-urile programate
 */
exports.processScheduledTasks = functions.pubsub
  .schedule('*/5 * * * *') // La fiecare 5 minute
  .timeZone('Europe/Bucharest')
  .onRun(async (context) => {
    console.log('🔄 Processing scheduled tasks');
    
    try {
      const now = new Date();
      
      // Găsește task-urile care trebuie procesate
      const tasksQuery = db.collection('scheduled_tasks')
        .where('status', '==', 'pending')
        .where('scheduledFor', '<=', now);
      
      const snapshot = await tasksQuery.get();
      const batch = db.batch();
      
      for (const taskDoc of snapshot.docs) {
        const task = taskDoc.data();
        
        if (task.type === 'expire_booking') {
          // Verifică dacă rezervarea încă există și e activă
          const bookingRef = db.collection('bookings').doc(task.bookingId);
          const bookingSnap = await bookingRef.get();
          
          if (bookingSnap.exists) {
            const booking = bookingSnap.data();
            
            if (['confirmed_paid', 'confirmed_test', 'confirmed', 'paid'].includes(booking.status)) {
              // Marchează ca expirată
              batch.update(bookingRef, {
                status: 'expired',
                expiredAt: admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
              });
              
              console.log(`⏰ Auto-expired booking ${task.bookingId}`);
            }
          }
        }
        
        // Marchează task-ul ca procesat
        batch.update(taskDoc.ref, {
          status: 'completed',
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      
      if (!snapshot.empty) {
        await batch.commit();
        console.log(`✅ Processed ${snapshot.size} scheduled tasks`);
      }
      
    } catch (error) {
      console.error('❌ Error processing scheduled tasks:', error);
    }
  });

/**
 * Cleanup pentru task-urile vechi completate
 */
exports.cleanupOldTasks = functions.pubsub
  .schedule('0 2 * * *') // Zilnic la 2:00 AM
  .timeZone('Europe/Bucharest')
  .onRun(async (context) => {
    console.log('🧹 Cleaning up old completed tasks');
    
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const oldTasksQuery = db.collection('scheduled_tasks')
        .where('status', '==', 'completed')
        .where('processedAt', '<=', sevenDaysAgo);
      
      const snapshot = await oldTasksQuery.get();
      const batch = db.batch();
      
      snapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });
      
      if (!snapshot.empty) {
        await batch.commit();
        console.log(`🗑️ Deleted ${snapshot.size} old completed tasks`);
      }
      
    } catch (error) {
      console.error('❌ Error cleaning up old tasks:', error);
    }
  }); 