import "server-only"
import { FieldValue } from "firebase-admin/firestore"
import { getLprPresenceState } from "@/lib/lpr-presence"

/** Shared state transition for camera and admin events. The caller must finish all
 * transaction reads (including the per-plate lock) before calling this function.
 * Existing occupancy flags are preserved for compatibility with reservation writers.
 */
export function writeLprVisit(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore, input: {
  ref: FirebaseFirestore.DocumentReference; data: any; plate: string; at: string
  eventType: "entry" | "exit"; eventId: string; visitId?: string | null
  deviceId: string | null; manual?: boolean; actor?: { uid: string; email: string | null }
  lprExtra?: Record<string, unknown>; patch?: Record<string, unknown>
  create?: boolean; updatePointer?: boolean; unmatched?: boolean
}) {
  const { ref, data, plate, at, eventType } = input
  const wasInside = getLprPresenceState(data).isEffectivelyInside
  const visitId = input.visitId ?? data.lpr?.visitId ?? (eventType === "entry" ? input.eventId : null)
  const delta = eventType === "entry"
    ? (!wasInside && (!data.occupancyIncremented || data.occupancyDecremented) ? 1 : 0)
    : (wasInside && data.occupancyIncremented && !data.occupancyDecremented ? -1 : 0)
  const lpr = {
    ...(data.lpr || {}), ...input.lprExtra,
    isInside: eventType === "entry", visitId,
    lastSeenAt: at, lastEventType: eventType, lastSeenDeviceId: input.deviceId ?? null,
    lastSeenPlateNumber: plate, manualOverride: input.manual === true,
    ...(input.actor ? { manualOverrideAt: FieldValue.serverTimestamp(), manualOverrideByUid: input.actor.uid, manualOverrideByEmail: input.actor.email } : {}),
    ...(eventType === "entry" && !wasInside ? { arrivedAt: at, departedAt: null } : {}),
    ...(eventType === "exit" ? { departedAt: at } : {}),
  }
  const patch = { ...input.patch, lpr, lastUpdated: FieldValue.serverTimestamp(),
    ...(delta === 1 ? { occupancyIncremented: true, occupancyDecremented: false, occupancyIncrementedAt: FieldValue.serverTimestamp() } : {}),
    ...(delta === -1 ? { occupancyDecremented: true, occupancyDecrementedAt: FieldValue.serverTimestamp() } : {}),
  }
  if (input.create) tx.create(ref, patch)
  else tx.update(ref, patch)
  if (input.updatePointer !== false) tx.set(db.collection("lpr_plate_state").doc(plate), {
    bookingId: ref.id, visitId, isInside: eventType === "entry", lastEventAt: at,
    lastEventType: eventType, lastDeviceId: input.deviceId, updatedAt: FieldValue.serverTimestamp(),
  })
  if (delta) tx.set(db.collection("config").doc("parkingLive"), {
    occupiedCount: FieldValue.increment(delta), lastUpdated: FieldValue.serverTimestamp(),
    lastChange: { type: `${eventType}${input.manual ? "_manual_override" : input.unmatched ? "_unmatched" : ""}`, bookingId: ref.id,
      plateNumber: plate, deviceId: input.deviceId ?? null, at,
      ...(input.actor ? { adminUid: input.actor.uid, adminEmail: input.actor.email } : {}),
    },
  }, { merge: true })
  return { visitId, occupancyChanged: delta === 1 ? "incremented" : delta === -1 ? "decremented" : "none" }
}

/** An arrival-time correction is not a gate crossing: preserve the exact presence,
 * visit, departure, latest observation and plate pointer, including legacy millis.
 * The caller validates/version-checks the context and writes the correction audit.
 */
export function correctLprArrival(tx: FirebaseFirestore.Transaction, ref: FirebaseFirestore.DocumentReference,
  data: any, at: string, actor: { uid: string; email: string | null }) {
  tx.update(ref, {
    "lpr.arrivedAt": at, "lpr.arrivalCorrectedAt": FieldValue.serverTimestamp(),
    "lpr.arrivalCorrectedByUid": actor.uid, "lpr.arrivalCorrectedByEmail": actor.email,
    lastUpdated: FieldValue.serverTimestamp(),
  })
  return { visitId: data.lpr?.visitId ?? null, occupancyChanged: "none" }
}
