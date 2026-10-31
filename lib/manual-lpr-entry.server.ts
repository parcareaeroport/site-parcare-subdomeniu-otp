import { lprTransaction, lprLog } from "@/lib/lpr-log.server"
import "server-only"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import { normalizeLicensePlate } from "@/lib/utils"
import { isBeforePlateCorrection, isLaterKnownExit } from "@/lib/lpr-entry-evidence"
import { lprExitConflict } from "@/lib/lpr-exit-evidence"
import { writeLprVisit, correctLprArrival } from "@/lib/lpr-visit.server"
import { inLprBookingWindow, LPR_ACTIVE_STATUSES } from "@/lib/lpr-booking-window"
import { ManualExitError, manualExitClock, manualLprInstant, parseManualExitClock, readManualLprContext } from "@/lib/manual-lpr-exit.server"
import { bookingLprTimes, compareLprTimes, lprTime, type LprTime } from "./lpr-time"
import type { ManualExitSaveInput } from "@/lib/manual-lpr-exit-contract"

type Actor = { uid: string; email: string | null }
function fail(code: string, message: string): never { throw new ManualExitError(code, message, 409) }
function checkEntry(booking: any, at: string, now: string, history: LprTime[], instant: string, nowInstant: string) {
  const point = lprTime(at, instant)
  if (compareLprTimes(point, lprTime(now, nowInstant), 1000) === 1) fail("FUTURE_ENTRY", "Intrarea nu poate fi în viitor. Introdu ora sosirii reale.")
  const orders = history.map(p => compareLprTimes(point, p, 1000))
  if (orders.includes(null)) fail("AMBIGUOUS_TIME", "Ordinea evenimentelor nu poate fi verificată la schimbarea orei. Necesită verificare ADMIN.")
  if (orders.includes(-1)) fail("ENTRY_BEFORE_EVENT", "Există un eveniment mai recent. Reîncarcă și verifică șederea înainte de a modifica intrarea.")
  if (!getLprPresenceState(booking).isEffectivelyInside) {
    if (booking.status !== "unmatched_lpr" && !LPR_ACTIVE_STATUSES.includes(booking.status)) fail("INACTIVE_BOOKING", "Rezervarea nu este activă. Verifică rezervarea corectă pentru această intrare.")
    if (booking.status !== "unmatched_lpr" && !inLprBookingWindow(booking, Date.parse(at))) fail("ENTRY_OUTSIDE_PERIOD", "Intrarea nu corespunde perioadei rezervării. Selectează rezervarea corectă sau corectează perioada.")
  }
}
async function validatePlateEvidence(tx: FirebaseFirestore.Transaction, plate: string, state: any, booking: any, at: string, now: string, newVisit: boolean, instant: string, nowInstant: string) {
  const eventMs = Date.parse(at)
  if (isBeforePlateCorrection(state, eventMs, lprTime(at, instant))) fail("PLATE_CORRECTED", "Necesită verificare ADMIN: numărul a fost corectat pentru această ședere. Selectează numărul și rezervarea corecte.")
  const [history, receipts] = await Promise.all([
    tx.get(adminDb.collection("bookings").where("licensePlate", "==", plate)),
    tx.get(adminDb.collection("lpr_events").where("normalizedPlate", "==", plate)),
  ])
  // Unlike automatic queue recovery, an operator must resolve a contradictory
  // pending exit before declaring an earlier arrival as a new physical presence.
  if (receipts.docs.some(d => isLaterKnownExit(d.data(), eventMs, Date.parse(now), true, lprTime(at, instant), lprTime(now, nowInstant)))) {
    fail("LATER_EXIT", "Necesită verificare ADMIN: există o ieșire primită la aceeași oră sau după intrarea indicată. Verifică evenimentele LPR înainte de salvare.")
  }
  const bookings = [booking, ...history.docs.map(d => d.data())]
  const departures = bookings.filter(b => lprTimestampToMillis(b.lpr?.departedAt) !== null).map(b => lprTime(b.lpr.departedAt, b.lpr.departedAtInstant))
  if (newVisit && departures.some(p => compareLprTimes(lprTime(at, instant), p, 1000) === 0)) {
    fail("AMBIGUOUS_REENTRY", "Intrarea și ieșirea anterioară sunt în aceeași secundă. Verifică ora reintrării reale.")
  }
  return [...(lprTimestampToMillis(state?.lastEventAt) !== null ? [lprTime(state.lastEventAt, state.lastEventAtInstant)] : []), ...bookings.flatMap(bookingLprTimes)]
}
function auditEntry(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, eventRef: FirebaseFirestore.DocumentReference, plate: string, at: string, visitId: string | null, actor: Actor, extra: Record<string, unknown> = {}) {
  const audit = { matchedBookingId: ref.id, plateNumber: plate, normalizedPlate: plate, eventType: "entry", visitId,
    deviceId: "manual_admin", direction: "manual", eventTime: at, snapTime: at, accurateTime: at, manual: true, adminUid: actor.uid, adminEmail: actor.email }
  tx.set(eventRef, { ...audit, associationStatus: "manual", receivedAt: FieldValue.serverTimestamp(), ...extra })
  tx.set(ref.collection("gateEvents").doc(eventRef.id), { ...audit, ...extra, lprEventId: eventRef.id, createdAt: FieldValue.serverTimestamp() })
}
// Reuse an unmatched camera stay, never manufacture a second physical entry.
// The version includes the source, plate pointer and receipts, so camera/manual
// changes invalidate the confirmation and concurrent associations serialize.
function associationCandidate(ctx: Awaited<ReturnType<typeof readManualLprContext>>) {
  if (ctx.context.inside || ctx.context.hasPreviousVisit || ctx.context.duplicates.length !== 1 ||
    ctx.b.modificationApplying || !LPR_ACTIVE_STATUSES.includes(ctx.b.status)) return null
  const id = ctx.context.duplicates[0].id
  const source = ctx.history.docs.find(d => d.id === id) || (ctx.linked?.id === id ? ctx.linked : null)
  const b = source?.data(), pointer = ctx.state.data()
  if (!source || !b || b.status !== "unmatched_lpr" || b.modificationApplying ||
    !getLprPresenceState(b).isEffectivelyInside || !b.lpr?.visitId || !b.lpr?.arrivedAt ||
    pointer?.bookingId !== id || pointer?.visitId !== b.lpr.visitId || pointer?.isInside !== true ||
    lprTimestampToMillis(b.lpr.arrivedAt) === null ||
    !inLprBookingWindow(ctx.b, Date.parse(manualExitClock()))) return null
  return { source, b, bookingId: id, arrival: new Date(lprTimestampToMillis(b.lpr.arrivedAt)!).toISOString(),
    outsidePeriod: !inLprBookingWindow(ctx.b, lprTimestampToMillis(b.lpr.arrivedAt)!) }
}
export async function prepareManualEntry(bookingId: string) {
  return lprTransaction(adminDb, async tx => {
    const ctx = await readManualLprContext(tx, bookingId), candidate = associationCandidate(ctx)
    return { ...ctx.context, association: candidate ? { bookingId: candidate.bookingId, arrival: candidate.arrival, outsidePeriod: candidate.outsidePeriod } : null }
  })
}
export async function saveManualEntry(input: ManualExitSaveInput, actor: Actor) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId || "")) fail("INVALID_REQUEST", "Identificator de salvare invalid.")
  const eventRef = adminDb.collection("lpr_events").doc(`manual_entry_${input.requestId}`)
  const fingerprint = createHash("sha256").update(JSON.stringify({ bookingId: input.bookingId, version: input.version, actor: actor.uid,
    now: input.useServerNow === true, date: input.useServerNow === true ? null : input.date, time: input.useServerNow === true ? null : input.time, overwrite: input.confirmOverwrite === true, entryMode: input.entryMode, reentry: input.confirmReentry === true,
    ...(input.entryMode === "associate_visit" ? { association: input.confirmAssociation === true } : {}) })).digest("hex")
  return lprTransaction(adminDb, async tx => {
    const receipt = await tx.get(eventRef)
    if (receipt.exists) {
      if (receipt.data()?.requestFingerprint !== fingerprint) fail("REQUEST_REUSED", "Identificatorul salvării a fost deja folosit.")
      lprLog("manual_replay",{eventId:eventRef.id,bookingId:input.bookingId,replayed:true,occupancyDelta:0,outcome:"duplicate"})
      return receipt.data()!.result
    }
    const ctx = await readManualLprContext(tx, input.bookingId)
    const { ref, b, plate, context, state } = ctx
    if (context.version !== input.version) fail("CONTEXT_CHANGED", "Datele s-au schimbat. Reîncarcă și verifică șederea înainte de salvare.")
    if (input.entryMode === "associate_visit") {
      const candidate = associationCandidate(ctx)
      if (!candidate) fail("ASSOCIATION_UNAVAILABLE", "Șederea nu poate fi asociată automat. Reîncarcă și verifică rezervarea și înregistrările prezente.")
      if (input.confirmAssociation !== true) fail("CONFIRM_ASSOCIATION", "Confirmă că șederea LPR existentă aparține acestei rezervări.")
      const realNow = new Date(), now = manualExitClock(realNow), instant = manualLprInstant(now, true, realNow)
      const source = candidate.b, visitId = source.lpr.visitId
      const conflict = lprExitConflict({ bookingId: candidate.bookingId, booking: source,
        state: state.data(), receipts: ctx.receipts.docs.map(d => d.data()), at: lprTime(now, instant), manual: true })
      if (conflict || ctx.receipts.docs.some(d => isLaterKnownExit(d.data(), Date.parse(candidate.arrival), Date.parse(now), true))) {
        fail("ASSOCIATION_REQUIRES_REVIEW", "Există evenimente LPR contradictorii. Verifică prezența și succesiunea intrărilor/ieșirilor înainte de asociere.")
      }
      // Transfer the accounting responsibility as well as the physical stay,
      // without inventing a camera departure or a second physical entry.
      const related = ctx.receipts.docs.filter(d => d.data().matchedBookingId === candidate.bookingId && d.data().visitId === visitId)
      const gateEvents = await tx.get(candidate.source.ref.collection("gateEvents").where("visitId", "==", visitId))
      if (related.length + gateEvents.size > 400) fail("ASSOCIATION_REQUIRES_REVIEW", "Șederea are prea multe evenimente pentru asocierea directă. Necesită verificarea istoricului.")
      const accounting = { occupancyIncremented: true, occupancyDecremented: false,
        occupancyIncrementedAt: source.occupancyIncrementedAt || null, occupancyDecrementedAt: source.occupancyDecrementedAt || null }
      tx.update(ref, { lpr: { ...source.lpr, associatedFromBookingId: candidate.bookingId }, ...accounting, lastUpdated: FieldValue.serverTimestamp() })
      tx.update(candidate.source.ref, { "lpr.isInside": false, "lpr.associatedToBookingId": ref.id,
        occupancyIncremented: false, occupancyDecremented: false, lastUpdated: FieldValue.serverTimestamp() })
      tx.set(ctx.stateRef, { bookingId: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      // The physical count stays identical. Reconcile the derived cache from the
      // same transactional effective-presence snapshot used by Occupancy, rather
      // than guessing from legacy per-reservation accounting flags.
      tx.set(adminDb.collection("config").doc("parkingLive"), {
        occupiedCount: ctx.effectiveInsideCount, lastUpdated: FieldValue.serverTimestamp(),
        lastChange: { type: "visit_association", bookingId: ref.id, sourceBookingId: candidate.bookingId, adminUid: actor.uid, count: ctx.effectiveInsideCount },
      }, { merge: true })
      // Retain camera payloads and original linkage; update their operational
      // association so same-second exits/replays still refer to the same visit.
      for (const receipt of related) {
        tx.update(receipt.ref, { matchedBookingId: ref.id, originalMatchedBookingId: receipt.data().originalMatchedBookingId || candidate.bookingId,
          associatedByUid: actor.uid, associatedAt: FieldValue.serverTimestamp() })
      }
      for (const gate of gateEvents.docs) tx.set(ref.collection("gateEvents").doc(gate.id), {
        ...gate.data(), matchedBookingId: ref.id, originalMatchedBookingId: candidate.bookingId,
        associatedByUid: actor.uid, associatedAt: FieldValue.serverTimestamp(),
      })
      const result = { visitId, occupancyChanged: "none", associatedFromBookingId: candidate.bookingId, lprEventId: eventRef.id }
      const audit = { eventType: "visit_association", matchedBookingId: ref.id, sourceBookingId: candidate.bookingId, normalizedPlate: plate,
        plateNumber: plate, visitId, eventTime: now, eventInstant: instant, manual: true, adminUid: actor.uid, adminEmail: actor.email,
        associationStatus: "manual", confirmed: true, outsidePeriod: candidate.outsidePeriod, requestFingerprint: fingerprint, result, receivedAt: FieldValue.serverTimestamp() }
      tx.create(eventRef, audit)
      tx.create(ref.collection("gateEvents").doc(eventRef.id), audit)
      tx.create(candidate.source.ref.collection("gateEvents").doc(eventRef.id), audit)
      return result
    }
    if (context.duplicates.length) fail("DUPLICATE_PRESENCE", "Necesită verificare ADMIN: numărul este deja prezent pe altă rezervare. Intrarea nu a fost salvată.")
    const expectedMode = context.inside ? "correct_arrival" : "new_visit"
    if (input.entryMode !== expectedMode) fail("ENTRY_MODE_REQUIRED", context.inside
      ? "Mașina este deja prezentă. Folosește corectarea orei intrării, fără o ședere nouă."
      : "Pentru o mașină absentă trebuie confirmată o intrare nouă. Corectarea orei nu poate redeschide șederea.")
    if (!context.inside && context.hasPreviousVisit && input.confirmReentry !== true) fail("CONFIRM_REENTRY", "Confirmă că mașina a reintrat fizic. O intrare nouă va ocupa un loc.")
    if (context.inside && input.confirmOverwrite !== true) fail("CONFIRM_OVERWRITE", "Confirmă modificarea intrării existente.")
    const realNow = new Date(), now = manualExitClock(realNow), nowInstant = manualLprInstant(now, true, realNow)
    let at = now
    if (input.useServerNow !== true) {
      try { at = parseManualExitClock(input.date, input.time) }
      catch { throw new ManualExitError("INVALID_TIME", "Completează o dată și o oră valide pentru sosirea reală.") }
    }
    const instant = manualLprInstant(at, input.useServerNow === true, realNow)
    const latest = await validatePlateEvidence(tx, plate, state.data(), b, at, now, !context.inside, instant, nowInstant)
    checkEntry(b, at, now, latest, instant, nowInstant)
    if (context.inside && !getLprPresenceState({ ...b, lpr: { ...b.lpr, arrivedAt: at } }).isEffectivelyInside) {
      fail("AMBIGUOUS_CORRECTION", "Necesită verificare ADMIN: ora corectată contrazice ieșirea din evidență. Prezența nu a fost modificată.")
    }
    const visitId = context.inside ? b.lpr?.visitId || null : eventRef.id
    const result = { lprEventId: eventRef.id, gateEventId: eventRef.id,
      ...(context.inside ? correctLprArrival(tx, ref, b, at, actor, instant) : writeLprVisit(tx, adminDb, { ref, data: b, plate, at, instant, eventType: "entry", eventId: eventRef.id, visitId,
        deviceId: "manual_admin", manual: true, actor, lprExtra: { lastEventAccurateTime: at } })) }
    auditEntry(tx, ref, eventRef, plate, at, visitId, actor, { eventInstant: instant, requestFingerprint: fingerprint, result, eventType: context.inside ? "arrival_correction" : "entry", entryMode: input.entryMode,
      previousLpr: b.lpr || null, confirmations: { overwrite: input.confirmOverwrite === true, reentry: input.confirmReentry === true } })
    return result
  })
}

/** Creation and presence are one transaction, before any external Multipark call.
 * The shared plate document serializes this with camera and other admin entries.
 */
export async function createManualBookingRecord(data: Record<string, any>, inside: boolean, actor: Actor) {
  if (typeof inside !== "boolean") fail("PRESENCE_REQUIRED", "Alege explicit dacă mașina este în parcare sau este doar o rezervare.")
  const plate = normalizeLicensePlate(String(data.licensePlate || ""))
  if (!plate) fail("MISSING_PLATE", "Numărul de înmatriculare este obligatoriu.")
  const ref = adminDb.collection("bookings").doc(), eventRef = adminDb.collection("lpr_events").doc()
  return lprTransaction(adminDb, async tx => {
    if (!inside) { tx.create(ref, { ...data, licensePlate: plate }); return ref }
    const stateRef = adminDb.collection("lpr_plate_state").doc(plate)
    const [state, open] = await Promise.all([tx.get(stateRef), tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true))])
    if (open.docs.some(d => normalizeLicensePlate(String(d.data().licensePlate || "")) === plate && getLprPresenceState(d.data()).isEffectivelyInside)) fail("DUPLICATE_PRESENCE", "Necesită verificare ADMIN: acest număr este deja în parcare. Rezervarea nu a fost creată; verifică înregistrarea existentă.")
    const realNow = new Date(), at = manualExitClock(realNow), instant = manualLprInstant(at, true, realNow), latest = await validatePlateEvidence(tx, plate, state.data(), {}, at, at, true, instant, instant)
    checkEntry(data, at, at, latest, instant, instant)
    writeLprVisit(tx, adminDb, { ref, data: {}, plate, at, instant, eventType: "entry", eventId: eventRef.id, visitId: eventRef.id,
      deviceId: "manual_admin", manual: true, actor, create: true, patch: { ...data, licensePlate: plate }, lprExtra: { lastEventAccurateTime: at } })
    auditEntry(tx, ref, eventRef, plate, at, eventRef.id, actor, { eventInstant: instant })
    return ref
  })
}
