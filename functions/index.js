const {setGlobalOptions} = require("firebase-functions/v2");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();

const GOOGLE_REVIEW_URL = "https://g.page/r/CWWqOp4BhgTkEAE/review";
const SUPPORT_PHONE = "0742.039.955";
const SUPPORT_EMAIL = "contact.parcareaeroport@gmail.com";
const SUPPORT_ADDRESS_LINE = "Str. Calea Bucureştilor, Nr.303A1";
const SUPPORT_CITY_LINE = "Otopeni, Ilfov";
const GOOGLE_MAPS_URL = "https://maps.app.goo.gl/GhoVMNWvst6BamHx5?g_st=aw";
const WAZE_URL = "https://waze.com/ul?ll=44.575660,26.069918&navigate=yes";
const REVIEW_TIME_ZONE = "Europe/Bucharest";

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
 * Parse date parts from yyyy-mm-dd.
 * @param {string} dateStr
 * @return {{year: number, month: number, day: number}|null}
 */
function parseDateParts(dateStr) {
  const match = String(dateStr || "").trim()
      .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1970) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  return {year, month, day};
}

/**
 * Parse time parts from hh:mm or hh:mm:ss.
 * @param {string} timeStr
 * @return {{hour: number, minute: number, second: number}|null}
 */
function parseTimeParts(timeStr) {
  const match = String(timeStr || "").trim()
      .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = match[3] ? Number(match[3]) : 0;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (!Number.isInteger(second) || second < 0 || second > 59) return null;

  return {hour, minute, second};
}

/**
 * Compute timezone offset in milliseconds for a specific instant.
 * @param {Date} date
 * @param {string} timeZone
 * @return {number}
 */
function getTimeZoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type === "literal") continue;
    values[part.type] = Number(part.value);
  }

  const zonedAsUtcMs = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
  );
  return zonedAsUtcMs - date.getTime();
}

/**
 * Parse local date-time in target timezone to a UTC Date instant.
 * @param {string} dateStr
 * @param {string} timeStr
 * @param {string} timeZone
 * @return {Date|null}
 */
function parseLocalDateTimeInZone(dateStr, timeStr, timeZone) {
  const dateParts = parseDateParts(dateStr);
  const timeParts = parseTimeParts(timeStr);
  if (!dateParts || !timeParts) return null;

  const naiveUtcMs = Date.UTC(
      dateParts.year,
      dateParts.month - 1,
      dateParts.day,
      timeParts.hour,
      timeParts.minute,
      timeParts.second,
  );

  const firstOffsetMs = getTimeZoneOffsetMs(new Date(naiveUtcMs), timeZone);
  let utcMs = naiveUtcMs - firstOffsetMs;
  const secondOffsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
  if (secondOffsetMs !== firstOffsetMs) {
    utcMs = naiveUtcMs - secondOffsetMs;
  }

  const parsed = new Date(utcMs);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Parse booking start date-time from booking fields.
 * @param {Record<string, unknown>} booking
 * @return {Date|null}
 */
function getBookingStartDateTime(booking) {
  const startDate = String(booking.startDate || "").trim();
  const startTime = String(booking.startTime || "").trim();
  if (!startDate || !startTime) return null;
  return parseLocalDateTimeInZone(startDate, startTime, REVIEW_TIME_ZONE);
}

/**
 * Compute review email schedule date as startDate + startTime + 1 hour.
 * @param {Record<string, unknown>} booking
 * @return {Date|null}
 */
function getReviewArrivalScheduleDate(booking) {
  const startDateTime = getBookingStartDateTime(booking);
  if (!startDateTime) return null;
  return new Date(startDateTime.getTime() + 60 * 60 * 1000);
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
      const source = String(booking.source || "");
      const status = String(booking.status || "");
      const paymentStatus = String(booking.paymentStatus || "");
      const clientEmail = String(booking.clientEmail || "").trim();

      const isWpCardBooking =
        origin === "wp-card-booking" && paymentStatus === "paid";
      const isPayOnSiteBooking =
        source === "pay_on_site" && status === "confirmed_pay_on_site";

      if (!isWpCardBooking && !isPayOnSiteBooking) return;
      if (!clientEmail) return;

      const db = admin.firestore();
      const scheduledForDate = getReviewArrivalScheduleDate(booking);
      if (!scheduledForDate) {
        await db.collection("bookings").doc(bookingId).set({
          reviewEmailStatus: "schedule_failed",
          reviewEmailLastError:
            "Missing or invalid startDate/startTime for review email",
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        console.warn("scheduleWpCardReviewEmail: start date-time missing", {
          bookingId,
        });
        return;
      }

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
        bookingOrigin: origin || source || "unknown",
        scheduleMode: "arrival_plus_1h",
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
        reviewEmailScheduleMode: "arrival_plus_1h",
        reviewEmailTaskId: bookingId,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      console.log("scheduleWpCardReviewEmail: scheduled", {
        bookingId,
        clientEmail,
        scheduleMode: "arrival_plus_1h",
        scheduledFor: scheduledForDate.toISOString(),
      });
    },
);

exports.processWpCardReviewEmails = onSchedule("every 5 minutes", async () => {
  const db = admin.firestore();
  const nowMs = Date.now();

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

  const transporter = createReviewTransporter();
  let rescheduled = 0;
  let deferred = 0;
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
    const bookingRef = db.collection("bookings").doc(bookingId);
    let expectedScheduleDate = null;
    let bookingExists = false;
    try {
      const bookingSnap = await bookingRef.get();
      const bookingData = bookingSnap.exists ? (bookingSnap.data() || {}) : {};
      if (bookingSnap.exists) {
        bookingExists = true;
        expectedScheduleDate = getReviewArrivalScheduleDate(bookingData);
      }
    } catch (bookingErr) {
      console.error("processWpCardReviewEmails: booking read failed", {
        bookingId,
        error: bookingErr instanceof Error ?
          bookingErr.message :
          String(bookingErr),
      });
    }

    if (!bookingExists) {
      await taskRef.set({
        status: "failed",
        lastError: "Missing booking for arrival_plus_1h schedule",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      failed += 1;
      continue;
    }

    if (!expectedScheduleDate) {
      await taskRef.set({
        status: "failed",
        lastError:
          "Missing or invalid startDate/startTime for arrival_plus_1h",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      await bookingRef.set({
        reviewEmailStatus: "schedule_failed",
        reviewEmailLastError:
          "Missing or invalid startDate/startTime for review email",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      failed += 1;
      continue;
    }

    const currentScheduledFor = getDateFromTimestamp(task.scheduledFor);
    const shouldReschedule =
      !currentScheduledFor ||
      Math.abs(
          currentScheduledFor.getTime() - expectedScheduleDate.getTime(),
      ) > 60 * 1000;

    if (shouldReschedule) {
      const expectedScheduledForTs =
        admin.firestore.Timestamp.fromDate(expectedScheduleDate);

      await taskRef.set({
        scheduledFor: expectedScheduledForTs,
        scheduleMode: "arrival_plus_1h",
        lastRescheduledAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRescheduleReason: "arrival_plus_1h_recalc",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      await bookingRef.set({
        reviewEmailStatus: "scheduled",
        reviewEmailScheduledAt: expectedScheduledForTs,
        reviewEmailScheduleMode: "arrival_plus_1h",
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});

      rescheduled += 1;
      console.log("processWpCardReviewEmails: task rescheduled", {
        bookingId,
        scheduleMode: "arrival_plus_1h",
        scheduledFor: expectedScheduleDate.toISOString(),
      });
    }

    if (expectedScheduleDate.getTime() > nowMs) {
      deferred += 1;
      continue;
    }

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
      const result = await sendReviewEmail({
        clientEmail,
        clientName,
        transporter,
      });

      await taskRef.set({
        status: "completed",
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        messageId: result.messageId,
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
    rescheduled,
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
