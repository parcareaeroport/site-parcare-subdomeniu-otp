const {setGlobalOptions} = require("firebase-functions/v2");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const {
  REVIEW_SCHEDULE_MODE,
  canAnchorReviewTask,
  getLprEntryDate,
  getReviewRecipientDecision,
  getReviewRecipientId,
  getReviewDueDate,
  isEligibleReviewBooking,
  isRealLprEntry,
  isReviewTaskDue,
  isTrustedLprReviewTask,
  toDate,
} = require("./review-email-logic");

admin.initializeApp();

const GOOGLE_REVIEW_URL = "https://g.page/r/CWWqOp4BhgTkEAE/review";
const SUPPORT_PHONE = "0742.039.955";
const SUPPORT_EMAIL = "contact.parcareaeroport@gmail.com";
const SUPPORT_ADDRESS_LINE = "Str. Calea Bucureştilor, Nr.303A1";
const SUPPORT_CITY_LINE = "Otopeni, Ilfov";
const GOOGLE_MAPS_URL = "https://maps.app.goo.gl/GhoVMNWvst6BamHx5?g_st=aw";
const WAZE_URL = "https://waze.com/ul?ll=44.575660,26.069918&navigate=yes";
const REVIEW_RECIPIENT_MIGRATION_VERSION = 1;
const REVIEW_RECIPIENT_MIGRATION_BATCH_SIZE = 400;

// Limităm instanțele și setăm regiunea implicită
setGlobalOptions({
  maxInstances: 5,
  region: "europe-west1",
});

/**
 * Build SMTP transporter for review emails.
 * @return {Object}
 */
function createReviewTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
        "Missing GMAIL_USER or GMAIL_APP_PASSWORD for review email",
    );
  }
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {user, pass},
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });
}

/**
 * Build HTML body for the review email.
 * @param {{
 *   clientName: string,
 *   googleReviewUrl: string
 * }} params
 * @return {string}
 */
function buildReviewEmailHtml({
  clientName,
  googleReviewUrl,
}) {
  const safeName = String(clientName || "Client");
  return `
    <div
      style="
        font-family: Arial, sans-serif;
        max-width: 640px;
        margin: 0 auto;
        color: #222;
      "
    >
      <h2 style="margin-bottom: 8px;">Multumim pentru rezervare!</h2>
      <p>Buna, ${safeName}.</p>
      <p>
        Daca ai 1 minut, ne-ar ajuta mult o recenzie pe Google Maps.
      </p>
      <p style="margin: 18px 0 22px 0;">
        <a
          href="${googleReviewUrl}"
          style="
            background: #ee7f1a;
            color: #fff;
            text-decoration: none;
            padding: 12px 18px;
            border-radius: 8px;
            font-weight: bold;
            display: inline-block;
          "
        >
          Lasă o recenzie rapidă
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">
        Daca butonul nu merge, foloseste acest link:<br/>
        <a href="${googleReviewUrl}">${googleReviewUrl}</a>
      </p>

      <div
        style="
          background: #fff;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0 0 0;
          border: 1px solid #f1f1f1;
        "
      >
        <h3
          style="
            text-align: center;
            color: #ee7f1a;
            margin: 0 0 20px 0;
          "
        >
          📞 Contactați-ne
        </h3>

        <div
          style="
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
          "
        >
          <div style="text-align: center; padding: 10px;">
            <h4 style="margin: 0 0 5px; color: #ee7f1a; font-size: 14px;">
              📞 Telefon suport
            </h4>
            <p style="margin: 0; font-size: 13px;">${SUPPORT_PHONE}</p>
          </div>

          <div style="text-align: center; padding: 10px;">
            <h4 style="margin: 0 0 5px; color: #ee7f1a; font-size: 14px;">
              📧 Email suport
            </h4>
            <p style="margin: 0; font-size: 13px;">${SUPPORT_EMAIL}</p>
          </div>

          <div style="text-align: center; padding: 10px;">
            <h4 style="margin: 0 0 5px; color: #ee7f1a; font-size: 14px;">
              🕒 Program
            </h4>
            <p style="margin: 0; font-size: 13px;">
              <strong>Non-Stop</strong>
            </p>
          </div>

          <div style="text-align: center; padding: 10px;">
            <h4 style="margin: 0 0 5px; color: #ee7f1a; font-size: 14px;">
              📍 Locație
            </h4>
            <p style="margin: 0; font-size: 13px;">${SUPPORT_ADDRESS_LINE}</p>
            <p style="margin: 0; font-size: 13px;">${SUPPORT_CITY_LINE}</p>
            <p style="margin: 0; font-size: 12px;">
              La 500 metri de Aeroportul Henri Coandă
            </p>
            <div
              style="
                margin-top: 10px;
                display: flex;
                gap: 8px;
                justify-content: center;
              "
            >
              <a
                href="${GOOGLE_MAPS_URL}"
                style="
                  display: inline-block;
                  background: #ee7f1a;
                  color: #fff;
                  padding: 8px 12px;
                  border-radius: 6px;
                  text-decoration: none;
                  font-size: 13px;
                "
              >
                📍 Google Maps
              </a>
              <a
                href="${WAZE_URL}"
                style="
                  display: inline-block;
                  background: #0099ff;
                  color: #fff;
                  padding: 8px 12px;
                  border-radius: 6px;
                  text-decoration: none;
                  font-size: 13px;
                "
              >
                🚗 Waze
              </a>
            </div>
          </div>
        </div>
      </div>

      <p
        style="
          margin: 20px 0 0 0;
          text-align: center;
          color: #666;
          font-size: 12px;
        "
      >
        <strong>OTP Parking SRL</strong> | ${SUPPORT_ADDRESS_LINE},
        ${SUPPORT_CITY_LINE} | ${SUPPORT_EMAIL}
      </p>
    </div>
  `;
}

/**
 * Send review email via Gmail SMTP.
 * @param {Object} params
 * @param {string} params.clientEmail
 * @param {string} params.clientName
 * @param {Object} [params.transporter]
 * @return {Promise<Object>}
 */
async function sendReviewEmail({clientEmail, clientName, transporter}) {
  const fromAddress = process.env.REVIEW_EMAIL_FROM || process.env.GMAIL_USER;
  if (!fromAddress) {
    throw new Error("REVIEW_EMAIL_FROM/GMAIL_USER missing");
  }

  const mailTransport = transporter || createReviewTransporter();
  const result = await mailTransport.sendMail({
    from: {
      name: "OTP Parking",
      address: fromAddress,
    },
    to: clientEmail,
    subject: "Cum a fost experienta ta la OTP Parking?",
    html: buildReviewEmailHtml({
      clientName,
      googleReviewUrl: GOOGLE_REVIEW_URL,
    }),
  });

  return {
    messageId: result && result.messageId ? result.messageId : null,
  };
}

/**
 * Basic email format check.
 * @param {string} email
 * @return {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

/**
 * Seed the permanent recipient registry from review emails already sent.
 * Sending stays paused until every historical completed task is covered.
 * @param {FirebaseFirestore.Firestore} db
 * @return {Promise<boolean>} true only when the registry is ready for sending
 */
async function ensureReviewRecipientMigration(db) {
  const markerRef = db.collection("review_email_system")
      .doc("recipient_deduplication");
  const markerSnap = await markerRef.get();
  const marker = markerSnap.exists ? (markerSnap.data() || {}) : {};

  if (marker.schemaVersion === REVIEW_RECIPIENT_MIGRATION_VERSION &&
      marker.state === "ready") {
    return true;
  }

  let query = db.collection("review_email_tasks")
      .where("status", "==", "completed")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(REVIEW_RECIPIENT_MIGRATION_BATCH_SIZE);
  if (marker.schemaVersion === REVIEW_RECIPIENT_MIGRATION_VERSION &&
      marker.lastTaskId) {
    query = query.startAfter(String(marker.lastTaskId));
  }

  const snap = await query.get();
  const recipients = new Map();
  for (const taskSnap of snap.docs) {
    const task = taskSnap.data() || {};
    const clientEmail = String(task.clientEmail || "").trim();
    if (!isValidEmail(clientEmail)) continue;
    const recipientId = getReviewRecipientId(clientEmail);
    if (!recipients.has(recipientId)) {
      recipients.set(recipientId, {taskId: taskSnap.id, task});
    }
  }

  const batch = db.batch();
  for (const [recipientId, historical] of recipients) {
    const recipientRef = db.collection("review_email_recipients")
        .doc(recipientId);
    const historicalSentAt = historical.task.sentAt ||
      historical.task.updatedAt ||
      historical.task.createdAt ||
      admin.firestore.FieldValue.serverTimestamp();
    batch.set(recipientRef, {
      emailHash: recipientId,
      status: "sent",
      firstTaskId: historical.taskId,
      firstBookingId: String(
          historical.task.bookingId || historical.taskId,
      ),
      sentAt: historicalSentAt,
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  const finished = snap.size < REVIEW_RECIPIENT_MIGRATION_BATCH_SIZE;
  const lastTaskId = snap.empty ? null : snap.docs[snap.docs.length - 1].id;
  batch.set(markerRef, {
    schemaVersion: REVIEW_RECIPIENT_MIGRATION_VERSION,
    state: finished ? "ready" : "migrating",
    lastTaskId: finished ?
      admin.firestore.FieldValue.delete() :
      lastTaskId,
    processedInLastBatch: snap.size,
    recipientsInLastBatch: recipients.size,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: finished ?
      admin.firestore.FieldValue.serverTimestamp() :
      admin.firestore.FieldValue.delete(),
  }, {merge: true});
  await batch.commit();

  console.log("processWpCardReviewEmails: recipient migration batch", {
    checked: snap.size,
    recipients: recipients.size,
    finished,
  });
  return false;
}

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
    const rawMin = Number(
        data.payOnSiteAutoCancelMinutes !== undefined ?
          data.payOnSiteAutoCancelMinutes :
          180,
    );
    payOnSiteAutoCancelMinutes = Number.isFinite(rawMin) && rawMin > 0 ?
      rawMin :
      180;
  } catch (e) {
    console.error(
        "autoExitPayOnSite: failed reading reservationSettings, using defaults",
        e,
    );
  }

  if (!payOnSiteAutoCancelEnabled) {
    console.log(
        "autoExitPayOnSite: disabled by config " +
        "(payOnSiteAutoCancelEnabled=false)",
    );
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
    // IMPORTANT: auto-cancel only for no-show (Intrări), never for cars
    // that have any LPR presence signal (arrived/departed/inside).
    const hasLprPresence =
        Boolean(lpr.arrivedAt) ||
        Boolean(lpr.departedAt) ||
        lpr.isInside === true;
    if (hasLprPresence) continue;

    const startDt = new Date(`${b.startDate}T${b.startTime}:00`);
    if (Number.isNaN(startDt.getTime())) continue;

    const diffMin = Math.round(
        (now.getTime() - startDt.getTime()) / (1000 * 60),
    );
    if (diffMin <= payOnSiteAutoCancelMinutes) continue;

    const updates = {
      "status": "cancelled_pay_on_site_timeout",
      "cancelReason":
        "Auto-cancel pay_on_site: no-show după " +
        `${payOnSiteAutoCancelMinutes} minute de la intrare`,
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

exports.scheduleWpCardReviewEmail = onDocumentCreated(
    "bookings/{bookingId}",
    async (event) => {
      const snap = event.data;
      if (!snap) return;

      const bookingId = event.params.bookingId;
      const booking = snap.data() || {};
      const clientEmail = String(booking.clientEmail || "").trim();

      if (!isEligibleReviewBooking(booking)) return;
      if (!isValidEmail(clientEmail)) return;

      const db = admin.firestore();
      const taskRef = db.collection("review_email_tasks").doc(bookingId);
      const bookingRef = db.collection("bookings").doc(bookingId);
      let created = false;

      await db.runTransaction(async (transaction) => {
        const existingTask = await transaction.get(taskRef);
        if (existingTask.exists) return;

        transaction.set(taskRef, {
          bookingId,
          bookingOrigin: String(
              booking.bookingOrigin || booking.source || "unknown",
          ),
          scheduleMode: REVIEW_SCHEDULE_MODE,
          status: "awaiting_entry",
          attempts: 0,
          maxAttempts: 3,
          clientEmail,
          clientName: booking.clientName || "",
          licensePlate: booking.licensePlate || "",
          apiBookingNumber: booking.apiBookingNumber || "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.set(bookingRef, {
          reviewEmailStatus: "awaiting_entry",
          reviewEmailScheduleMode: REVIEW_SCHEDULE_MODE,
          reviewEmailTaskId: bookingId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        created = true;
      });

      console.log("scheduleWpCardReviewEmail: awaiting LPR entry", {
        bookingId,
        created,
        scheduleMode: REVIEW_SCHEDULE_MODE,
      });
    },
);

exports.scheduleReviewEmailOnLprEntry = onDocumentCreated(
    "bookings/{bookingId}/gateEvents/{eventId}",
    async (event) => {
      const gateSnap = event.data;
      if (!gateSnap) return;

      const gateEvent = gateSnap.data() || {};
      if (!isRealLprEntry(gateEvent)) return;

      const db = admin.firestore();
      const bookingId = event.params.bookingId;
      const bookingRef = db.collection("bookings").doc(bookingId);
      const taskRef = db.collection("review_email_tasks").doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) return;

      const booking = bookingSnap.data() || {};
      const clientEmail = String(booking.clientEmail || "").trim();
      if (!isEligibleReviewBooking(booking) || !isValidEmail(clientEmail)) {
        return;
      }
      if (booking.reviewEmailStatus === "sent") return;

      const entryDate = getLprEntryDate(booking, gateEvent);
      const dueDate = getReviewDueDate(entryDate);
      if (!entryDate || !dueDate) {
        console.error("scheduleReviewEmailOnLprEntry: invalid entry time", {
          bookingId,
          eventId: event.params.eventId,
        });
        return;
      }

      const entryAt = admin.firestore.Timestamp.fromDate(entryDate);
      const dueAt = admin.firestore.Timestamp.fromDate(dueDate);
      let scheduled = false;

      await db.runTransaction(async (transaction) => {
        const taskSnap = await transaction.get(taskRef);
        const task = taskSnap.exists ? (taskSnap.data() || {}) : {};
        if (!canAnchorReviewTask(task)) return;

        const previousAttempts = Number(task.attempts || 0);
        transaction.set(taskRef, {
          bookingId,
          bookingOrigin: String(
              booking.bookingOrigin || booking.source || "unknown",
          ),
          scheduleMode: REVIEW_SCHEDULE_MODE,
          status: "pending",
          attempts: task.status === "failed" ? 0 : previousAttempts,
          maxAttempts: Number(task.maxAttempts || 3),
          scheduledFor: dueAt,
          reviewDueAt: dueAt,
          lprEntryAt: entryAt,
          lprEntryEventId: event.params.eventId,
          clientEmail,
          clientName: booking.clientName || "",
          licensePlate: booking.licensePlate || "",
          apiBookingNumber: booking.apiBookingNumber || "",
          lastError: admin.firestore.FieldValue.delete(),
          failedAt: admin.firestore.FieldValue.delete(),
          createdAt: task.createdAt ||
            admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.set(bookingRef, {
          reviewEmailStatus: "scheduled",
          reviewEmailEntryAt: entryAt,
          reviewEmailScheduledAt: dueAt,
          reviewEmailScheduleMode: REVIEW_SCHEDULE_MODE,
          reviewEmailTaskId: bookingId,
          reviewEmailLastError: admin.firestore.FieldValue.delete(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        scheduled = true;
      });

      console.log("scheduleReviewEmailOnLprEntry: handled", {
        bookingId,
        eventId: event.params.eventId,
        scheduled,
        entryAt: entryDate.toISOString(),
        scheduledFor: dueDate.toISOString(),
      });
    },
);

exports.processWpCardReviewEmails = onSchedule("every 5 minutes", async () => {
  const db = admin.firestore();
  const nowMs = Date.now();

  const recipientRegistryReady = await ensureReviewRecipientMigration(db);
  if (!recipientRegistryReady) {
    console.log(
        "processWpCardReviewEmails: sending paused for recipient migration",
    );
    return null;
  }

  const fromAddress = process.env.REVIEW_EMAIL_FROM || process.env.GMAIL_USER;
  if (!fromAddress) {
    console.error(
        "processWpCardReviewEmails: REVIEW_EMAIL_FROM/GMAIL_USER missing",
    );
    return null;
  }

  const snap = await db.collection("review_email_tasks")
      .where("status", "==", "pending")
      .limit(100)
      .get();

  if (snap.empty) {
    console.log("processWpCardReviewEmails: no due tasks");
    return null;
  }

  let transporter = null;
  let skippedLegacy = 0;
  let skippedRepeat = 0;
  let deferred = 0;
  let sent = 0;
  let failed = 0;

  for (const docSnap of snap.docs) {
    const task = docSnap.data() || {};
    const taskRef = docSnap.ref;
    const bookingId = String(task.bookingId || docSnap.id);
    const maxAttempts = Number(task.maxAttempts || 3);
    const clientEmail = String(task.clientEmail || "").trim();
    const clientName = String(task.clientName || "").trim() || "Client";
    const bookingRef = db.collection("bookings").doc(bookingId);
    const recipientId = getReviewRecipientId(clientEmail);
    const recipientRef = db.collection("review_email_recipients")
        .doc(recipientId);
    let bookingData = null;
    try {
      const bookingSnap = await bookingRef.get();
      if (bookingSnap.exists) {
        bookingData = bookingSnap.data() || {};
      }
    } catch (bookingErr) {
      console.error("processWpCardReviewEmails: booking read failed", {
        bookingId,
        error: bookingErr instanceof Error ?
          bookingErr.message :
          String(bookingErr),
      });
    }

    if (!bookingData) {
      await taskRef.set({
        status: "failed",
        lastError: "Missing booking for lpr_entry_plus_1h schedule",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      failed += 1;
      continue;
    }

    if (!isTrustedLprReviewTask(task)) {
      await taskRef.set({
        status: "skipped_legacy",
        scheduledFor: admin.firestore.FieldValue.delete(),
        skippedAt: admin.firestore.FieldValue.serverTimestamp(),
        skipReason: "missing_new_lpr_entry_marker",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      await bookingRef.set({
        reviewEmailStatus: "skipped_legacy",
        reviewEmailScheduleMode: REVIEW_SCHEDULE_MODE,
        reviewEmailScheduledAt: admin.firestore.FieldValue.delete(),
        reviewEmailLastError: admin.firestore.FieldValue.delete(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      skippedLegacy += 1;
      console.log("processWpCardReviewEmails: legacy task skipped", {
        bookingId,
        reason: "missing_new_lpr_entry_marker",
      });
      continue;
    }

    const scheduledForDate = toDate(task.scheduledFor);
    if (!scheduledForDate) {
      await taskRef.set({
        status: "failed",
        lastError: "Missing scheduledFor for LPR review email",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      failed += 1;
      continue;
    }

    if (!isReviewTaskDue(scheduledForDate, new Date(nowMs))) {
      deferred += 1;
      continue;
    }

    if (!isValidEmail(clientEmail)) {
      await taskRef.set({
        status: "failed",
        lastError: "Missing or invalid clientEmail",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      failed += 1;
      continue;
    }

    let claimed = false;
    let repeatSkipped = false;
    let attempts = Number(task.attempts || 0);
    await db.runTransaction(async (transaction) => {
      const [latestSnap, recipientSnap] = await Promise.all([
        transaction.get(taskRef),
        transaction.get(recipientRef),
      ]);
      if (!latestSnap.exists) return;
      const latestTask = latestSnap.data() || {};
      const latestScheduledFor = toDate(latestTask.scheduledFor);
      if (latestTask.status !== "pending" ||
          !isReviewTaskDue(latestScheduledFor)) {
        return;
      }

      const recipient = recipientSnap.exists ?
        (recipientSnap.data() || {}) :
        {};
      if (getReviewRecipientDecision(recipient, taskRef.id) ===
          "skip_repeat") {
        transaction.set(taskRef, {
          status: "skipped_repeat",
          scheduledFor: admin.firestore.FieldValue.delete(),
          skippedAt: admin.firestore.FieldValue.serverTimestamp(),
          skipReason: "recipient_already_claimed",
          reviewRecipientId: recipientId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.set(bookingRef, {
          reviewEmailStatus: "skipped_repeat",
          reviewEmailScheduledAt: admin.firestore.FieldValue.delete(),
          reviewEmailLastError: admin.firestore.FieldValue.delete(),
          reviewEmailRecipientId: recipientId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        repeatSkipped = true;
        return;
      }

      attempts = Number(latestTask.attempts || 0);
      transaction.set(taskRef, {
        status: "processing",
        reviewRecipientId: recipientId,
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      transaction.set(recipientRef, {
        emailHash: recipientId,
        status: "processing",
        firstTaskId: taskRef.id,
        firstBookingId: bookingId,
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      claimed = true;
    });
    if (repeatSkipped) {
      skippedRepeat += 1;
      console.log("processWpCardReviewEmails: repeat recipient skipped", {
        bookingId,
        recipientId,
      });
      continue;
    }
    if (!claimed) continue;

    try {
      transporter = transporter || createReviewTransporter();
      const result = await sendReviewEmail({
        clientEmail,
        clientName,
        transporter,
      });

      await db.runTransaction(async (transaction) => {
        transaction.set(taskRef, {
          status: "completed",
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          messageId: result.messageId,
          processingStartedAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.set(bookingRef, {
          reviewEmailStatus: "sent",
          reviewEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          reviewEmailLastError: admin.firestore.FieldValue.delete(),
          reviewEmailRecipientId: recipientId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.set(recipientRef, {
          emailHash: recipientId,
          status: "sent",
          firstTaskId: taskRef.id,
          firstBookingId: bookingId,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          messageId: result.messageId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
      });

      sent += 1;
      console.log("processWpCardReviewEmails: sent", {bookingId, clientEmail});
    } catch (err) {
      const nextAttempts = attempts + 1;
      const isFinal = nextAttempts >= maxAttempts;
      const backoffMinutes = Math.min(
          60,
          Math.pow(2, Math.max(0, attempts)) * 5,
      );
      const retryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
      const errMsg = err instanceof Error ? err.message : String(err);

      await db.runTransaction(async (transaction) => {
        transaction.set(taskRef, {
          status: isFinal ? "failed" : "pending",
          attempts: nextAttempts,
          lastError: errMsg,
          scheduledFor: isFinal ?
            admin.firestore.FieldValue.delete() :
            admin.firestore.Timestamp.fromDate(retryAt),
          failedAt: isFinal ? admin.firestore.FieldValue.serverTimestamp() :
            admin.firestore.FieldValue.delete(),
          processingStartedAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.set(bookingRef, {
          reviewEmailStatus: isFinal ? "failed" : "retry_pending",
          reviewEmailLastError: errMsg,
          reviewEmailRecipientId: recipientId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.set(recipientRef, {
          emailHash: recipientId,
          status: isFinal ? "failed" : "retry_pending",
          firstTaskId: taskRef.id,
          firstBookingId: bookingId,
          lastError: errMsg,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
      });

      failed += 1;
      console.error("processWpCardReviewEmails: failed", {
        bookingId,
        attempts: nextAttempts,
        maxAttempts,
        isFinal,
        errMsg,
      });
    }
  }

  console.log("processWpCardReviewEmails: done", {
    checked: snap.size,
    skippedLegacy,
    skippedRepeat,
    deferred,
    sent,
    failed,
  });
  return null;
});

exports.testReviewEmail = onRequest({invoker: "public"}, async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ok: false, error: "Method not allowed"});
    return;
  }

  const expectedSecret = String(process.env.REVIEW_LINK_SECRET || "").trim();
  const secret = String(
      req.query.secret || (req.body && req.body.secret) || "",
  ).trim();
  if (!expectedSecret || secret !== expectedSecret) {
    res.status(401).json({ok: false, error: "Unauthorized"});
    return;
  }

  const email = String(
      req.query.email || (req.body && req.body.email) || "",
  ).trim();
  const name = String(
      req.query.name || (req.body && req.body.name) || "Test",
  ).trim() || "Test";

  if (!isValidEmail(email)) {
    res.status(400).json({ok: false, error: "Missing or invalid email"});
    return;
  }

  try {
    const result = await sendReviewEmail({
      clientEmail: email,
      clientName: name,
    });
    console.log("testReviewEmail: sent", {
      email,
      messageId: result.messageId,
    });
    res.status(200).json({
      ok: true,
      to: email,
      messageId: result.messageId,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("testReviewEmail: failed", {email, errMsg});
    res.status(500).json({ok: false, error: errMsg});
  }
});
