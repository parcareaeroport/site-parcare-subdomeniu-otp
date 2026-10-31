import { lprLog } from "@/lib/lpr-log.server"
import "server-only"
import { FieldValue } from "firebase-admin/firestore"
import { getLprPresenceState } from "@/lib/lpr-presence"
import { lprOccupancyDelta } from "./lpr-occupancy-transition"
import { uniqueLprInstant } from "./lpr-time"

/** One accounting transition for linking a live stay or recovering an archived
 * one. Readers validate identity/evidence and finish all reads before this call.
 * Period/plate-edit history is not a proxy for physical presence.
 */
export function linkLprVisit(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, input: {
  target: FirebaseFirestore.DocumentReference; source: FirebaseFirestore.DocumentReference
  sourceKind: "open" | "archived"; lpr: Record<string, any>; sourceData: FirebaseFirestore.DocumentData
  stateRef: FirebaseFirestore.DocumentReference; state: FirebaseFirestore.DocumentData
  effectiveInsideCount: number; eventId: string; actor: { uid: string; email: string | null }
}) {
  const { target, source, lpr, actor } = input, restored = input.sourceKind === "archived"
  const count = input.effectiveInsideCount + (restored ? 1 : 0)
  tx.update(target, { lpr, occupancyIncremented: true, occupancyDecremented: false,
    occupancyIncrementedAt: restored ? FieldValue.serverTimestamp() : input.sourceData.occupancyIncrementedAt || null,
    occupancyDecrementedAt: restored ? null : input.sourceData.occupancyDecrementedAt || null, lastUpdated: FieldValue.serverTimestamp() })
  tx.update(source, restored ? { restoredLprToBookingId: target.id, restoredLprEventId: input.eventId,
    restoredLprAt: FieldValue.serverTimestamp(), restoredLprByUid: actor.uid } : {
    "lpr.isInside": false, "lpr.associatedToBookingId": target.id, occupancyIncremented: false,
    occupancyDecremented: false, lastUpdated: FieldValue.serverTimestamp() })
  tx.set(input.stateRef, restored ? { bookingId: target.id, visitId: lpr.visitId, isInside: true,
    lastEventAt: lpr.lastSeenAt, lastEventAtInstant: lpr.lastSeenAtInstant,
    lastEventId: input.eventId, lastEventType: "entry", lastDeviceId: "manual_admin", updatedAt: FieldValue.serverTimestamp() }
    : { ...input.state, bookingId: target.id, updatedAt: FieldValue.serverTimestamp() })
  tx.set(db.collection("config").doc("parkingLive"), { occupiedCount: count, lastUpdated: FieldValue.serverTimestamp(),
    lastChange: { type: restored ? "restore_deleted_lpr_visit" : "visit_association", bookingId: target.id,
      sourceBookingId: source.id, adminUid: actor.uid, count, ...(restored ? { at: lpr.lastSeenAt } : {}) } }, { merge: true })
  return { visitId: lpr.visitId as string, occupancyChanged: restored ? "incremented" : "none" }
}

/** Shared state transition for camera and admin events. The caller must finish all
 * transaction reads (including the per-plate lock) before calling this function.
 * Existing occupancy flags are preserved for compatibility with reservation writers.
 */
export function writeLprVisit(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, input: {
  ref: FirebaseFirestore.DocumentReference; data: any; plate: string; at: string; instant?: string | null
  eventType: "entry" | "exit"; eventId: string; visitId?: string | null
  deviceId: string | null; manual?: boolean; actor?: { uid: string; email: string | null }
  lprExtra?: Record<string, unknown>; patch?: Record<string, unknown>
  create?: boolean; updatePointer?: boolean; unmatched?: boolean
}) {
  const { ref, data, plate, at, eventType } = input
  const instant = input.instant ?? uniqueLprInstant(at)
  const wasInside = getLprPresenceState(data).isEffectivelyInside
  const visitId = input.visitId ?? data.lpr?.visitId ?? (eventType === "entry" ? input.eventId : null)
  const delta = lprOccupancyDelta(data, eventType)
  const lpr = {
    ...(data.lpr || {}), ...input.lprExtra,
    isInside: eventType === "entry", visitId,
    lastSeenAt: at, lastSeenAtInstant: instant, lastEventId: input.eventId, lastEventType: eventType, lastSeenDeviceId: input.deviceId ?? null,
    lastSeenPlateNumber: plate, manualOverride: input.manual === true,
    ...(input.actor ? { manualOverrideAt: FieldValue.serverTimestamp(), manualOverrideByUid: input.actor.uid, manualOverrideByEmail: input.actor.email } : {}),
    ...(eventType === "entry" && !wasInside ? { arrivedAt: at, arrivedAtInstant: instant, departedAt: null, departedAtInstant: null } : {}),
    ...(eventType === "exit" ? { departedAt: at, departedAtInstant: instant } : {}),
  }
  const patch = { ...input.patch, lpr, lastUpdated: FieldValue.serverTimestamp(),
    ...(delta === 1 ? { occupancyIncremented: true, occupancyDecremented: false, occupancyIncrementedAt: FieldValue.serverTimestamp() } : {}),
    ...(delta === -1 ? { occupancyDecremented: true, occupancyDecrementedAt: FieldValue.serverTimestamp() } : {}),
  }
  if (input.create) tx.create(ref, patch)
  else tx.update(ref, patch)
  if (input.updatePointer !== false) tx.set(db.collection("lpr_plate_state").doc(plate), {
    bookingId: ref.id, visitId, isInside: eventType === "entry", lastEventAt: at, lastEventAtInstant: instant, lastEventId: input.eventId,
    lastEventType: eventType, lastDeviceId: input.deviceId, updatedAt: FieldValue.serverTimestamp(),
  })
  if (delta) tx.set(db.collection("config").doc("parkingLive"), {
    occupiedCount: FieldValue.increment(delta), lastUpdated: FieldValue.serverTimestamp(),
    lastChange: { type: `${eventType}${input.manual ? "_manual_override" : input.unmatched ? "_unmatched" : ""}`, bookingId: ref.id,
      plateNumber: plate, deviceId: input.deviceId ?? null, at,
      ...(input.actor ? { adminUid: input.actor.uid, adminEmail: input.actor.email } : {}),
    },
  }, { merge: true })
  lprLog("visit_committed",{outcome:"committed",plate,bookingId:ref.id,eventId:input.eventId,visitId,deviceId:input.deviceId,
    actorUid:input.actor?.uid,direction:eventType,eventTime:at,eventInstant:instant,insideBefore:wasInside,insideAfter:eventType === "entry",occupancyDelta:delta})
  return { visitId, occupancyChanged: delta === 1 ? "incremented" : delta === -1 ? "decremented" : "none" }
}

/** An arrival-time correction is not a gate crossing: preserve the exact presence,
 * visit, departure, latest observation and plate pointer, including legacy millis.
 * The caller validates/version-checks the context and writes the correction audit.
 */
export function correctLprArrival(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference,
  data: any, at: string, actor: { uid: string; email: string | null }, instant = uniqueLprInstant(at)) {
  tx.update(ref, {
    "lpr.arrivedAt": at, "lpr.arrivedAtInstant": instant, "lpr.arrivalCorrectedAt": FieldValue.serverTimestamp(),
    "lpr.arrivalCorrectedByUid": actor.uid, "lpr.arrivalCorrectedByEmail": actor.email,
    lastUpdated: FieldValue.serverTimestamp(),
  })
  lprLog("arrival_corrected",{outcome:"committed",bookingId:ref.id,visitId:data.lpr?.visitId,actorUid:actor.uid,eventTime:at,
    insideBefore:getLprPresenceState(data).isEffectivelyInside,insideAfter:getLprPresenceState(data).isEffectivelyInside,occupancyDelta:0})
  return { visitId: data.lpr?.visitId ?? null, occupancyChanged: "none" }
}
