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
  const db = admin.firestore();
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const bookingsRef = db.collection("bookings");

  // Read single source of truth from Firestore config/reservationSettings
  let payOnSiteAutoCancelEnabled = true;
  let payOnSiteAutoCancelMinutes = 180;
  try {
    const settingsSnap = await db.doc("config/reservationSettings").get();
    const data = settingsSnap.exists ? (settingsSnap.data() || {}) : {};
    payOnSiteAutoCancelEnabled = data.payOnSiteAutoCancelEnabled !== false;
    const rawMin = Number(data.payOnSiteAutoCancelMinutes ?? 180);
    payOnSiteAutoCancelMinutes = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : 180;
  } catch (e) {
    console.error("autoExitPayOnSite: failed reading reservationSettings, using defaults", e);
  }

  if (!payOnSiteAutoCancelEnabled) {
    console.log("autoExitPayOnSite: disabled by config (payOnSiteAutoCancelEnabled=false)");
    return null;
  }

  const snap = await bookingsRef
      .where("source", "==", "pay_on_site")
      .where("status", "in", [
        "confirmed_pay_on_site",
        "confirmed",
        "paid",
        "confirmed_test",
        "confirmed_paid",
      ])
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
    // Idempotency / already cancelled
    if (b.status === "cancelled_pay_on_site_timeout") continue;
    if (b.payOnSiteAutoCancelled === true) continue;
    if (b.payOnSiteStatus === "cancelled") continue;

    const lpr = b.lpr || {};
    // IMPORTANT: auto-cancel only for no-show (Intrări), never for cars that arrived.
    const hasArrived = Boolean(lpr.arrivedAt) || lpr.isInside === true;
    if (hasArrived) continue;

    const startDt = new Date(`${b.startDate}T${b.startTime}:00`);
    if (Number.isNaN(startDt.getTime())) continue;

    const diffMin = Math.round(
        (now.getTime() - startDt.getTime()) / (1000 * 60),
    );
    if (diffMin <= payOnSiteAutoCancelMinutes) continue;

    const updates = {
      "status": "cancelled_pay_on_site_timeout",
      "cancelReason": `Auto-cancel pay_on_site: no-show după ${payOnSiteAutoCancelMinutes} minute de la intrare`,
      "payOnSiteStatus": "cancelled",
      "payOnSiteAutoCancelled": true,
      "payOnSiteAutoCancelledAt": admin.firestore.FieldValue.serverTimestamp(),
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
        thresholdMin: payOnSiteAutoCancelMinutes,
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
