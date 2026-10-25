import "server-only"
import { FieldValue } from "firebase-admin/firestore"
import { adminDb } from "@/lib/firebase-admin"
import { countEffectiveLprOccupancy } from "./lpr-occupancy"

/** Rebuilds only the derived counter; booking/LPR history is never repaired here. */
export async function recalculateLiveOccupancy(actor: string) {
  const ref = adminDb.collection("config").doc("parkingLive")
  return adminDb.runTransaction(async tx => {
    const [counter, inside] = await Promise.all([
      tx.get(ref), tx.get(adminDb.collection("bookings").where("lpr.isInside", "==", true).select("lpr")),
    ])
    const count = countEffectiveLprOccupancy(inside.docs.map(doc => doc.data()))
    const previousCount = counter.data()?.occupiedCount ?? null
    const ignoredStaleInside = inside.size - count
    tx.set(ref, {
      occupiedCount: count, lastUpdated: FieldValue.serverTimestamp(),
      lastChange: { type: "recalculate_from_effective_lpr", actor, previousCount, count, rawInsideCount: inside.size, ignoredStaleInside, at: new Date().toISOString() },
    }, { merge: true })
    return { success: true, occupiedCount: count, previousCount, ignoredStaleInside, repairedStaleInside: 0 }
  })
}
