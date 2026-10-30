import "server-only"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { BookingCancellationError, prepareAdminCancellation, releaseAdminCancellation } from "./admin-booking-cancellation"
import { reverseBookingLoyalty } from "./booking-loyalty-reversal"
import { getLprPresenceState, lprTimestampToMillis } from "./lpr-presence"
import { normalizeLicensePlate } from "./utils"
import { lprTransaction, lprLog } from "./lpr-log.server"
import { lprOccupancyDelta } from "./lpr-occupancy-transition"
import { lprExitConflict } from "./lpr-exit-evidence"
import { isTrustedLprReceipt } from "./lpr-entry-evidence"
import { bookingLprTimes, compareLprTimes, lprTime, normalizeLprEventType, receiptLprTime, romaniaCivilClock } from "./lpr-time"
import type { BookingDeletionContext, BookingDeletionInput } from "./booking-deletion-contract"

const changed = () => new BookingCancellationError("Datele s-au schimbat. Reîncarcă și verifică șederea înainte de ștergere.", 409, "CONTEXT_CHANGED")
const review = "Necesită verificare ADMIN: există duplicate, o ședere mai nouă sau evidențe contradictorii. Rezervarea nu a fost ștearsă."
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const stamp = (d: FirebaseFirestore.DocumentSnapshot) => [d.id, d.updateTime?.seconds ?? null, d.updateTime?.nanoseconds ?? null]
const text = (v: unknown) => typeof v === "string" ? v : null

async function readContext(tx: FirebaseFirestore.Transaction, id: string, existing?: FirebaseFirestore.DocumentSnapshot, ownedToken?: string) {
  const ref = adminDb.collection("bookings").doc(id)
  const snap = existing || await tx.get(ref)
  if (!snap.exists) throw new BookingCancellationError("Rezervarea nu mai există.", 404, "NOT_FOUND")
  const b = snap.data()!, plate = normalizeLicensePlate(String(b.licensePlate || ""))
  const inside = getLprPresenceState(b).isEffectivelyInside
  const [open, pointer, receipts, history] = plate ? await Promise.all([
    tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true)),
    tx.get(adminDb.collection("lpr_plate_state").doc(plate)),
    tx.get(adminDb.collection("lpr_events").where("normalizedPlate", "==", plate)),
    tx.get(adminDb.collection("bookings").where("licensePlate", "==", plate)),
  ]) : [null, null, null, null]
  const others = (open?.docs || []).filter(d => d.id !== id && normalizeLicensePlate(String(d.data().licensePlate || "")) === plate)
  const state = pointer?.data(), lpr = b.lpr || {}
  let blocked = b.lpr?.isInside === true && !inside || inside && !plate ||
    !!b.modificationApplying || others.length > 1 || Number(b.adminCancellation?.expiresAt) > Date.now() && b.adminCancellation?.token !== ownedToken
  // A selected closed record may be deleted while another visit exists; it never
  // changes that other visit's pointer. An open record requires unambiguous ownership.
  if (inside) {
    blocked ||= others.length > 0 || !!state && (state.bookingId !== id ||
      (state.visitId ?? null) !== (lpr.visitId ?? null) || state.isInside !== true)
    const now = new Date(), point = lprTime(romaniaCivilClock(now), now.toISOString())
    blocked ||= bookingLprTimes(b).some(known => {
      const order = compareLprTimes(point, known)
      return order === null || order === -1
    })
    blocked ||= !!lprExitConflict({ bookingId: id, booking: b, state, receipts: (receipts?.docs || []).map(d => d.data()), at: point, manual: true })
    const arrival = lprTime(lpr.arrivedAt, lpr.arrivedAtInstant)
    const lastEntry = normalizeLprEventType(lpr.lastEventType) === "entry" ? lprTime(lpr.lastSeenAt, lpr.lastSeenAtInstant) : arrival
    // The current entry may be newer than a legacy arrivedAt. Compare against the
    // latest known entry, never against the reservation's planned dates.
    const boundary = lprTimestampToMillis(lpr.lastSeenAt) !== null ? lastEntry : arrival
    for (const d of receipts?.docs || []) {
      const r = d.data()
      if (normalizeLprEventType(r.eventType) !== "entry" || !isTrustedLprReceipt(r)) continue
      const ownVisit = r.matchedBookingId === id && (r.visitId ?? null) === (lpr.visitId ?? null)
      if (ownVisit && !["pending", "needs_review", "reviewed"].includes(r.associationStatus)) continue
      if (lprTimestampToMillis(boundary.wall) === null || compareLprTimes(receiptLprTime(r), boundary) !== -1) blocked = true
    }
    for (const d of history?.docs || []) {
      if (d.id === id) continue
      if (bookingLprTimes(d.data()).some(point => lprTimestampToMillis(boundary.wall) === null || compareLprTimes(point, boundary) !== -1)) blocked = true
    }
  } else if (state?.bookingId === id && state.isInside === true) blocked = true
  // Our own cancellation lock changes during the external call. Exclude only
  // that coordination metadata, retaining all business/LPR fields and other reads.
  const { adminCancellation: _coordination, ...business } = b
  const version = hash({ business, open: (open?.docs || []).filter(d => d.id !== id && normalizeLicensePlate(String(d.data().licensePlate || "")) === plate).map(stamp).sort(),
    pointer: pointer ? stamp(pointer) : null, receipts: (receipts?.docs || []).map(stamp).sort(),
    history: (history?.docs || []).filter(d => d.id !== id).map(stamp).sort() })
  const context: BookingDeletionContext = { booking: { id, licensePlate: String(b.licensePlate || "N/A"), startDate: text(b.startDate), startTime: text(b.startTime), endDate: text(b.endDate), endTime: text(b.endTime) },
    version, inside, blockedReason: blocked ? review : null }
  return { ref, b, plate, context, pointer }
}

export async function prepareBookingDeletion(id: string) {
  return lprTransaction(adminDb, async tx => (await readContext(tx, id)).context)
}

export async function saveBookingDeletion(input: BookingDeletionInput, actor: { uid: string; email: string | null }) {
  if (typeof input.requestId !== "string" || typeof input.version !== "string" ||
      !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.version)) {
    throw new BookingCancellationError("Context de ștergere invalid. Reîncarcă verificarea.", 400, "INVALID_REQUEST")
  }
  const archiveRef = adminDb.collection("deleted_bookings").doc(input.bookingId)
  const fingerprint = hash({ ...input, confirmNotPresent: input.confirmNotPresent === true, actor: actor.uid })
  const replay = (data: FirebaseFirestore.DocumentData | undefined) => {
    if (data?.deletionOperation?.requestId !== input.requestId) return null
    if (data.deletionOperation.fingerprint !== fingerprint) throw new BookingCancellationError("Identificatorul ștergerii a fost deja folosit.", 409, "REQUEST_REUSED")
    return data.deletionOperation.result
  }
  const previous = replay((await archiveRef.get()).data())
  if (previous) return previous
  const validate = (context: BookingDeletionContext) => {
    if (context.version !== input.version) throw changed()
    if (context.blockedReason) throw new BookingCancellationError(context.blockedReason, 409, "DELETE_REQUIRES_REVIEW")
    if (context.inside && input.confirmNotPresent !== true) throw new BookingCancellationError("Confirmă că mașina nu mai este fizic în parcare.", 400, "CONFIRM_NOT_PRESENT")
  }
  let prepared: Awaited<ReturnType<typeof prepareAdminCancellation>> | undefined
  try {
    prepared = await prepareAdminCancellation(input.bookingId, { validate: async (tx, snap) => {
      validate((await readContext(tx, input.bookingId, snap)).context)
    } })
    const reservation = prepared
    return await lprTransaction(adminDb, async tx => {
      const archived = await tx.get(archiveRef)
      const repeated = replay(archived.data())
      if (repeated) return repeated
      const ctx = await readContext(tx, input.bookingId, undefined, reservation.token)
      // Ignore only the lock owned by this request; other ownership never permits deletion.
      if (ctx.b.adminCancellation?.token !== reservation.token) throw changed()
      validate(ctx.context)
      const loyalty = await reverseBookingLoyalty(tx, ctx.b)
      const now = new Date(), at = romaniaCivilClock(now), instant = now.toISOString()
      const delta = lprOccupancyDelta(ctx.b, "exit")
      const eventId = `delete_absence_${input.requestId}`
      const correction = ctx.context.inside ? { type: "confirmed_absent", label: "Corecție manuală: mașina confirmată absentă", at, instant, adminUid: actor.uid, eventId, visitId: ctx.b.lpr?.visitId ?? null } : null
      const result = { success: true, decremented: delta === -1, presenceCorrected: !!correction,
        loyaltyStatus: loyalty.status, loyalty: loyalty.impact, multiparkCancelled: reservation.multiparkCancelled, multiparkAttempted: reservation.multiparkAttempted }
      if (correction) {
        const audit = { eventType: "presence_correction", presenceAfter: false, normalizedPlate: ctx.plate,
          matchedBookingId: ctx.ref.id, visitId: correction.visitId, eventTime: at, eventInstant: instant,
          deviceId: "manual_admin", manual: true, adminUid: actor.uid, associationStatus: "manual",
          correction, previousLpr: ctx.b.lpr || null, occupancyDelta: delta, receivedAt: FieldValue.serverTimestamp() }
        tx.create(adminDb.collection("lpr_events").doc(eventId), audit)
        tx.set(ctx.ref.collection("gateEvents").doc(eventId), { ...audit, lprEventId: eventId })
        // Keep a closed ordering boundary even when the booking is archived.
        // This timestamp means "confirmed absent at", never a claimed departure.
        tx.set(adminDb.collection("lpr_plate_state").doc(ctx.plate), {
          bookingId: ctx.ref.id, visitId: correction.visitId, isInside: false, lastEventType: "presence_correction",
          lastEventAt: at, lastEventAtInstant: instant, lastEventId: eventId, lastDeviceId: "manual_admin",
          presenceCorrection: correction, archivedBookingId: ctx.ref.id, updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      }
      if (delta === -1) tx.set(adminDb.collection("config").doc("parkingLive"), {
        occupiedCount: FieldValue.increment(-1), lastUpdated: FieldValue.serverTimestamp(),
        lastChange: { type: "absence_correction_delete", bookingId: ctx.ref.id, plateNumber: ctx.plate, adminUid: actor.uid, at },
      }, { merge: true })
      tx.set(archiveRef, { ...ctx.b, ...(loyalty.record ? { loyaltyRecord: loyalty.record } : {}),
        ...(correction ? { lpr: { ...ctx.b.lpr, isInside: false, presenceCorrection: correction },
          ...(delta === -1 ? { occupancyDecremented: true, occupancyDecrementedAt: FieldValue.serverTimestamp() } : {}) } : {}),
        originalBookingId: ctx.ref.id, deletedAt: FieldValue.serverTimestamp(), deletedByUid: actor.uid, deletedReason: "admin_delete",
        deletionOperation: { requestId: input.requestId, fingerprint, confirmedNotPresent: input.confirmNotPresent === true, result },
      })
      tx.delete(ctx.ref)
      lprLog("booking_deleted", { bookingId: ctx.ref.id, plate: ctx.plate, actorUid: actor.uid, eventId: correction ? eventId : undefined,
        outcome: "committed", insideBefore: ctx.context.inside, insideAfter: false, occupancyDelta: delta })
      return result
    })
  } catch (error) {
    if (prepared) await releaseAdminCancellation(prepared.ref, prepared.token).catch(console.error)
    // A competing identical request may have committed while we waited for its lock.
    const done = replay((await archiveRef.get()).data())
    if (done) return done
    throw error
  }
}
