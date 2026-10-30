import { lprTransaction, lprLog } from "@/lib/lpr-log.server"
import "server-only"
import { writeLprVisit } from "@/lib/lpr-visit.server"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import { normalizeLicensePlate } from "@/lib/utils"
import type { ManualExitContext, ManualExitRow, ManualExitSaveInput } from "@/lib/manual-lpr-exit-contract"
import { compareLprTimes, lprTime, lprTimeCandidates, normalizeLprEventType, receiptLprTime, romaniaCivilClock, uniqueLprInstant } from "./lpr-time"
import { lprExitConflict } from "./lpr-exit-evidence"
import { isTrustedLprReceipt } from "./lpr-entry-evidence"

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
  return romaniaCivilClock(now).replace(/\.\d{3}Z$/, ".000Z")
}
// A typed repeated hour is ambiguous; the explicit "now" action has a known
// server instant. No browser timezone or inferred DST offset is used.
export function manualLprInstant(at: string, useServerNow = false, realNow = new Date()) {
  const instant = useServerNow && manualExitClock(realNow) === at
    ? new Date(Math.floor(realNow.getTime() / 1000) * 1000).toISOString() : uniqueLprInstant(at)
  if (!instant) throw new ManualExitError("AMBIGUOUS_TIME", "Ora indicată nu există sau se repetă la schimbarea orei. Necesită verificare ADMIN. Folosește «A plecat acum» numai dacă plecarea are loc acum.", 409)
  return instant
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
  const [insideSnap, state, receipts, history] = await Promise.all([
    tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true)), tx.get(stateRef),
    tx.get(adminDb.collection("lpr_events").where("normalizedPlate", "==", plate)),
    tx.get(adminDb.collection("bookings").where("licensePlate", "==", plate)),
  ])
  const linkedId = state.data()?.bookingId
  const linked = typeof linkedId === "string" && linkedId !== bookingId && !linkedId.includes("/") ? await tx.get(adminDb.collection("bookings").doc(linkedId)) : null
  const open = insideSnap.docs.filter(d => normalizeLicensePlate(String(d.data().licensePlate || "")) === plate && getLprPresenceState(d.data()).isEffectivelyInside).sort((a, b) => a.id.localeCompare(b.id))
  const lpr = b.lpr || {}, inside = getLprPresenceState(b).isEffectivelyInside
  const arrived = validMillis(lpr.arrivedAt), departed = validMillis(lpr.departedAt)
  const lastEntry = String(lpr.lastEventType || "").toLowerCase().includes("entry") ? validMillis(lpr.lastSeenAt) : null
  // Legacy reopened documents retain the previous visit's arrivedAt/departedAt.
  const arrivalMs = inside && departed !== null && lastEntry !== null && lastEntry > departed && (arrived === null || arrived <= departed) ? lastEntry : arrived
  const version = createHash("sha256").update(JSON.stringify({
    id: snap.id, version: snap.updateTime?.toDate().toISOString(), nanos: snap.updateTime?.nanoseconds,
    open: open.map(d => [d.id, d.updateTime?.seconds, d.updateTime?.nanoseconds]),
    pointer: [state.updateTime?.seconds, state.updateTime?.nanoseconds], linked:[linked?.id,linked?.updateTime?.seconds,linked?.updateTime?.nanoseconds],
    receipts: receipts.docs.map(d => [d.id, d.updateTime?.seconds, d.updateTime?.nanoseconds]).sort(),
    history: history.docs.map(d => [d.id, d.updateTime?.seconds, d.updateTime?.nanoseconds]).sort(),
  })).digest("hex")
  const context: ManualExitContext = {
    booking: row(snap.id, b), version, serverNow: manualExitClock(),
    arrival: arrivalMs === null ? null : new Date(arrivalMs).toISOString(),
    hasPreviousVisit: Boolean(lpr.visitId || lpr.arrivedAt || lpr.departedAt || lpr.lastSeenAt || lpr.lastEventType === "exit"),
    departure: iso(lpr.departedAt), inside, lastEntry:lastEntry === null ? null : new Date(lastEntry).toISOString(),
    duplicates: open.length > 1 ? open.map(d => row(d.id, d.data())) : open.filter(d => d.id !== snap.id).map(d => row(d.id, d.data())),
  }
  return { ref, b, plate, context, state, stateRef, linked, receipts, history }
}
export async function prepareManualExit(bookingId: string) {
  return lprTransaction(adminDb, async tx => (await readManualLprContext(tx, bookingId)).context)
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
  return lprTransaction(adminDb, async tx => {
    const receipt = await tx.get(eventRef)
    if (receipt.exists) {
      if (receipt.data()?.requestFingerprint !== fingerprint) throw new ManualExitError("REQUEST_REUSED", "Identificatorul salvării a fost deja folosit.", 409)
      lprLog("manual_replay",{eventId:eventRef.id,bookingId:input.bookingId,replayed:true,occupancyDelta:0,outcome:"duplicate"})
      return receipt.data()!.result
    }
    const { ref, b, plate, context, state, linked, receipts, history } = await readManualLprContext(tx, input.bookingId)
    if (context.version !== input.version) throw changed()
    const realNow = new Date(), now = manualExitClock(realNow)
    const at = input.useServerNow === true ? now : parseManualExitClock(input.date, input.time)
    const instant = manualLprInstant(at, input.useServerNow === true, realNow)
    const point = lprTime(at, instant), nowPoint = lprTime(now, manualLprInstant(now, true, realNow))
    if (compareLprTimes(point, nowPoint, 1000) === 1) throw new ManualExitError("FUTURE_EXIT", "Ieșirea nu poate fi în viitor. Introdu ora plecării reale.")
    // Inputs have second precision; camera receipts may additionally contain milliseconds.
    const arrivalInstant = context.arrival === iso(b.lpr?.arrivedAt) ? b.lpr?.arrivedAtInstant : b.lpr?.lastSeenAtInstant
    if (context.arrival) {
      const order = compareLprTimes(point, lprTime(context.arrival, arrivalInstant), 1000)
      if (order === null) throw new ManualExitError("AMBIGUOUS_TIME", "Ora intrării este ambiguă. Necesită verificare ADMIN înainte de închiderea șederii.", 409)
      if (order === -1) throw new ManualExitError("EXIT_BEFORE_ENTRY", "Ieșirea nu poate fi înaintea intrării pentru această ședere.")
    }
    const conflict = lprExitConflict({ bookingId: ref.id, booking: b, state: state.data(), receipts: receipts.docs.map(d => d.data()), at: point, manual: true })
    if (conflict) {
      const detail = conflict === "ambiguous_exit_order"
        ? "ordinea evenimentelor LPR nu poate fi stabilită din orele disponibile"
        : conflict === "later_entry_requires_review" || conflict === "exit_before_last_entry"
          ? "există o intrare înregistrată după ora plecării indicate"
          : "evidențele șederii sunt contradictorii"
      throw new ManualExitError(conflict === "exit_before_last_entry" ? "EXIT_BEFORE_LAST_ENTRY" : "EXIT_REQUIRES_REVIEW", `Necesită verificare ADMIN: ${detail}. Ieșirea nu a fost salvată.`, 409)
    }
    // A correction to a closed visit cannot move its departure into a later visit.
    const pointer = state.data()
    const pointerTime = validMillis(pointer?.lastEventAt)
    const otherVisit = pointer && (pointer.bookingId !== ref.id || (pointer.visitId ?? null) !== (b.lpr?.visitId ?? null))
    const nextVisitStart = validMillis(linked?.data()?.lpr?.arrivedAt) ?? pointerTime
    if (!context.inside) {
      const nextEntries = history.docs.filter(d => d.id !== ref.id).map(d => lprTime(d.data().lpr?.arrivedAt, d.data().lpr?.arrivedAtInstant))
      if (otherVisit && nextVisitStart !== null) nextEntries.push(lprTime(nextVisitStart, linked?.data()?.lpr?.arrivedAtInstant ?? pointer?.lastEventAtInstant))
      nextEntries.push(...receipts.docs.map(d => d.data()).filter(r => isTrustedLprReceipt(r) && r.eventType === "entry" && (r.matchedBookingId !== ref.id || r.visitId !== b.lpr?.visitId)).map(receiptLprTime))
      const previous = lprTime(b.lpr?.departedAt, b.lpr?.departedAtInstant)
      if (nextEntries.some(p => lprTimeCandidates(p).length && compareLprTimes(p, previous) !== -1 && compareLprTimes(point, p, 1000) !== -1)) throw new ManualExitError("EXIT_OVERLAPS_NEW_VISIT", "Ieșirea corectată se suprapune unei șederi mai noi. Necesită verificare ADMIN.", 409)
      if (pointer && !otherVisit && (pointer.isInside === true || normalizeLprEventType(pointer.lastEventType) === "entry")) throw new ManualExitError("EXIT_REQUIRES_REVIEW", "Referința șederii contrazice ieșirea salvată. Necesită verificare ADMIN.", 409)
      if (pointer && !otherVisit && pointerTime !== null && context.departure && compareLprTimes(lprTime(pointer.lastEventAt, pointer.lastEventAtInstant), previous) !== 0) throw new ManualExitError("EXIT_REQUIRES_REVIEW", "Ora ieșirii diferă între rezervare și evidența șederii. Necesită verificare ADMIN.", 409)
    }
    if (!context.arrival && input.confirmMissingArrival !== true) throw new ManualExitError("CONFIRM_MISSING_ARRIVAL", "Confirmă plecarea: ora intrării nu poate fi verificată.")
    if (context.duplicates.length && input.confirmDuplicates !== true) throw new ManualExitError("CONFIRM_DUPLICATES", "Necesită verificare ADMIN. Confirmă înregistrarea care trebuie marcată ca ieșită.")
    if (!context.inside && context.departure && input.confirmOverwrite !== true) throw new ManualExitError("CONFIRM_OVERWRITE", "Confirmă suprascrierea ieșirii existente.")
    const shouldDecrement = context.inside && b.occupancyIncremented === true && b.occupancyDecremented !== true
    const gateRef = ref.collection("gateEvents").doc(eventRef.id)
    const result = { lprEventId: eventRef.id, gateEventId: gateRef.id, occupancyChanged: shouldDecrement ? "decremented" : "none" }
    const confirmations = { missingArrival: !context.arrival && input.confirmMissingArrival === true, duplicates: context.duplicates.length > 0 && input.confirmDuplicates === true, overwrite: !context.inside && !!context.departure && input.confirmOverwrite === true }
    // Preserve original audits, but stop treating the corrected departure as a
    // second physical exit. Scope strictly to this booking and this closed visit.
    const superseded = !context.inside && context.departure ? receipts.docs.filter(d => {
      const r = d.data()
      return r.eventType === "exit" && !r.supersededBy && r.matchedBookingId === ref.id &&
        (b.lpr?.visitId && r.visitId === b.lpr.visitId || !r.visitId && iso(r.eventTime ?? r.accurateTime ?? r.snapTime) === context.departure)
    }) : []
    const audit = { eventType: "exit", plateNumber: plate, normalizedPlate: plate, deviceId: "manual_admin", direction: "manual", eventTime: at, eventInstant: instant, snapTime: at, accurateTime: at, matchedBookingId: ref.id, visitId: b.lpr?.visitId || null, manual: true, adminUid: actor.uid, adminEmail: actor.email, confirmations, reviewedDocuments: context.duplicates.map(d => d.id), supersedes: superseded.map(d => d.id), previousLpr: b.lpr || null }
    for (const old of superseded) {
      const replacement = { supersededBy: eventRef.id, supersededAt: FieldValue.serverTimestamp(), supersededByUid: actor.uid }
      tx.update(old.ref, replacement)
      tx.set(ref.collection("gateEvents").doc(old.id), replacement, { merge: true })
    }
    tx.set(eventRef, { ...audit, associationStatus: "manual", receivedAt: FieldValue.serverTimestamp(), requestFingerprint: fingerprint, result, raw: { manual: true, bookingId: ref.id, adminUid: actor.uid, adminEmail: actor.email } })
    tx.set(gateRef, { ...audit, lprEventId: eventRef.id, createdAt: FieldValue.serverTimestamp() })
    writeLprVisit(tx, adminDb, { ref, data: b, plate, at, instant, eventType: "exit", eventId: eventRef.id,
      deviceId: "manual_admin", manual: true, actor,
      lprExtra: { lastEventAccurateTime: at },
      // A historical correction must never close a different visit's pointer.
      updatePointer: state.exists && !otherVisit,
    })
    return result
  })
}
