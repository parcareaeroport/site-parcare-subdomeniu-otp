import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { parseCameraTime, type CameraTimeMode } from "@/lib/lpr-camera-config.server"
import { manualExitClock } from "@/lib/manual-lpr-exit.server"
import { isTollgateWhitelistedPlate } from "@/lib/lpr-tollgate-whitelist"
import { db, serverTimestamp } from "@/lib/server-firestore"
import { getLprPresenceState, lprTimestampToMillis } from "@/lib/lpr-presence"
import { writeLprVisit } from "@/lib/lpr-visit.server"
import { LPR_ACTIVE_STATUSES as ACTIVE_STATUSES, LPR_TOLERANCE_MS as TOLERANCE_MS, inLprBookingWindow as inBookingWindow } from "@/lib/lpr-booking-window"
import { normalizeLicensePlate } from "@/lib/utils"

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
  const at = parseCameraTime(input.accurateTime || input.snapTime, input.timestampMode)
  const id = `camera_${createHash("sha256").update(JSON.stringify([normalizedPlate, input.deviceId, eventType, input.accurateTime || input.snapTime])).digest("hex")}`
  const ref = db.collection("lpr_events").doc(id)
  let invalid: string | null = null
  const clockNow = Date.parse(manualExitClock())
  if (!normalizedPlate || normalizedPlate.length > 20) invalid = "missing_plate"
  else if (!at) invalid = "invalid_event_time"
  else if (eventType === "unknown") invalid = "unknown_direction"
  else if (Math.floor(Date.parse(at) / 1000) > Math.floor(clockNow / 1000)) invalid = "future_event_time"
  else if (input.maxEventAgeMinutes !== undefined && clockNow - Date.parse(at) > input.maxEventAgeMinutes * 60000) invalid = "stale_event_time"

  try {
    await ref.create({
      plateNumber:input.plateNumber || null, normalizedPlate:normalizedPlate || null,
      laneNo:input.laneNo ?? null, deviceId:input.deviceId ?? null, direction:input.direction ?? null,
      accurateTime:input.accurateTime ?? null, snapTime:input.snapTime ?? null, eventTime:at,
      timestampMode:input.timestampMode || "romania_wall_clock", eventType,
      receivedAt:serverTimestamp(), raw:input.raw ?? null,
      associationStatus:invalid ? "needs_review" : "pending", associationReason:invalid,
      ...(invalid ? {} : {nextAttemptAt:0}), attempts:0,
    })
  } catch(error: any) {
    if (error?.code !== 6 && error?.code !== "already-exists") {
      console.error("LPR receipt persistence failed", error)
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
  const at = input.eventTime as string, eventMs = Date.parse(at)
  const finished = (data: any): LprResult => ({savedEventId:id,eventType,
    ...(data.matchedBookingId ? {matchedBookingId:data.matchedBookingId} : {}),
    ...(data.associationReason ? {warning:data.associationReason} : {})})
  if (input.associationStatus !== "pending") return finished(input)
  if (!at || !Number.isFinite(eventMs) || !normalizedPlate || (eventType !== "entry" && eventType !== "exit")) {
    // Old pending receipts predate the explicit camera clock convention. Do not guess it.
    await db.runTransaction(async tx => {
      const current = await tx.get(eventRef)
      if (current.data()?.associationStatus === "pending") tx.update(eventRef, {associationStatus:"needs_review",associationReason:"invalid_pending_event",nextAttemptAt:FieldValue.delete()})
    })
    return {savedEventId:id,eventType,warning:"invalid_pending_event"}
  }
  // Allocated once, outside the retryable transaction.
  const newBookingRef = db.collection("bookings").doc()
  const stateRef = db.collection("lpr_plate_state").doc(normalizedPlate)
  try {
    return await db.runTransaction(async (tx) => {
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
      const earlierPending = plateReceipts.docs.some(d => d.id !== id && d.data().associationStatus === "pending" &&
        typeof d.data().eventTime === "string" && Date.parse(d.data().eventTime) < eventMs)
      if (earlierPending) {
        tx.update(eventRef, {associationReason:"earlier_event_pending",nextAttemptAt:Date.now()+30000})
        return {savedEventId:id,eventType,degraded:true,warning:"earlier_event_pending"}
      }
      const all = [...rows.values()]
      const review = (reason: string, ids: string[] = []) => {
        tx.update(eventRef, { associationStatus: "needs_review", associationReason: reason, candidateBookingIds: ids, nextAttemptAt:FieldValue.delete() })
        return { savedEventId: saved.id, eventType, warning: reason }
      }
      const open = all.filter(row => getLprPresenceState(row.data).isEffectivelyInside)
      // Whitelisting during a counted stay must not suppress that stay's exit.
      if (!open.length && (whitelist.exists || isTollgateWhitelistedPlate(normalizedPlate))) {
        tx.update(eventRef, {associationStatus:"whitelist_skip", nextAttemptAt:FieldValue.delete()})
        return {savedEventId:id,eventType}
      }
      // Keep recoverable receipts while a booking identity change is in flight.
      if (all.some(row => row.data.modificationApplying && normalizeLicensePlate(String(row.data.activeModificationRequest?.finalValues?.licensePlate || row.data.licensePlate)) !== normalizedPlate)) {
        const attempts = Number(freshReceipt.data()?.attempts || 0) + 1
        tx.update(eventRef, {attempts,associationStatus:attempts >= 10 ? "needs_review" : "pending",associationReason:"booking_modification_in_progress",nextAttemptAt:attempts >= 10 ? FieldValue.delete() : Date.now()+30000})
        return {savedEventId:id,eventType,degraded:true,warning:"booking_modification_in_progress"}
      }
      // A late delivery must not undo a newer camera OR manual decision.
      const timestamps = [lprTimestampToMillis(state.lastEventAt), ...all.flatMap(row => [
        lprTimestampToMillis(row.data.lpr?.lastSeenAt),
        lprTimestampToMillis(row.data.lpr?.arrivedAt),
        lprTimestampToMillis(row.data.lpr?.departedAt),
      ])].filter((v): v is number => v !== null)
      const latest = timestamps.length ? Math.max(...timestamps) : null
      if (latest !== null && eventMs < latest) return review("out_of_order_event")
      if (latest === eventMs) {
        if (state.lastEventAt === at && state.lastEventType === eventType && state.lastDeviceId === input.deviceId) {
          tx.update(eventRef, { associationStatus: "duplicate", nextAttemptAt:FieldValue.delete(), matchedBookingId: state.bookingId || null })
          return { savedEventId: saved.id, eventType, ...(state.bookingId ? { matchedBookingId: state.bookingId } : {}) }
        }
        return review("simultaneous_event_requires_review")
      }
      const eligible = all.filter(row => ACTIVE_STATUSES.includes(row.data.status) && inBookingWindow(row.data, eventMs))
      const pointer = open.find(row => row.id === state.bookingId && row.data.lpr?.visitId === state.visitId)
      let selected: typeof all[number] | undefined
      if (open.length > 1) return review("multiple_open_visits", open.map(row => row.id))
      if (eventType === "exit") {
        // Never select a different reservation by the exit date. Overdue exits close the open visit.
        selected = pointer || open[0]
        if (!selected) return review("exit_without_open_visit")
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
          const arrived = lprTimestampToMillis(data.lpr?.arrivedAt)
          Object.assign(patch, {
            endDate: at.slice(0, 10), endTime: at.slice(11, 16),
            durationMinutes: arrived === null ? (data.durationMinutes || 0) : Math.max(0, Math.round((eventMs - arrived) / 60_000)),
          })
        }
      }
      writeLprVisit(tx, db, { ref: bookingRef, data, plate: normalizedPlate, at,
        eventType, eventId: saved.id, visitId, deviceId: input.deviceId, create: isNew, patch,
        unmatched: isNew || data.status === "unmatched_lpr",
        lprExtra: { lastSeenLaneNo: input.laneNo ?? null, lastEventAccurateTime: input.accurateTime ?? null },
      })
      tx.set(bookingRef.collection("gateEvents").doc(saved.id), {
        eventType, plateNumber: normalizedPlate, laneNo: input.laneNo ?? null,
        deviceId: input.deviceId ?? null, direction: input.direction ?? null,
        snapTime: input.snapTime ?? null, accurateTime: input.accurateTime ?? null,
        lprEventId: saved.id, visitId, createdAt: serverTimestamp(),
      })
      tx.update(eventRef, {
        matchedBookingId: bookingRef.id, visitId, nextAttemptAt:FieldValue.delete(), associationReason:null,
        associationStatus: isNew || data.status === "unmatched_lpr" ? "unmatched_visit" : "matched",
      })
      return { savedEventId: saved.id, matchedBookingId: bookingRef.id, eventType }
    })
  } catch (error) {
    console.error("LPR atomic association failed", error)
    try {
      await db.runTransaction(async tx => {
        const fresh = await tx.get(eventRef), data = fresh.data()
        if (data?.associationStatus !== "pending") return
        const attempts = Number(data.attempts || 0) + 1
        tx.update(eventRef, {attempts, associationStatus:attempts >= 10 ? "needs_review" : "pending", associationReason:"association_failed",
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
  const results = []
  for (const event of due.docs) {
    try { results.push(await processSavedLprEvent(event.id)) }
    catch { results.push({savedEventId:event.id,degraded:true,warning:"retry_unavailable"}) }
  }
  return {processed:results.length, results}
}
