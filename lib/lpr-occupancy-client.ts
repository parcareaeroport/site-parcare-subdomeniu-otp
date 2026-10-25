import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { countEffectiveLprOccupancy } from "./lpr-occupancy"

const insideQuery = () => query(collection(db, "bookings"), where("lpr.isInside", "==", true))
export async function readEffectiveLprOccupancy() {
  const snapshot = await getDocs(insideQuery())
  return countEffectiveLprOccupancy(snapshot.docs.map(doc => doc.data()))
}
export function subscribeEffectiveLprOccupancy(onCount: (count: number) => void, onError: (error: Error) => void) {
  return onSnapshot(insideQuery(), snapshot => {
    onCount(countEffectiveLprOccupancy(snapshot.docs.map(doc => doc.data())))
  }, onError)
}
