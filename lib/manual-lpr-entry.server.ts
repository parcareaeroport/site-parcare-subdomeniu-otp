import "server-only"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import { normalizeLicensePlate } from "@/lib/utils"
import { writeLprVisit } from "@/lib/lpr-visit.server"
import { inLprBookingWindow, LPR_ACTIVE_STATUSES } from "@/lib/lpr-booking-window"
import { ManualExitError, manualExitClock, parseManualExitClock, readManualLprContext } from "@/lib/manual-lpr-exit.server"
import type { ManualExitSaveInput } from "@/lib/manual-lpr-exit-contract"

type Actor = { uid: string; email: string | null }
const fail = (code: string, message: string) => { throw new ManualExitError(code, message, 409) }
function checkEntry(booking: any, at: string, now: string, latest: number | null) {
  if (at > now) fail("FUTURE_ENTRY", "Intrarea nu poate fi în viitor. Introdu ora sosirii reale.")
  if (latest !== null && Math.floor(Date.parse(at) / 1000) < Math.floor(latest / 1000)) fail("ENTRY_BEFORE_EVENT", "Există un eveniment mai recent. Reîncarcă și verifică șederea înainte de a modifica intrarea.")
  if (!getLprPresenceState(booking).isEffectivelyInside) {
    if (booking.status !== "unmatched_lpr" && !LPR_ACTIVE_STATUSES.includes(booking.status)) fail("INACTIVE_BOOKING", "Rezervarea nu este activă. Verifică rezervarea corectă pentru această intrare.")
    if (booking.status !== "unmatched_lpr" && !inLprBookingWindow(booking, Date.parse(at))) fail("ENTRY_OUTSIDE_PERIOD", "Intrarea nu corespunde perioadei rezervării. Selectează rezervarea corectă sau corectează perioada.")
  }
}
async function latestForPlate(tx: FirebaseFirestore.Transaction, plate: string, state: any, booking: any) {
  const history = await tx.get(adminDb.collection("bookings").where("licensePlate", "==", plate))
  const times = [lprTimestampToMillis(state?.lastEventAt), ...[booking, ...history.docs.map(d => d.data())].flatMap(b => [b.lpr?.arrivedAt, b.lpr?.departedAt, b.lpr?.lastSeenAt].map(lprTimestampToMillis))].filter((n): n is number => n !== null)
  return times.length ? Math.max(...times) : null
}
function auditEntry(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference, eventRef: FirebaseFirestore.DocumentReference, plate: string, at: string, visitId: string, actor: Actor, extra: Record<string, unknown> = {}) {
  const audit = { matchedBookingId: ref.id, plateNumber: plate, normalizedPlate: plate, eventType: "entry", visitId,
    deviceId: "manual_admin", direction: "manual", snapTime: at, accurateTime: at, manual: true, adminUid: actor.uid, adminEmail: actor.email }
  tx.set(eventRef, { ...audit, associationStatus: "manual", receivedAt: FieldValue.serverTimestamp(), ...extra })
  tx.set(ref.collection("gateEvents").doc(eventRef.id), { ...audit, lprEventId: eventRef.id, createdAt: FieldValue.serverTimestamp() })
}
export async function saveManualEntry(input: ManualExitSaveInput, actor: Actor) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId || "")) fail("INVALID_REQUEST", "Identificator de salvare invalid.")
  const eventRef = adminDb.collection("lpr_events").doc(`manual_entry_${input.requestId}`)
  const fingerprint = createHash("sha256").update(JSON.stringify({ bookingId: input.bookingId, version: input.version, actor: actor.uid,
    now: input.useServerNow === true, date: input.useServerNow === true ? null : input.date, time: input.useServerNow === true ? null : input.time, overwrite: input.confirmOverwrite === true })).digest("hex")
  return adminDb.runTransaction(async tx => {
    const receipt = await tx.get(eventRef)
    if (receipt.exists) {
      if (receipt.data()?.requestFingerprint !== fingerprint) fail("REQUEST_REUSED", "Identificatorul salvării a fost deja folosit.")
      return receipt.data()!.result
    }
    const { ref, b, plate, context, state } = await readManualLprContext(tx, input.bookingId)
    if (context.version !== input.version) fail("CONTEXT_CHANGED", "Datele s-au schimbat. Reîncarcă și verifică șederea înainte de salvare.")
    if (context.duplicates.length) fail("DUPLICATE_PRESENCE", "Necesită verificare ADMIN: numărul este deja prezent pe altă rezervare. Intrarea nu a fost salvată.")
    if (context.inside && input.confirmOverwrite !== true) fail("CONFIRM_OVERWRITE", "Confirmă modificarea intrării existente.")
    const now = manualExitClock()
    let at = now
    if (input.useServerNow !== true) {
      try { at = parseManualExitClock(input.date, input.time) }
      catch { throw new ManualExitError("INVALID_TIME", "Completează o dată și o oră valide pentru sosirea reală.") }
    }
    const latest = await latestForPlate(tx, plate, state.data(), b)
    checkEntry(b, at, now, latest)
    const visitId = context.inside ? b.lpr?.visitId || eventRef.id : eventRef.id
    const result = { lprEventId: eventRef.id, gateEventId: eventRef.id,
      ...writeLprVisit(tx, adminDb, { ref, data: b, plate, at, eventType: "entry", eventId: eventRef.id, visitId,
        deviceId: "manual_admin", manual: true, actor, correctArrival: true, lprExtra: { lastEventAccurateTime: at } }) }
    auditEntry(tx, ref, eventRef, plate, at, visitId, actor, { requestFingerprint: fingerprint, result, confirmations: { overwrite: input.confirmOverwrite === true } })
    return result
  })
}

/** Creation and presence are one transaction, before any external Multipark call.
 * The shared plate document serializes this with camera and other admin entries.
 */
export async function createManualBookingRecord(data: Record<string, any>, inside: boolean, actor: Actor) {
  const plate = normalizeLicensePlate(String(data.licensePlate || ""))
  if (!plate) fail("MISSING_PLATE", "Numărul de înmatriculare este obligatoriu.")
  const ref = adminDb.collection("bookings").doc(), eventRef = adminDb.collection("lpr_events").doc()
  return adminDb.runTransaction(async tx => {
    if (!inside) { tx.create(ref, { ...data, licensePlate: plate }); return ref }
    const stateRef = adminDb.collection("lpr_plate_state").doc(plate)
    const [state, open] = await Promise.all([tx.get(stateRef), tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true))])
    if (open.docs.some(d => normalizeLicensePlate(String(d.data().licensePlate || "")) === plate && getLprPresenceState(d.data()).isEffectivelyInside)) fail("DUPLICATE_PRESENCE", "Necesită verificare ADMIN: acest număr este deja în parcare. Rezervarea nu a fost creată; verifică înregistrarea existentă.")
    const at = manualExitClock(), latest = await latestForPlate(tx, plate, state.data(), {})
    checkEntry(data, at, at, latest)
    writeLprVisit(tx, adminDb, { ref, data: {}, plate, at, eventType: "entry", eventId: eventRef.id, visitId: eventRef.id,
      deviceId: "manual_admin", manual: true, actor, create: true, patch: { ...data, licensePlate: plate }, lprExtra: { lastEventAccurateTime: at } })
    auditEntry(tx, ref, eventRef, plate, at, eventRef.id, actor)
    return ref
  })
}
