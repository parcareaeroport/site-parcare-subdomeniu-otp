import "server-only"
import { writeLprVisit } from "@/lib/lpr-visit.server"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import { normalizeLicensePlate } from "@/lib/utils"
import type { ManualExitContext, ManualExitRow, ManualExitSaveInput } from "@/lib/manual-lpr-exit-contract"

export class ManualExitError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}
const changed = () => new ManualExitError("CONTEXT_CHANGED", "Datele s-au schimbat. Reîncarcă și verifică șederea înainte de salvare.", 409)
const validMillis = (v: unknown) => {
  const ms = lprTimestampToMillis(v)
  return ms !== null && Number.isFinite(new Date(ms).getTime()) ? ms : null
}
const iso = (v: unknown) => { const ms = validMillis(v); return ms === null ? null : new Date(ms).toISOString() }
// Legacy camera/manual semantics: Romania civil clock is stored with Z. No historical conversion.
export function manualExitClock(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p => [p.type, p.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`
}
export function parseManualExitClock(date?: string, time?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^\d{2}:\d{2}(:\d{2})?$/.test(time || "")) throw new ManualExitError("INVALID_TIME", "Completează data și ora reală a plecării.")
  const value = `${date}T${time!.length === 5 ? time + ":00" : time}.000Z`
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) throw new ManualExitError("INVALID_TIME", "Data sau ora plecării este invalidă.")
  return value
}
const text = (value: unknown) => typeof value === "string" && value ? value : null
const row = (id: string, b: any): ManualExitRow => ({ id, licensePlate: String(b.licensePlate || ""), startDate: text(b.startDate), startTime: text(b.startTime), endDate: text(b.endDate), endTime: text(b.endTime) })
export async function readManualLprContext(tx: FirebaseFirestore.Transaction, bookingId: string) {
  const ref = adminDb.collection("bookings").doc(bookingId)
  const snap = await tx.get(ref)
  if (!snap.exists) throw new ManualExitError("NOT_FOUND", "Rezervarea nu mai există.", 404)
  const b = snap.data()!, plate = normalizeLicensePlate(String(b.licensePlate || ""))
  if (!plate) throw new ManualExitError("MISSING_PLATE", "Rezervarea nu are un număr valid pentru verificare.")
  const stateRef = adminDb.collection("lpr_plate_state").doc(plate)
  // Same legacy normalization support as the camera matcher. Query is read inside the transaction.
  const [insideSnap, state] = await Promise.all([
    tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true)), tx.get(stateRef),
  ])
  const open = insideSnap.docs.filter(d => normalizeLicensePlate(String(d.data().licensePlate || "")) === plate && getLprPresenceState(d.data()).isEffectivelyInside).sort((a, b) => a.id.localeCompare(b.id))
  const lpr = b.lpr || {}, inside = getLprPresenceState(b).isEffectivelyInside
  const arrived = validMillis(lpr.arrivedAt), departed = validMillis(lpr.departedAt)
  const lastEntry = String(lpr.lastEventType || "").toLowerCase().includes("entry") ? validMillis(lpr.lastSeenAt) : null
  // Legacy reopened documents retain the previous visit's arrivedAt/departedAt.
  const arrivalMs = inside && departed !== null && lastEntry !== null && lastEntry > departed && (arrived === null || arrived <= departed) ? lastEntry : arrived
  const version = createHash("sha256").update(JSON.stringify({
    id: snap.id, version: snap.updateTime?.toDate().toISOString(), nanos: snap.updateTime?.nanoseconds,
    open: open.map(d => [d.id, d.updateTime?.seconds, d.updateTime?.nanoseconds]),
    pointer: [state.updateTime?.seconds, state.updateTime?.nanoseconds],
  })).digest("hex")
  const context: ManualExitContext = {
    booking: row(snap.id, b), version, serverNow: manualExitClock(),
    arrival: arrivalMs === null ? null : new Date(arrivalMs).toISOString(),
    departure: iso(lpr.departedAt), inside,
    duplicates: open.length > 1 ? open.map(d => row(d.id, d.data())) : open.filter(d => d.id !== snap.id).map(d => row(d.id, d.data())),
  }
  return { ref, b, plate, context, state, stateRef }
}
export async function prepareManualExit(bookingId: string) {
  return adminDb.runTransaction(async tx => (await readManualLprContext(tx, bookingId)).context)
}
export async function saveManualExit(input: ManualExitSaveInput, actor: { uid: string; email: string | null }) {
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId || "")) throw new ManualExitError("INVALID_REQUEST", "Identificator de salvare invalid.")
  const eventRef = adminDb.collection("lpr_events").doc(`manual_exit_${input.requestId}`)
  const fingerprint = createHash("sha256").update(JSON.stringify({
    bookingId: input.bookingId, version: input.version, actor: actor.uid,
    useServerNow: input.useServerNow === true,
    date: input.useServerNow === true ? null : input.date,
    time: input.useServerNow === true ? null : input.time,
    missing: input.confirmMissingArrival === true, duplicates: input.confirmDuplicates === true,
    overwrite: input.confirmOverwrite === true,
  })).digest("hex")
  return adminDb.runTransaction(async tx => {
    const receipt = await tx.get(eventRef)
    if (receipt.exists) {
      if (receipt.data()?.requestFingerprint !== fingerprint) throw new ManualExitError("REQUEST_REUSED", "Identificatorul salvării a fost deja folosit.", 409)
      return receipt.data()!.result
    }
    const { ref, b, plate, context, state, stateRef } = await readManualLprContext(tx, input.bookingId)
    if (context.version !== input.version) throw changed()
    const now = manualExitClock()
    const at = input.useServerNow === true ? now : parseManualExitClock(input.date, input.time)
    if (at > now) throw new ManualExitError("FUTURE_EXIT", "Ieșirea nu poate fi în viitor. Introdu ora plecării reale.")
    // Inputs have second precision; camera receipts may additionally contain milliseconds.
    if (context.arrival && Math.floor(Date.parse(at) / 1000) < Math.floor(Date.parse(context.arrival) / 1000)) throw new ManualExitError("EXIT_BEFORE_ENTRY", "Ieșirea nu poate fi înaintea intrării pentru această ședere.")
    if (!context.arrival && input.confirmMissingArrival !== true) throw new ManualExitError("CONFIRM_MISSING_ARRIVAL", "Confirmă plecarea: ora intrării nu poate fi verificată.")
    if (context.duplicates.length && input.confirmDuplicates !== true) throw new ManualExitError("CONFIRM_DUPLICATES", "Necesită verificare ADMIN. Confirmă înregistrarea care trebuie marcată ca ieșită.")
    if (!context.inside && context.departure && input.confirmOverwrite !== true) throw new ManualExitError("CONFIRM_OVERWRITE", "Confirmă suprascrierea ieșirii existente.")
    const shouldDecrement = context.inside && b.occupancyIncremented === true && b.occupancyDecremented !== true
    const gateRef = ref.collection("gateEvents").doc(eventRef.id)
    const result = { lprEventId: eventRef.id, gateEventId: gateRef.id, occupancyChanged: shouldDecrement ? "decremented" : "none" }
    const confirmations = { missingArrival: !context.arrival && input.confirmMissingArrival === true, duplicates: context.duplicates.length > 0 && input.confirmDuplicates === true, overwrite: !context.inside && !!context.departure && input.confirmOverwrite === true }
    const audit = { eventType: "exit", plateNumber: plate, normalizedPlate: plate, deviceId: "manual_admin", direction: "manual", snapTime: at, accurateTime: at, matchedBookingId: ref.id, visitId: b.lpr?.visitId || null, manual: true, adminUid: actor.uid, adminEmail: actor.email, confirmations, reviewedDocuments: context.duplicates.map(d => d.id) }
    tx.set(eventRef, { ...audit, associationStatus: "manual", receivedAt: FieldValue.serverTimestamp(), requestFingerprint: fingerprint, result, raw: { manual: true, bookingId: ref.id, adminUid: actor.uid, adminEmail: actor.email } })
    tx.set(gateRef, { ...audit, lprEventId: eventRef.id, createdAt: FieldValue.serverTimestamp() })
    writeLprVisit(tx, adminDb, { ref, data: b, plate, at, eventType: "exit", eventId: eventRef.id,
      deviceId: "manual_admin", manual: true, actor,
      lprExtra: { lastEventAccurateTime: at },
      // A historical correction must never close a different visit's pointer.
      updatePointer: state.exists && state.data()?.bookingId === ref.id && state.data()?.visitId === b.lpr?.visitId,
    })
    return result
  })
}
