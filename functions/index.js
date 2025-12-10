const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

// Limităm instanțele și setăm regiunea implicită
setGlobalOptions({
  maxInstances: 5,
  region: "europe-west1",
});

/**
 * Cron: auto-exit pay_on_site după 3h fără LPR
 * - status = confirmed_pay_on_site
 * - lpr.isInside != true
 * - now > startDate + startTime + 3h
 */
exports.autoExitPayOnSite = onSchedule("every 15 minutes", async () => {
  const PAY_ON_SITE_TIMEOUT_MIN = 180;
  const db = admin.firestore();
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const bookingsRef = db.collection("bookings");

  const snap = await bookingsRef
      .where("status", "==", "confirmed_pay_on_site")
      .where("startDate", "<=", today)
      .limit(300)
      .get();

  if (snap.empty) {
    console.log("autoExitPayOnSite: no candidates");
    return null;
  }

  let processed = 0;
  for (const docSnap of snap.docs) {
    const b = docSnap.data();
    if (!b.startDate || !b.startTime) continue;
    if (b.lpr && b.lpr.isInside === true) continue;

    const startDt = new Date(`${b.startDate}T${b.startTime}:00`);
    if (Number.isNaN(startDt.getTime())) continue;

    const diffMin = Math.round(
        (now.getTime() - startDt.getTime()) / (1000 * 60),
    );
    if (diffMin <= PAY_ON_SITE_TIMEOUT_MIN) continue;

    const updates = {
      "status": "cancelled_pay_on_site_timeout",
      "cancelReason": "Auto-exit: peste 3h fără LPR (pay on site)",
      "autoExitedAt": admin.firestore.FieldValue.serverTimestamp(),
      "lastUpdated": admin.firestore.FieldValue.serverTimestamp(),
      "lpr.isInside": false,
    };

    const shouldDecrementOcc =
        b.occupancyIncremented === true && b.occupancyDecremented !== true;
    if (shouldDecrementOcc) {
      updates.occupancyDecremented = true;
      updates.occupancyDecrementedAt =
          admin.firestore.FieldValue.serverTimestamp();
      try {
        const occupancyDocRef = db.doc("config/parkingLive");
        await occupancyDocRef.set(
            {
              occupiedCount: 0,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            },
            {merge: true},
        );
        await occupancyDocRef.update({
          occupiedCount: admin.firestore.FieldValue.increment(-1),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastChange: {
            type: "exit_pay_on_site_timeout",
            bookingId: docSnap.id,
            plateNumber: b.licensePlate,
            at: now.toISOString(),
          },
        });
      } catch (occErr) {
        console.error(
            "autoExitPayOnSite: occupancy decrement failed",
            occErr,
        );
      }
    }

    try {
      await docSnap.ref.update(updates);
      processed += 1;
      console.log("autoExitPayOnSite: auto-exited", {
        id: docSnap.id,
        plate: b.licensePlate,
        diffMin,
      });
    } catch (e) {
      console.error(
          "autoExitPayOnSite: failed to update booking",
          docSnap.id,
          e,
      );
    }
  }

  const sP = `autoExitPayOnSite: done, processed=${processed}`;
  const sC = `checked=${snap.size}`;
  console.log(`${sP}, ${sC}`);
  return null;
});
