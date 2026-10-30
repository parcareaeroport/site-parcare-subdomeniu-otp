import "server-only"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { normalizeLicensePlate } from "@/lib/utils"
import { getLprPresenceState } from "@/lib/lpr-presence"
import { ManualExitError, manualExitClock, manualLprInstant } from "@/lib/manual-lpr-exit.server"

export async function readPlateChange(tx: FirebaseFirestore.Transaction, bookingId: string, newPlate: string) {
  const plate = normalizeLicensePlate(newPlate)
  if (!plate || plate.length > 20) throw new ManualExitError("INVALID_PLATE", "Număr de înmatriculare invalid.")
  const ref = adminDb.collection("bookings").doc(bookingId), snap = await tx.get(ref)
  if (!snap.exists) throw new ManualExitError("NOT_FOUND", "Rezervarea nu mai există.", 404)
  const b = snap.data()!, oldPlate = normalizeLicensePlate(String(b.licensePlate || ""))
  if (!oldPlate) throw new ManualExitError("INVALID_PLATE", "Numărul curent lipsește. Necesită verificare ADMIN.")
  const oldRef = adminDb.collection("lpr_plate_state").doc(oldPlate), newRef = adminDb.collection("lpr_plate_state").doc(plate)
  const [oldState, newState, rows] = await Promise.all([tx.get(oldRef), tx.get(newRef), tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true))])
  const conflicts = rows.docs.filter(d => d.id !== bookingId && [oldPlate, plate].includes(normalizeLicensePlate(String(d.data().licensePlate || ""))) && getLprPresenceState(d.data()).isEffectivelyInside)
  const inside = getLprPresenceState(b).isEffectivelyInside
  const version = createHash("sha256").update(JSON.stringify([plate, snap.updateTime, oldState.updateTime, newState.updateTime, conflicts.map(d => [d.id, d.updateTime])])).digest("hex")
  return {ref, b, plate, oldPlate, oldRef, newRef, oldState, newState, inside, conflicts, version}
}
export function assertPlateChange(ctx: Awaited<ReturnType<typeof readPlateChange>>, allowPresent: boolean) {
  if (ctx.plate === ctx.oldPlate) return
  if (ctx.conflicts.length || (ctx.newState.data()?.isInside === true && ctx.newState.data()?.bookingId !== ctx.ref.id)) throw new ManualExitError("DUPLICATE_PLATE", "Necesită verificare ADMIN: numărul este asociat unei alte șederi prezente.", 409)
  if ((ctx.inside || ctx.b.lpr?.isInside === true) && !allowPresent) throw new ManualExitError("VEHICLE_PRESENT", "Mașina este prezentă. Corectează numărul din Bookings → Modifică nr., cu verificarea șederii.", 409)
  if (ctx.inside && ctx.oldState.exists && ctx.oldState.data()?.isInside && (ctx.oldState.data()?.bookingId !== ctx.ref.id || ctx.oldState.data()?.visitId !== ctx.b.lpr?.visitId)) throw new ManualExitError("AMBIGUOUS_VISIT", "Referința șederii este neclară. Necesită verificare ADMIN.", 409)
}
export function writePlateChange(tx: FirebaseFirestore.Transaction, ctx: Awaited<ReturnType<typeof readPlateChange>>, actor: {uid: string | null; email: string | null; reason?: string}, confirmed = false) {
  if (ctx.plate === ctx.oldPlate) return
  tx.update(ctx.ref, { licensePlate: ctx.plate, originalLicensePlate: ctx.b.originalLicensePlate || ctx.b.licensePlate,
    licensePlateUpdatedAt: FieldValue.serverTimestamp(), licensePlateUpdatedByEmail: actor.email, lastUpdated: FieldValue.serverTimestamp() })
  // Both plate documents were read: simultaneous cameras/corrections conflict and retry.
  if (ctx.inside) {
    const realNow = new Date(), through = manualExitClock(realNow)
    const visitId = ctx.b.lpr?.visitId || `plate_correction_${ctx.ref.id}`
    tx.update(ctx.ref, { "lpr.visitId": visitId, "lpr.lastSeenPlateNumber": ctx.plate })
    tx.set(ctx.newRef, { bookingId: ctx.ref.id, visitId, isInside: true, lastEventAt: ctx.b.lpr?.lastSeenAt || ctx.b.lpr?.arrivedAt || null,
      lastEventAtInstant: ctx.b.lpr?.lastSeenAt ? ctx.b.lpr?.lastSeenAtInstant ?? null : ctx.b.lpr?.arrivedAtInstant ?? null,
      lastEventType: ctx.b.lpr?.lastEventType || "entry", lastDeviceId: ctx.b.lpr?.lastSeenDeviceId || null, updatedAt: FieldValue.serverTimestamp() })
    // Historical stays may have no old pointer. Always retain a boundary on the
    // old number, otherwise a delayed reading creates a second unmatched visit.
    // Keep the original event time separate from the admin correction time: the
    // correction is not a camera departure. Preserve any other pointer's history.
    tx.set(ctx.oldRef, {
      ...(!ctx.oldState.exists ? { bookingId: ctx.ref.id, visitId, isInside: false,
        lastEventAt: ctx.b.lpr?.lastSeenAt || ctx.b.lpr?.arrivedAt || null,
        lastEventAtInstant: ctx.b.lpr?.lastSeenAt ? ctx.b.lpr?.lastSeenAtInstant ?? null : ctx.b.lpr?.arrivedAtInstant ?? null,
        lastEventType: ctx.b.lpr?.lastEventType || "entry", lastDeviceId: ctx.b.lpr?.lastSeenDeviceId || null } : {}),
      ...(ctx.oldState.data()?.bookingId === ctx.ref.id ? { isInside: false } : {}),
      plateCorrectedTo: ctx.plate,
      plateCorrection: { bookingId: ctx.ref.id, visitId, correctedTo: ctx.plate, through, throughInstant: manualLprInstant(through, true, realNow) },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }
  // Retain event ordering on the old number; it is no longer an open pointer.
  if (!ctx.inside && ctx.oldState.data()?.bookingId === ctx.ref.id) tx.set(ctx.oldRef, { isInside: false, plateCorrectedTo: ctx.plate, updatedAt: FieldValue.serverTimestamp() }, {merge:true})
  tx.set(ctx.ref.collection("plateCorrections").doc(), { from:ctx.oldPlate, to:ctx.plate, inside:ctx.inside, confirmedPresentCorrection:confirmed, actorUid:actor.uid, actorEmail:actor.email, reason:actor.reason || null, at:FieldValue.serverTimestamp() })
}
export async function preparePlateChange(bookingId: string, plate: string) {
  return adminDb.runTransaction(async tx => {
    const ctx = await readPlateChange(tx, bookingId, plate)
    assertPlateChange(ctx, true)
    if (ctx.b.modificationApplying) throw new ManualExitError("MODIFICATION_IN_PROGRESS", "Există o modificare în curs. Reîncearcă după finalizare.", 409)
    return {version:ctx.version, inside:ctx.inside, oldPlate:ctx.oldPlate, newPlate:ctx.plate, bookingId, arrival:ctx.b.lpr?.arrivedAt || null}
  })
}
export async function savePlateChange(input: {bookingId:string; plate:string; version:string; confirmPresent?:boolean}, actor: {uid:string; email:string|null}) {
  return adminDb.runTransaction(async tx => {
    const ctx = await readPlateChange(tx, input.bookingId, input.plate)
    if (ctx.version !== input.version) throw new ManualExitError("CONTEXT_CHANGED", "Datele s-au schimbat. Reîncarcă și verifică șederea.", 409)
    if (ctx.b.modificationApplying) throw new ManualExitError("MODIFICATION_IN_PROGRESS", "Există o modificare în curs.", 409)
    assertPlateChange(ctx, input.confirmPresent === true)
    writePlateChange(tx, ctx, actor, input.confirmPresent === true)
    return {success:true}
  })
}
