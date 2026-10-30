import { lprLog, lprFields, lprError, lprTransaction, withLprFields } from "@/lib/lpr-log.server"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { correctedCameraTime, cameraClockOffsetSeconds, type CameraTimeMode } from "@/lib/lpr-camera-config.server"
import { manualExitClock, manualLprInstant } from "@/lib/manual-lpr-exit.server"
import { isTollgateWhitelistedPlate } from "@/lib/lpr-tollgate-whitelist"
import { db, serverTimestamp } from "@/lib/server-firestore"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import { isBeforePlateCorrection, isLaterKnownExit } from "@/lib/lpr-entry-evidence"
import { writeLprVisit } from "@/lib/lpr-visit.server"
import { LPR_ACTIVE_STATUSES as ACTIVE_STATUSES, LPR_TOLERANCE_MS as TOLERANCE_MS, inLprBookingWindow as inBookingWindow } from "@/lib/lpr-booking-window"
import { normalizeLicensePlate } from "@/lib/utils"
import { bookingLprTimes, compareLprTimes, lprTime, lprTimeCandidates, receiptLprTime } from "./lpr-time"
import { lprExitConflict } from "./lpr-exit-evidence"

type Nullable<T> = T | null
export interface LprEventInput {
  plateNumber: Nullable<string>
  laneNo: Nullable<number>
  snapTime: Nullable<string>
  accurateTime: Nullable<string>
  deviceId: Nullable<string>
  direction: Nullable<string>
  timestampMode?: CameraTimeMode
  maxEventAgeMinutes?: number
  raw?: unknown
}
export type LprEventType = "entry" | "exit" | "unknown"

function inferEventType(deviceId: Nullable<string>, direction: Nullable<string>): LprEventType {
  const id = typeof deviceId === "string" ? deviceId.toLowerCase() : ""
  const dir = typeof direction === "string" ? direction.toLowerCase() : ""
  if (dir === "entry" || dir === "in") return "entry"
  if (dir === "exit" || dir === "out") return "exit"
  if (id.includes("intrare") || id.includes("entry") || id.includes("gate_in") || dir === "in" || dir === "entry") {
    return "entry"
  }
  if (id.includes("iesire") || id.includes("exit") || id.includes("gate_out") || dir === "out" || dir === "exit") {
    return "exit"
  }
  return "unknown"
}


/** Raw receipts remain available even when association needs an administrator's review.
 * The per-plate state serializes camera events and remembers the booking opened on entry.
 * Booking, visit pointer, audit and counter are committed together, or not at all.
 */
export type LprResult = { savedEventId:string; matchedBookingId?:string; eventType:LprEventType; degraded?:boolean; warning?:string }
export async function handleLprEvent(input: LprEventInput): Promise<LprResult> {
  const normalizedPlate = normalizeLicensePlate(typeof input.plateNumber === "string" ? input.plateNumber : "")
  const eventType = inferEventType(input.deviceId, input.direction)
  const clockOffsetSeconds = cameraClockOffsetSeconds(input.deviceId)
  const clock = correctedCameraTime(input.accurateTime || input.snapTime, input.timestampMode, clockOffsetSeconds)
  const at = clock.wall, instant = clock.instant
  const id = `camera_${createHash("sha256").update(JSON.stringify([normalizedPlate, input.deviceId, eventType, input.accurateTime || input.snapTime])).digest("hex")}`
  lprFields({eventId:id,plate:normalizedPlate,deviceId:input.deviceId})
  const ref = db.collection("lpr_events").doc(id)
  let invalid: string | null = null
  const realNow = new Date(), nowWall = manualExitClock(realNow), clockNow = Date.parse(manualLprInstant(nowWall, true, realNow))
  if (!normalizedPlate || normalizedPlate.length > 20) invalid = "missing_plate"
  else if (clockOffsetSeconds === null) invalid = "invalid_clock_offset_config"
  else if (!at) invalid = "invalid_event_time"
  else if (eventType === "unknown") invalid = "unknown_direction"
  else if (!instant) invalid = lprTimeCandidates(lprTime(at)).length ? "ambiguous_event_time" : "invalid_event_time"
  else if (Math.floor(Date.parse(instant) / 1000) > Math.floor(clockNow / 1000)) invalid = "future_event_time"
  else if (input.maxEventAgeMinutes !== undefined && clockNow - Date.parse(instant) > input.maxEventAgeMinutes * 60000) invalid = "stale_event_time"

  lprLog("camera_validated", {direction:eventType, accurateTime:input.accurateTime, snapTime:input.snapTime,
    clockOffsetSeconds,originalEventTime:clock.originalWall,originalEventInstant:clock.originalInstant,
    eventTime:at,eventInstant:instant,serverTime:realNow.toISOString(),clockDifferenceSeconds:instant ? (Date.parse(instant)-clockNow)/1000 : null,
    timestampMode:input.timestampMode || "romania_wall_clock",maxEventAgeMinutes:input.maxEventAgeMinutes,
    outcome:invalid ? "needs_review" : "pending",reason:invalid},invalid ? "warn" : "info")
  try {
    await ref.create({
      plateNumber:input.plateNumber || null, normalizedPlate:normalizedPlate || null,
      laneNo:input.laneNo ?? null, deviceId:input.deviceId ?? null, direction:input.direction ?? null,
      accurateTime:input.accurateTime ?? null, snapTime:input.snapTime ?? null, eventTime:at, eventInstant:instant,
      timestampMode:input.timestampMode || "romania_wall_clock", eventType,
      clockOffsetSeconds, originalEventTime:clock.originalWall, originalEventInstant:clock.originalInstant,
      receivedAt:serverTimestamp(), raw:input.raw ?? null,
      associationStatus:invalid ? "needs_review" : "pending", associationReason:invalid,
      ...(invalid ? {} : {nextAttemptAt:0}), attempts:0,
    })
  } catch(error: any) {
    if (error?.code !== 6 && error?.code !== "already-exists") {
      lprError("receipt_persist_failed", error)
      return {savedEventId:"degraded_no_persist",eventType,degraded:true,warning:"persist_failed"}
    }
  }
  return processSavedLprEvent(id)
}

export async function processSavedLprEvent(id: string): Promise<LprResult> {
  const eventRef = db.collection("lpr_events").doc(id)
  const receipt = await eventRef.get()
  if (!receipt.exists) throw new Error("LPR receipt missing")
  const input = receipt.data()! as any
  const saved = {id}, normalizedPlate = input.normalizedPlate as string, eventType = input.eventType as LprEventType
  lprFields({eventId:id,plate:normalizedPlate,deviceId:input.deviceId})
  const at = input.eventTime as string, eventMs = Date.parse(at)
  const point = receiptLprTime(input), instants = lprTimeCandidates(point)
  const finished = (data: any): LprResult => {
    lprLog("decision",{outcome:data.associationStatus,reason:data.associationReason,bookingId:data.matchedBookingId,
      visitId:data.visitId,replayed:true,occupancyDelta:0}, data.associationStatus === "needs_review" ? "warn" : "info")
    return {savedEventId:id,eventType,
      ...(data.matchedBookingId ? {matchedBookingId:data.matchedBookingId} : {}),
      ...(data.associationReason ? {warning:data.associationReason} : {})}
  }
  if (input.associationStatus !== "pending") return finished(input)
  if (!at || !Number.isFinite(eventMs) || instants.length !== 1 || !normalizedPlate || (eventType !== "entry" && eventType !== "exit")) {
    // Old pending receipts predate the explicit camera clock convention. Do not guess it.
    await lprTransaction(db, async tx => {
      const current = await tx.get(eventRef)
      if (current.data()?.associationStatus === "pending") updateReceipt(tx, eventRef, {associationStatus:"needs_review",associationReason:"invalid_pending_event",nextAttemptAt:FieldValue.delete()})
    })
    return {savedEventId:id,eventType,warning:"invalid_pending_event"}
  }
  // Allocated once, outside the retryable transaction.
  const newBookingRef = db.collection("bookings").doc()
  const stateRef = db.collection("lpr_plate_state").doc(normalizedPlate)
  try {
    return await lprTransaction(db, async (tx) => {
      const freshReceipt = await tx.get(eventRef)
      if (freshReceipt.data()?.associationStatus !== "pending") return finished(freshReceipt.data())
      const stateSnap = await tx.get(stateRef)
      const state = stateSnap.data() || {}
      const bookings = db.collection("bookings")
      // Broad queries preserve support for legacy plates containing spaces/dashes.
      // They also find overdue visits, independently of the reservation end date.
      const [byPlate, openRows, activeRows, whitelist, plateReceipts] = await Promise.all([
        tx.get(bookings.where("licensePlate", "==", normalizedPlate)),
        tx.get(bookings.where("lpr.isInside", "==", true)),
        tx.get(bookings.where("status", "in", ACTIVE_STATUSES).where("endDate", ">=",
          new Date(eventMs - TOLERANCE_MS).toISOString().slice(0, 10))),
        tx.get(db.collection("lpr_whitelist").doc(normalizedPlate)),
        tx.get(db.collection("lpr_events").where("normalizedPlate", "==", normalizedPlate)),
      ])
      const rows = new Map<string, { id: string; ref: FirebaseFirestore.DocumentReference; data: any }>()
      for (const snapshot of [byPlate, openRows, activeRows]) {
        for (const row of snapshot.docs) {
          const data = row.data()
          if (normalizeLicensePlate(data.licensePlate || "") === normalizedPlate) {
            rows.set(row.id, { id: row.id, ref: row.ref, data })
          }
        }
      }
      // Do not apply a later exit while its earlier entry is waiting for a retry.
      // Including the receipts in this transaction also detects a concurrently arriving earlier event.
      const earlierPending = plateReceipts.docs.some(d => d.id !== id && d.data().associationStatus === "pending" && !d.data().supersededBy &&
        compareLprTimes(receiptLprTime(d.data()), point) === -1)
      if (earlierPending) {
        updateReceipt(tx, eventRef, {associationReason:"earlier_event_pending",nextAttemptAt:Date.now()+30000})
        return {savedEventId:id,eventType,degraded:true,warning:"earlier_event_pending"}
      }
      const all = [...rows.values()]
      const review = (reason: string, ids: string[] = []) => {
        updateReceipt(tx, eventRef, { associationStatus: "needs_review", associationReason: reason, candidateBookingIds: ids, nextAttemptAt:FieldValue.delete() })
        return { savedEventId: saved.id, eventType, warning: reason }
      }
      const open = all.filter(row => getLprPresenceState(row.data).isEffectivelyInside)
      // Whitelisting during a counted stay must not suppress that stay's exit.
      if (!open.length && (whitelist.exists || isTollgateWhitelistedPlate(normalizedPlate))) {
        updateReceipt(tx, eventRef, {associationStatus:"whitelist_skip", nextAttemptAt:FieldValue.delete()})
        return {savedEventId:id,eventType}
      }
      // Keep recoverable receipts while a booking identity change is in flight.
      if (all.some(row => row.data.modificationApplying && normalizeLicensePlate(String(row.data.activeModificationRequest?.finalValues?.licensePlate || row.data.licensePlate)) !== normalizedPlate)) {
        const attempts = Number(freshReceipt.data()?.attempts || 0) + 1
        updateReceipt(tx, eventRef, {attempts,associationStatus:attempts >= 10 ? "needs_review" : "pending",associationReason:"booking_modification_in_progress",nextAttemptAt:attempts >= 10 ? FieldValue.delete() : Date.now()+30000})
        return {savedEventId:id,eventType,degraded:true,warning:"booking_modification_in_progress"}
      }
      // A corrected number must retain its ordering boundary even for legacy stays
      // with no previous plate pointer. The boundary ends at the correction, so a
      // genuinely later vehicle with the old number is not excluded indefinitely.
      // Admin corrections have second precision; do not infer a new vehicle from
      // camera milliseconds within that same, ambiguous second.
      if (isBeforePlateCorrection(state, eventMs, point)) {
        return review("plate_corrected_event_requires_review", state.plateCorrection?.bookingId ? [state.plateCorrection.bookingId] : [])
      }
      // A late delivery must not undo a newer camera OR manual decision.
      const timestamps = [...(lprTimestampToMillis(state.lastEventAt) !== null ? [lprTime(state.lastEventAt, state.lastEventAtInstant)] : []), ...all.flatMap(row => bookingLprTimes(row.data))]
      const orders = timestamps.map(p => compareLprTimes(point, p))
      if (orders.some(n => n === null)) return review("ambiguous_event_order")
      if (orders.includes(-1)) return review("out_of_order_event")
      if (orders.includes(0)) {
        if (compareLprTimes(lprTime(state.lastEventAt, state.lastEventAtInstant), point) === 0 && state.lastEventType === eventType && state.lastDeviceId === input.deviceId) {
          updateReceipt(tx, eventRef, { associationStatus: "duplicate", nextAttemptAt:FieldValue.delete(), matchedBookingId: state.bookingId || null })
          return { savedEventId: saved.id, eventType, ...(state.bookingId ? { matchedBookingId: state.bookingId } : {}) }
        }
        return review("simultaneous_event_requires_review")
      }
      if (eventType === "entry") {
        // An exit delivered first may already be in review without having updated
        // any booking/pointer. Do not reopen a past visit when its older entry
        // eventually arrives (or is retried by an admin). Pending exits are NOT
        // included: they still recover automatically after their earlier entry.
        // The receipt query is part of this transaction, so concurrent delivery
        // cannot bypass this check. Keep ambiguous evidence for an admin instead
        // of inventing a booking association or a physical departure.
        const realNow = new Date(), nowWall = manualExitClock(realNow), nowMs = Date.parse(nowWall)
        const laterExits = plateReceipts.docs.filter(d => d.id !== id && isLaterKnownExit(d.data(), eventMs, nowMs, false, point, lprTime(nowWall, manualLprInstant(nowWall, true, realNow))))
        if (laterExits.length) {
          updateReceipt(tx, eventRef, { relatedEventIds: laterExits.slice(0, 20).map(d => d.id), relatedEventCount: laterExits.length })
          return review("later_exit_requires_review", all.map(row => row.id))
        }
      }
      const eligible = all.filter(row => ACTIVE_STATUSES.includes(row.data.status) && inBookingWindow(row.data, eventMs))
      const pointer = open.find(row => row.id === state.bookingId && row.data.lpr?.visitId === state.visitId)
      let selected: typeof all[number] | undefined
      if (open.length > 1) return review("multiple_open_visits", open.map(row => row.id))
      if (eventType === "exit") {
        // Never select a different reservation by the exit date. Overdue exits close the open visit.
        selected = pointer || open[0]
        if (!selected) return review("exit_without_open_visit")
        const conflict = lprExitConflict({ bookingId: selected.id, booking: selected.data, state, receipts: plateReceipts.docs.filter(d => d.id !== id).map(d => d.data()), at: point })
        if (conflict) return review(conflict, [selected.id])
      } else if (open.length === 1) {
        selected = pointer || open[0]
        if (eligible.some(row => row.id !== selected!.id)) {
          return review("open_visit_conflicts_with_reservation", [selected.id, ...eligible.filter(row => row.id !== selected!.id).map(row => row.id)])
        }
        // Do not perpetuate an old, unlinked reservation reactivated by the legacy matcher.
        if (!pointer && selected.data.status !== "unmatched_lpr" && !inBookingWindow(selected.data, eventMs)) {
          return review("legacy_open_visit_outside_period", [selected.id])
        }
      } else {
        if (eligible.length > 1) return review("ambiguous_reservations", eligible.map(row => row.id))
        selected = eligible[0]
      }
      const isNew = !selected
      const bookingRef = selected?.ref || newBookingRef
      const data = selected?.data || {}
      const wasInside = getLprPresenceState(data).isEffectivelyInside
      const visitId = wasInside ? (data.lpr?.visitId || saved.id) : saved.id
      const patch: Record<string, any> = {}
      if (isNew) {
        Object.assign(patch, {
          licensePlate: normalizedPlate, source: "lpr", status: "unmatched_lpr",
          startDate: at.slice(0, 10), startTime: at.slice(11, 16),
          endDate: "", endTime: "", durationMinutes: 0, createdAt: serverTimestamp(),
        })
      } else {
        if (eventType === "exit" && data.status === "unmatched_lpr") {
          const arrived = lprTimeCandidates(lprTime(data.lpr?.arrivedAt, data.lpr?.arrivedAtInstant))
          Object.assign(patch, {
            endDate: at.slice(0, 10), endTime: at.slice(11, 16),
            durationMinutes: arrived.length !== 1 ? (data.durationMinutes || 0) : Math.max(0, Math.round((instants[0] - arrived[0]) / 60_000)),
          })
        }
      }
      const instant = new Date(instants[0]).toISOString()
      writeLprVisit(tx, db, { ref: bookingRef, data, plate: normalizedPlate, at, instant,
        eventType, eventId: saved.id, visitId, deviceId: input.deviceId, create: isNew, patch,
        unmatched: isNew || data.status === "unmatched_lpr",
        lprExtra: { lastSeenLaneNo: input.laneNo ?? null, lastEventAccurateTime: input.accurateTime ?? null },
      })
      tx.set(bookingRef.collection("gateEvents").doc(saved.id), {
        eventType, plateNumber: normalizedPlate, laneNo: input.laneNo ?? null,
        deviceId: input.deviceId ?? null, direction: input.direction ?? null,
        snapTime: input.snapTime ?? null, accurateTime: input.accurateTime ?? null,
        lprEventId: saved.id, visitId, eventTime: at, eventInstant: instant, createdAt: serverTimestamp(),
      })
      updateReceipt(tx, eventRef, {
        matchedBookingId: bookingRef.id, visitId, nextAttemptAt:FieldValue.delete(), associationReason:null,
        associationStatus: isNew || data.status === "unmatched_lpr" ? "unmatched_visit" : "matched",
      })
      return { savedEventId: saved.id, matchedBookingId: bookingRef.id, eventType }
    })
  } catch (error) {
    lprError("association_failed", error)
    try {
      await lprTransaction(db, async tx => {
        const fresh = await tx.get(eventRef), data = fresh.data()
        if (data?.associationStatus !== "pending") return
        const attempts = Number(data.attempts || 0) + 1
        updateReceipt(tx, eventRef, {attempts, associationStatus:attempts >= 10 ? "needs_review" : "pending", associationReason:"association_failed",
          nextAttemptAt:attempts >= 10 ? FieldValue.delete() : Date.now() + Math.min(300000, 1000 * 2 ** attempts)})
      })
    } catch {} // The durable pending receipt remains discoverable by the worker.
    return { savedEventId: saved.id, eventType, degraded: true, warning: "association_failed" }
  }
}

/** Single-field due-time query; terminal receipts remove nextAttemptAt. Concurrent
 * workers are safe because the receipt and visit transition share one transaction. */
export async function retryPendingLprEvents() {
  const due = await db.collection("lpr_events").where("nextAttemptAt", "<=", Date.now()).orderBy("nextAttemptAt").limit(25).get()
  const results: Array<LprResult | {savedEventId:string;degraded:boolean;warning:string}> = []
  for (const event of due.docs) {
    await withLprFields({eventId:event.id},async()=> {
      try {
        const result=await processSavedLprEvent(event.id)
        results.push(result)
        lprLog("retry_result",{eventId:event.id,bookingId:result.matchedBookingId,reason:result.warning,outcome:result.degraded?"pending":"processed"})
      } catch (error) {
        lprError("retry_failed",error)
        lprLog("retry_result",{eventId:event.id,reason:"retry_unavailable"},"error")
        results.push({savedEventId:event.id,degraded:true,warning:"retry_unavailable"})
      }
    })
  }
  lprLog("retry_summary",{processed:results.length})
  return {processed:results.length, results}
}

function updateReceipt(tx:FirebaseFirestore.Transaction, ref:FirebaseFirestore.DocumentReference, patch:any) {
  if (patch.associationStatus || patch.associationReason) lprLog("decision",{eventId:ref.id,outcome:patch.associationStatus || "pending",reason:patch.associationReason,
    bookingId:patch.matchedBookingId,visitId:patch.visitId,candidateBookingIds:patch.candidateBookingIds,attempts:patch.attempts},
    patch.associationStatus === "needs_review" || patch.associationReason ? "warn" : "info")
  tx.update(ref,patch)
}
