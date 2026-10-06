"use strict";

const crypto = require("node:crypto");

const REVIEW_SCHEDULE_MODE = "lpr_entry_plus_1h";
const REVIEW_DELAY_MS = 60 * 60 * 1000;

/**
 * Normalize an email used as the permanent review-recipient identity.
 * @param {unknown} email
 * @return {string}
 */
function normalizeReviewEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * Build a deterministic Firestore-safe id without exposing the email in paths.
 * @param {unknown} email
 * @return {string}
 */
function getReviewRecipientId(email) {
  return crypto.createHash("sha256")
      .update(normalizeReviewEmail(email))
      .digest("hex");
}

/**
 * Decide whether a task owns the recipient's single allowed review request.
 * @param {Record<string, unknown>} recipient
 * @param {string} taskId
 * @return {"claim"|"skip_repeat"}
 */
function getReviewRecipientDecision(recipient, taskId) {
  if (recipient.status === "sent") return "skip_repeat";
  const firstTaskId = String(recipient.firstTaskId || "").trim();
  if (firstTaskId && firstTaskId !== taskId) return "skip_repeat";
  return "claim";
}

/**
 * Convert a Firestore timestamp or date-like value to Date.
 * @param {unknown} value
 * @return {Date|null}
 */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const normalized = typeof value === "string" && !value.includes("T") ?
    value.replace(" ", "T") :
    value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Check whether a booking belongs to one of the review-email flows.
 * @param {Record<string, unknown>} booking
 * @return {boolean}
 */
function isEligibleReviewBooking(booking) {
  const origin = String(booking.bookingOrigin || "");
  const source = String(booking.source || "");
  const status = String(booking.status || "");
  const paymentStatus = String(booking.paymentStatus || "");

  return (
    (origin === "wp-card-booking" && paymentStatus === "paid") ||
    (source === "pay_on_site" && status === "confirmed_pay_on_site")
  );
}

/**
 * True only for an automatic LPR entry event.
 * @param {Record<string, unknown>} gateEvent
 * @return {boolean}
 */
function isRealLprEntry(gateEvent) {
  return gateEvent.eventType === "entry" && gateEvent.manual !== true;
}

/**
 * Resolve the event instant, preferring the time recorded on the booking.
 * @param {Record<string, unknown>} booking
 * @param {Record<string, unknown>} gateEvent
 * @return {Date|null}
 */
function getLprEntryDate(booking, gateEvent = {}) {
  const lpr = booking && typeof booking.lpr === "object" ? booking.lpr : {};
  return toDate(lpr.arrivedAt) ||
    toDate(gateEvent.accurateTime) ||
    toDate(gateEvent.snapTime) ||
    toDate(gateEvent.createdAt);
}

/**
 * Add the review delay to the real entry time.
 * @param {Date|null} entryDate
 * @return {Date|null}
 */
function getReviewDueDate(entryDate) {
  if (!entryDate) return null;
  return new Date(entryDate.getTime() + REVIEW_DELAY_MS);
}

/**
 * Check whether a task may be anchored to its first LPR entry.
 * @param {Record<string, unknown>} task
 * @return {boolean}
 */
function canAnchorReviewTask(task) {
  return task.status !== "completed" && !task.lprEntryAt;
}

/**
 * Check whether the task's next scheduled action is due.
 * @param {unknown} scheduledFor
 * @param {Date} now
 * @return {boolean}
 */
function isReviewTaskDue(scheduledFor, now = new Date()) {
  const scheduledDate = toDate(scheduledFor);
  return Boolean(scheduledDate && scheduledDate.getTime() <= now.getTime());
}

/**
 * Accept only tasks anchored by the new automatic LPR entry trigger.
 * @param {Record<string, unknown>} task
 * @return {boolean}
 */
function isTrustedLprReviewTask(task) {
  return task.scheduleMode === REVIEW_SCHEDULE_MODE &&
    Boolean(String(task.lprEntryEventId || "").trim()) &&
    Boolean(toDate(task.lprEntryAt)) &&
    Boolean(toDate(task.reviewDueAt));
}

module.exports = {
  REVIEW_SCHEDULE_MODE,
  canAnchorReviewTask,
  getReviewRecipientDecision,
  getReviewRecipientId,
  getLprEntryDate,
  getReviewDueDate,
  isEligibleReviewBooking,
  isRealLprEntry,
  isReviewTaskDue,
  isTrustedLprReviewTask,
  normalizeReviewEmail,
  toDate,
};
