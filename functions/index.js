const {setGlobalOptions} = require("firebase-functions/v2");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const REVIEW_SITE_BASE_URL = "https://rezervari.otp-parking.ro";
const GOOGLE_REVIEW_URL = "https://g.page/r/CWWqOp4BhgTkEAE/review";

// Limităm instanțele și setăm regiunea implicită
setGlobalOptions({
  maxInstances: 5,
  region: "europe-west1",
});

/**
 * Convert Firestore timestamp-like values to Date.
 * @param {unknown} ts
 * @return {Date|null}
 */
function getDateFromTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
 *   reviewUrl: string,
 *   googleReviewUrl: string
 * }} params
 * @return {string}
 */
function buildReviewEmailHtml({
  clientName,
  reviewUrl,
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
        Ne ajuta mult feedback-ul tau. Poti lasa rapid o recenzie direct pe
        site sau pe Google Maps.
      </p>
      <p style="margin: 18px 0 12px 0;">
        <a
          href="${reviewUrl}"
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
          Lasa o recenzie rapida
        </a>
      </p>
      <p style="margin: 0 0 22px 0;">
        <a
          href="${googleReviewUrl}"
          style="
            background: #fff;
            color: #1f2937;
            border: 1px solid #d1d5db;
            text-decoration: none;
            padding: 12px 18px;
            border-radius: 8px;
            font-weight: bold;
            display: inline-block;
          "
        >
          Lasa recenzie pe Google
        </a>
      </p>
      <p style="font-size: 13px; color: #666;">
        Daca butoanele nu merg, foloseste linkurile de mai jos:
      </p>
      <p style="font-size: 13px; color: #666; margin: 8px 0 0 0;">
        Recenzie pe site:<br/>
        <a href="${reviewUrl}">${reviewUrl}</a>
      </p>
      <p style="font-size: 13px; color: #666; margin: 8px 0 0 0;">
        Recenzie Google:<br/>
        <a href="${googleReviewUrl}">${googleReviewUrl}</a>
      </p>
    </div>
  `;
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
      const origin = String(booking.bookingOrigin || "");
      const paymentStatus = String(booking.paymentStatus || "");
      const clientEmail = String(booking.clientEmail || "").trim();

      if (origin !== "wp-card-booking") return;
      if (paymentStatus !== "paid") return;
      if (!clientEmail) return;

      const db = admin.firestore();
      const createdAt = getDateFromTimestamp(booking.createdAt) || new Date();
      const scheduledForDate = new Date(createdAt.getTime() + 60 * 60 * 1000);
      const scheduledFor = admin.firestore.Timestamp.fromDate(scheduledForDate);

      const taskRef = db.collection("review_email_tasks").doc(bookingId);
      const existingTask = await taskRef.get();
      if (existingTask.exists) {
        console.log(
            "scheduleWpCardReviewEmail: task already exists",
            {bookingId},
        );
        return;
      }

      await taskRef.set({
        bookingId,
        bookingOrigin: origin,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
        scheduledFor,
        clientEmail,
        clientName: booking.clientName || "",
        licensePlate: booking.licensePlate || "",
        apiBookingNumber: booking.apiBookingNumber || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection("bookings").doc(bookingId).set({
        reviewEmailStatus: "scheduled",
        reviewEmailScheduledAt: scheduledFor,
        reviewEmailTaskId: bookingId,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      console.log("scheduleWpCardReviewEmail: scheduled", {
        bookingId,
        clientEmail,
        scheduledFor: scheduledForDate.toISOString(),
      });
    },
);

exports.processWpCardReviewEmails = onSchedule("every 5 minutes", async () => {
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const siteBaseUrl = REVIEW_SITE_BASE_URL.replace(/\/+$/g, "");

  const fromAddress = process.env.REVIEW_EMAIL_FROM || process.env.GMAIL_USER;
  if (!fromAddress) {
    console.error(
        "processWpCardReviewEmails: REVIEW_EMAIL_FROM/GMAIL_USER missing",
    );
    return null;
  }

  const snap = await db.collection("review_email_tasks")
      .where("status", "==", "pending")
      .where("scheduledFor", "<=", nowTs)
      .limit(50)
      .get();

  if (snap.empty) {
    console.log("processWpCardReviewEmails: no due tasks");
    return null;
  }

  const transporter = createReviewTransporter();
  let sent = 0;
  let failed = 0;

  for (const docSnap of snap.docs) {
    const task = docSnap.data() || {};
    const taskRef = docSnap.ref;
    const bookingId = String(task.bookingId || docSnap.id);
    const attempts = Number(task.attempts || 0);
    const maxAttempts = Number(task.maxAttempts || 3);
    const clientEmail = String(task.clientEmail || "").trim();
    const clientName = String(task.clientName || "").trim() || "Client";

    if (!clientEmail) {
      await taskRef.set({
        status: "failed",
        lastError: "Missing clientEmail",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      failed += 1;
      continue;
    }

    await taskRef.set({
      status: "processing",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    try {
      const reviewUrl =
        `${siteBaseUrl}/recenzie?bookingId=${encodeURIComponent(bookingId)}`;

      const mailOptions = {
        from: {
          name: "OTP Parking",
          address: fromAddress,
        },
        to: clientEmail,
        subject: "Cum a fost experienta ta la OTP Parking?",
        html: buildReviewEmailHtml({
          clientName,
          reviewUrl,
          googleReviewUrl: GOOGLE_REVIEW_URL,
        }),
      };

      const result = await transporter.sendMail(mailOptions);

      await taskRef.set({
        status: "completed",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        messageId: result && result.messageId ? result.messageId : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      await db.collection("bookings").doc(bookingId).set({
        reviewEmailStatus: "sent",
        reviewEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewEmailLastError: admin.firestore.FieldValue.delete(),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

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

      await taskRef.set({
        status: isFinal ? "failed" : "pending",
        attempts: nextAttempts,
        lastError: errMsg,
        scheduledFor: isFinal ?
          admin.firestore.FieldValue.delete() :
          admin.firestore.Timestamp.fromDate(retryAt),
        failedAt: isFinal ? admin.firestore.FieldValue.serverTimestamp() :
          admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      await db.collection("bookings").doc(bookingId).set({
        reviewEmailStatus: isFinal ? "failed" : "retry_pending",
        reviewEmailLastError: errMsg,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

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
    sent,
    failed,
  });
  return null;
});
