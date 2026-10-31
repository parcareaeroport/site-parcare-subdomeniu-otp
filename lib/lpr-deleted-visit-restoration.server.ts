import "server-only"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { normalizeLicensePlate } from "./utils"
import { getLprPresenceState, lprTimestampToMillis } from "./lpr-presence"
import { LPR_ACTIVE_STATUSES, getLprBookingWindow } from "./lpr-booking-window"
import { linkLprVisit } from "./lpr-visit.server"
import { isLaterKnownExit, isTrustedLprReceipt } from "./lpr-entry-evidence"
import { bookingLprTimes, compareLprTimes, lprTime, receiptLprTime, romaniaCivilClock } from "./lpr-time"
import { ManualExitError, manualExitClock, manualLprInstant, parseManualExitClock, type readManualLprContext } from "./manual-lpr-exit.server"
import type { ManualExitSaveInput } from "./manual-lpr-exit-contract"

type Context = Awaited<ReturnType<typeof readManualLprContext>>
const reject = (message: string) => { throw new ManualExitError("RESTORE_UNAVAILABLE", message, 409) }

/** Recovery of an unmatched stay removed by a mistaken manual absence statement.
 * A real exit, another visit, or an ambiguous pointer never becomes an override.
 */
export async function readDeletedVisitRestoration(tx: FirebaseFirestore.Transaction, ctx: Context) {
  const state = ctx.state.data(), correction = state?.presenceCorrection
  const id = state?.archivedBookingId, eventId = correction?.eventId
  if (ctx.context.inside || ctx.context.hasPreviousVisit || ctx.context.duplicates.length || ctx.b.modificationApplying ||
    !LPR_ACTIVE_STATUSES.includes(ctx.b.status) || !getLprBookingWindow(ctx.b) ||
    state?.isInside !== false || state.lastEventType !== "presence_correction" || correction?.type !== "confirmed_absent" ||
    typeof id !== "string" || !id || id.includes("/") || state.bookingId !== id ||
    typeof eventId !== "string" || !eventId || eventId.includes("/") || state.lastEventId !== eventId) return null
  const absence = ctx.receipts.docs.find(d => d.id === eventId), r = absence?.data()
  if (!absence || !r || r.eventType !== "presence_correction" || r.presenceAfter !== false || r.manual !== true ||
    !isTrustedLprReceipt(r) || r.matchedBookingId !== id || !r.visitId || r.visitId !== state.visitId ||
    !getLprPresenceState({ lpr: r.previousLpr }).isEffectivelyInside) return null
  const archive = await tx.get(adminDb.collection("deleted_bookings").doc(id)), b = archive.data()
  const arrivalMs = lprTimestampToMillis(r.previousLpr?.arrivedAt)
  if (!b || b.status !== "unmatched_lpr" || b.originalBookingId !== id || b.restoredLprToBookingId ||
    normalizeLicensePlate(String(b.licensePlate || "")) !== ctx.plate || b.lpr?.visitId !== r.visitId ||
    b.lpr?.presenceCorrection?.eventId !== eventId || arrivalMs === null) return null
  const arrival = new Date(arrivalMs).toISOString(), point = lprTime(arrival, r.previousLpr.arrivedAtInstant)
  const realNow = new Date(), now = manualExitClock(realNow), nowInstant = manualLprInstant(now, true, realNow)
  if (ctx.receipts.docs.some(d => d.id !== eventId && isLaterKnownExit(d.data(), arrivalMs, Date.parse(now), true, point, lprTime(now, nowInstant)))) return null
  if (ctx.receipts.docs.some(d => {
    const receipt = d.data()
    return receipt.eventType === "entry" && isTrustedLprReceipt(receipt) &&
      !(receipt.matchedBookingId === id && receipt.visitId === r.visitId) && compareLprTimes(receiptLprTime(receipt), point) !== -1
  })) return null
  if (ctx.history.docs.some(d => d.id !== ctx.ref.id && bookingLprTimes(d.data()).some(p => compareLprTimes(p, point) !== -1))) return null
  const version = createHash("sha256").update(JSON.stringify([ctx.context.version, archive.updateTime, eventId])).digest("hex")
  return { archive, absence, previousLpr: r.previousLpr, sourceId: id, visitId: r.visitId as string, arrival,
    correctedAbsentAt: correction.at as string, version }
}

export async function restoreDeletedVisit(tx: FirebaseFirestore.Transaction, ctx: Context, input: ManualExitSaveInput,
  actor: { uid: string; email: string | null }, eventRef: FirebaseFirestore.DocumentReference, fingerprint: string) {
  const candidate = await readDeletedVisitRestoration(tx, ctx)
  if (!candidate) return reject("Șederea nu mai poate fi recuperată în siguranță. Reîncarcă și verifică evenimentele LPR și rezervarea.")
  if (input.useServerNow === true) return reject("Pentru recuperarea șederii introdu ora sosirii originale, nu ora curentă.")
  if (candidate.version !== input.restorationVersion) throw new ManualExitError("CONTEXT_CHANGED", "Istoricul s-a schimbat. Reîncarcă și verifică șederea.", 409)
  const reason = typeof input.restorationReason === "string" ? input.restorationReason.trim() : ""
  if (input.confirmRestoration !== true || reason.length < 5 || reason.length > 1000) throw new ManualExitError("CONFIRM_RESTORATION", "Confirmă prezența și completează motivul rectificării (5–1000 caractere).", 409)
  const at = parseManualExitClock(input.date, input.time), arrivalInstant = manualLprInstant(at)
  const realNow = new Date(), now = romaniaCivilClock(realNow), instant = realNow.toISOString()
  const absence = candidate.absence.data()
  const order = compareLprTimes(lprTime(at, arrivalInstant), receiptLprTime(absence))
  if (order === null || order === 1) return reject("Ora sosirii trebuie să fie înaintea confirmării greșite de absență. O reintrare fizică se înregistrează separat.")
  const point = lprTime(at, arrivalInstant)
  if (ctx.receipts.docs.some(d => d.id !== candidate.absence.id && isLaterKnownExit(d.data(), Date.parse(at), Date.parse(now), true, point, lprTime(now, instant))) ||
    ctx.history.docs.some(d => d.id !== ctx.ref.id && bookingLprTimes(d.data()).some(p => compareLprTimes(p, point) !== -1)) ||
    ctx.receipts.docs.some(d => { const r = d.data(); return r.eventType === "entry" && isTrustedLprReceipt(r) &&
      !(r.matchedBookingId === candidate.sourceId && r.visitId === candidate.visitId) && compareLprTimes(receiptLprTime(r), point) !== -1 })) {
    return reject("Ora introdusă contrazice alte evenimente LPR. Verifică șederea înainte de recuperare.")
  }
  const events = await tx.get(adminDb.collection("bookings").doc(candidate.sourceId).collection("gateEvents").where("visitId", "==", candidate.visitId))
  const linked = ctx.receipts.docs.filter(d => d.id !== candidate.absence.id && d.data().matchedBookingId === candidate.sourceId && d.data().visitId === candidate.visitId)
  if (events.size + linked.length > 400) return reject("Istoricul este prea mare pentru recuperarea directă. Necesită verificare.")
  const audit = { eventType: "presence_correction", presenceAfter: true, associationStatus: "manual", manual: true,
    normalizedPlate: ctx.plate, plateNumber: ctx.plate, matchedBookingId: ctx.ref.id, sourceBookingId: candidate.sourceId,
    visitId: candidate.visitId, eventTime: now, eventInstant: instant, arrival: at, arrivalInstant,
    deviceId: "manual_admin", adminUid: actor.uid, adminEmail: actor.email, reason,
    reversesEventId: candidate.absence.id, previousLpr: ctx.b.lpr || null, receivedAt: FieldValue.serverTimestamp() }
  // Arrival is historical; lastSeen/pointer record the operator's present-time
  // assertion. Delayed camera notifications cannot undo the restored presence.
  const transition = linkLprVisit(tx, adminDb, { target: ctx.ref, source: candidate.archive.ref, sourceKind: "archived",
    sourceData: candidate.archive.data()!, stateRef: ctx.stateRef, state: ctx.state.data()!,
    effectiveInsideCount: ctx.effectiveInsideCount, eventId: eventRef.id, actor,
    lpr: { ...candidate.previousLpr, isInside: true, visitId: candidate.visitId,
    arrivedAt: at, arrivedAtInstant: arrivalInstant, departedAt: null, departedAtInstant: null,
    lastSeenAt: now, lastSeenAtInstant: instant, lastEventType: "entry", lastEventId: eventRef.id,
    lastSeenDeviceId: "manual_admin", lastSeenPlateNumber: ctx.plate, manualOverride: true,
    manualOverrideAt: FieldValue.serverTimestamp(), manualOverrideByUid: actor.uid, manualOverrideByEmail: actor.email,
    associatedFromBookingId: candidate.sourceId, restoredFromEventId: candidate.absence.id } })
  // Supersede only the mistaken absence statement. Deletion, payments and
  // archived booking contents remain historical facts, never resurrected.
  tx.update(candidate.absence.ref, { supersededBy: eventRef.id, rectifiedByUid: actor.uid, rectifiedAt: FieldValue.serverTimestamp(), rectificationReason: reason })
  for (const receipt of linked) tx.update(receipt.ref, { matchedBookingId: ctx.ref.id,
    originalMatchedBookingId: receipt.data().originalMatchedBookingId || candidate.sourceId, associatedByUid: actor.uid, associatedAt: FieldValue.serverTimestamp() })
  for (const event of events.docs) tx.set(ctx.ref.collection("gateEvents").doc(event.id), { ...event.data(),
    matchedBookingId: ctx.ref.id, originalMatchedBookingId: candidate.sourceId, ...(event.id === candidate.absence.id ? { supersededBy: eventRef.id } : {}) })
  const result = { ...transition, lprEventId: eventRef.id, restoredFromBookingId: candidate.sourceId }
  tx.create(eventRef, { ...audit, requestFingerprint: fingerprint, result })
  tx.create(ctx.ref.collection("gateEvents").doc(eventRef.id), audit)
  return result
}
