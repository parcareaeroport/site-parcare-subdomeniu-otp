// Commercial no-show cancellation never writes LPR presence or its counter.
const ACTIVE = [
  "confirmed_pay_on_site", "confirmed", "paid",
  "confirmed_test", "confirmed_paid",
];
/**
 * Return the legacy Romania civil clock, independent of the host timezone.
 * @param {Date} now Physical current instant.
 * @return {string} Civil clock with the existing Z label.
 */
function civilNow(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`;
}
/**
 * Cancel only a fresh, explicitly enabled, unobserved no-show.
 * @param {object} db Admin Firestore.
 * @param {object} ref Candidate booking reference, not a stale snapshot.
 * @param {object} fieldValue Admin FieldValue factory.
 * @param {Date} now Physical current instant.
 * @return {Promise<boolean>} Whether the commercial status changed.
 */
async function cancelNoShow(db, ref, fieldValue, now = new Date()) {
  return db.runTransaction(async (tx) => {
    const [snap, settings] = await Promise.all([
      tx.get(ref), tx.get(db.doc("config/reservationSettings")),
    ]);
    const cfg = settings.data() || {};
    if (!snap.exists || cfg.payOnSiteAutoCancelEnabled !== true) return false;
    const b = snap.data();
    const lpr = b.lpr || {};
    if (b.source !== "pay_on_site" || !ACTIVE.includes(b.status) ||
        b.payOnSiteAutoCancelled || b.payOnSiteStatus === "cancelled" ||
        lpr.isInside || lpr.arrivedAt || lpr.departedAt ||
        lpr.lastSeenAt || lpr.visitId) return false;
    const minutes = Number(cfg.payOnSiteAutoCancelMinutes === undefined ?
      180 : cfg.payOnSiteAutoCancelMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    const time = String(b.startTime || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startDate || "") ||
        !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return false;
    const seconds = time.length === 5 ? time + ":00" : time;
    const start = `${b.startDate}T${seconds}.000Z`;
    if (!Number.isFinite(Date.parse(start)) ||
        new Date(start).toISOString() !== start ||
        Date.parse(civilNow(now)) - Date.parse(start) <= minutes * 60000) {
      return false;
    }
    tx.update(ref, {
      status: "cancelled_pay_on_site_timeout", payOnSiteStatus: "cancelled",
      cancelReason: `Auto-cancel pay_on_site: no-show după ${minutes} minute`,
      payOnSiteAutoCancelled: true,
      payOnSiteAutoCancelledAt: fieldValue.serverTimestamp(),
      lastUpdated: fieldValue.serverTimestamp(),
    });
    return true;
  });
}
module.exports = {cancelNoShow, civilNow, ACTIVE};
