import { lprTransaction, lprLog } from "@/lib/lpr-log.server"
import "server-only"
import { createHash } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { normalizeLicensePlate } from "@/lib/utils"
import { ManualExitError } from "@/lib/manual-lpr-exit.server"

async function readContext(tx: FirebaseFirestore.Transaction, eventId:string) {
  const ref = adminDb.collection("lpr_events").doc(eventId), snap = await tx.get(ref)
  if (!snap.exists) throw new ManualExitError("NOT_FOUND","Evenimentul nu mai există.",404)
  const event = snap.data()!, plate = String(event.normalizedPlate || "")
  const [rows, pointer] = await Promise.all([
    tx.get(adminDb.collection("bookings").where("lpr.isInside","==",true)),
    plate ? tx.get(adminDb.collection("lpr_plate_state").doc(plate)) : Promise.resolve(null),
  ])
  const present = rows.docs.filter(d => normalizeLicensePlate(String(d.data().licensePlate || "")) === plate)
  const version = createHash("sha256").update(JSON.stringify([snap.updateTime,pointer?.updateTime,present.map(d => [d.id,d.updateTime])])).digest("hex")
  return {ref,event,version}
}
export async function reviewLprEvent(input:{eventId:string;action:string;version?:string;note?:string;confirmed?:boolean}, actor:{uid:string;email:string|null}) {
  return lprTransaction(adminDb, async tx => {
    const ctx = await readContext(tx,input.eventId)
    lprLog("admin_review",{action:input.action,eventId:input.eventId,plate:ctx.event.normalizedPlate,actorUid:actor.uid,confirmed:input.confirmed,occupancyDelta:0})
    if (input.action === "prepare") return {version:ctx.version}
    if (ctx.version !== input.version) throw new ManualExitError("CONTEXT_CHANGED","Evenimentul sau prezența s-au schimbat. Reîncarcă verificarea.",409)
    if (!["pending","needs_review"].includes(ctx.event.associationStatus)) throw new ManualExitError("ALREADY_HANDLED","Evenimentul este deja procesat.",409)
    if (input.action === "retry") {
      if (ctx.event.associationStatus !== "pending" && ctx.event.associationReason !== "association_failed") throw new ManualExitError("MANUAL_REVIEW_REQUIRED","Evenimentul ambiguu necesită verificarea mașinii și a rezervării; nu se reasociază automat.")
      tx.update(ctx.ref,{associationStatus:"pending",attempts:0,nextAttemptAt:0,retryRequestedBy:actor.uid})
      return {success:true}
    }
    if (input.action !== "resolve" || input.confirmed !== true || !input.note?.trim() || input.note.length > 1000) throw new ManualExitError("CONFIRM_REVIEW","Confirmă verificarea fizică și explică ce ai verificat/corectat.")
    // This acknowledges a human reconciliation, never guesses a booking or changes occupancy.
    tx.update(ctx.ref,{associationStatus:"reviewed",nextAttemptAt:FieldValue.delete(),review:{uid:actor.uid,email:actor.email,note:input.note.trim(),at:FieldValue.serverTimestamp(),previousStatus:ctx.event.associationStatus,reason:ctx.event.associationReason || null}})
    return {success:true}
  })
}
