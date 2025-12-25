import { db } from "@/lib/firebase"
import {
  addDoc,
  collection,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore"

export type ManualLprEventType = "entry" | "exit"

export type ManualLprEventInput = {
  bookingId: string
  plateNumber: string
  eventType: ManualLprEventType
  /**
   * IMPORTANT:
   * We store ISO strings with "Z" to match the existing LPR semantics in this project:
   * UI compares scheduled times by parsing as UTC ("...Z"), and LPR times are stored as ISO strings.
   */
  eventTimeIsoZ: string

  // Optional metadata (we default these for manual/admin events)
  deviceId?: string | null
  laneNo?: number | null
  direction?: string | null
  accurateTime?: string | null
  snapTime?: string | null

  // Admin/audit info (optional but recommended)
  adminUid?: string | null
  adminEmail?: string | null
}

export async function writeManualLprEvent(input: ManualLprEventInput): Promise<{
  lprEventId: string
  gateEventId: string
  occupancyChanged: "incremented" | "decremented" | "none"
}> {
  const bookingRef = doc(db, "bookings", input.bookingId)
  const occupancyRef = doc(db, "config", "parkingLive")

  const bookingSnap = await getDoc(bookingRef)
  if (!bookingSnap.exists()) {
    throw new Error("Booking not found")
  }
  const booking: any = bookingSnap.data() || {}
  const currentLpr: any = booking.lpr || {}

  const wasInside = currentLpr.isInside === true
  const occupancyIncrementedFlag = booking.occupancyIncremented === true
  const occupancyDecrementedFlag = booking.occupancyDecremented === true

  const normalizedPlate = String(input.plateNumber || "").trim()
  const deviceId = input.deviceId ?? "manual_admin"
  const laneNo = input.laneNo ?? null
  const direction = input.direction ?? "manual"
  const accurateTime = input.accurateTime ?? input.eventTimeIsoZ
  const snapTime = input.snapTime ?? input.eventTimeIsoZ

  // 1) Persist raw LPR event (mirrors `lib/lpr-service.ts`)
  const lprEventRef = await addDoc(collection(db, "lpr_events"), {
    plateNumber: normalizedPlate || null,
    normalizedPlate: normalizedPlate || null,
    laneNo,
    deviceId,
    direction,
    snapTime,
    accurateTime,
    eventType: input.eventType,
    receivedAt: serverTimestamp(),
    raw: {
      manual: true,
      bookingId: input.bookingId,
      adminUid: input.adminUid ?? null,
      adminEmail: input.adminEmail ?? null,
    },
  })

  // 2) Update booking with LPR info + idempotent occupancy flags
  const lprUpdate: Record<string, any> = {
    "lpr.lastSeenAt": input.eventTimeIsoZ,
    "lpr.lastSeenDeviceId": deviceId,
    "lpr.lastSeenLaneNo": laneNo,
    "lpr.lastSeenPlateNumber": normalizedPlate || null,
    "lpr.lastEventType": input.eventType,
    "lpr.lastEventAccurateTime": accurateTime,
    "lpr.manualOverride": true,
    "lpr.manualOverrideAt": serverTimestamp(),
    "lpr.manualOverrideByUid": input.adminUid ?? null,
    "lpr.manualOverrideByEmail": input.adminEmail ?? null,
    lastUpdated: serverTimestamp(),
  }

  let occupancyChanged: "incremented" | "decremented" | "none" = "none"

  if (input.eventType === "entry") {
    lprUpdate["lpr.arrivedAt"] = input.eventTimeIsoZ
    lprUpdate["lpr.isInside"] = true
    if (!occupancyIncrementedFlag) {
      lprUpdate["occupancyIncremented"] = true
      lprUpdate["occupancyIncrementedAt"] = serverTimestamp()
    }
  } else {
    lprUpdate["lpr.departedAt"] = input.eventTimeIsoZ
    lprUpdate["lpr.isInside"] = false
    if (occupancyIncrementedFlag && !occupancyDecrementedFlag) {
      lprUpdate["occupancyDecremented"] = true
      lprUpdate["occupancyDecrementedAt"] = serverTimestamp()
    }
  }

  await updateDoc(bookingRef, lprUpdate)

  // 3) Append event to booking subcollection `gateEvents`
  const gateEventRef = await addDoc(collection(bookingRef, "gateEvents"), {
    eventType: input.eventType,
    plateNumber: normalizedPlate || null,
    laneNo,
    deviceId,
    direction,
    snapTime,
    accurateTime,
    lprEventId: lprEventRef.id,
    createdAt: serverTimestamp(),
    manual: true,
    adminUid: input.adminUid ?? null,
    adminEmail: input.adminEmail ?? null,
  })

  // 4) Update live occupancy doc idempotently (same semantics as `lib/lpr-service.ts`)
  await setDoc(occupancyRef, { lastUpdated: serverTimestamp() }, { merge: true })

  if (input.eventType === "entry") {
    // Only adjust if state changes and occupancy wasn't already counted
    if (!wasInside && !occupancyIncrementedFlag) {
      await updateDoc(occupancyRef, {
        occupiedCount: increment(1),
        lastUpdated: serverTimestamp(),
        lastChange: {
          type: "entry_manual_override",
          bookingId: input.bookingId,
          plateNumber: normalizedPlate,
          deviceId,
          at: input.eventTimeIsoZ,
          adminUid: input.adminUid ?? null,
          adminEmail: input.adminEmail ?? null,
        },
      })
      occupancyChanged = "incremented"
    }
  } else {
    if (wasInside && occupancyIncrementedFlag && !occupancyDecrementedFlag) {
      await updateDoc(occupancyRef, {
        occupiedCount: increment(-1),
        lastUpdated: serverTimestamp(),
        lastChange: {
          type: "exit_manual_override",
          bookingId: input.bookingId,
          plateNumber: normalizedPlate,
          deviceId,
          at: input.eventTimeIsoZ,
          adminUid: input.adminUid ?? null,
          adminEmail: input.adminEmail ?? null,
        },
      })
      occupancyChanged = "decremented"
    }
  }

  return { lprEventId: lprEventRef.id, gateEventId: gateEventRef.id, occupancyChanged }
}


