import { addDoc, collection, doc, getDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { normalizeLicensePlate } from "@/lib/utils"

type Nullable<T> = T | null

export interface LprEventInput {
  plateNumber: Nullable<string>
  laneNo: Nullable<number>
  snapTime: Nullable<string>
  accurateTime: Nullable<string>
  deviceId: Nullable<string>
  direction: Nullable<string>
  raw?: unknown
}

export type LprEventType = "entry" | "exit" | "unknown"

interface MatchedBooking {
  id: string
  licensePlate: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  status: string
  apiBookingNumber?: string
}

function parseToDate(value: Nullable<string>): Date | null {
  if (!value) return null
  // Accept both "YYYY-MM-DD HH:mm:ss" and ISO
  const asIso = value.includes("T") ? value : value.replace(" ", "T")
  const d = new Date(asIso)
  return isNaN(d.getTime()) ? null : d
}

function inferEventType(deviceId: Nullable<string>, direction: Nullable<string>): LprEventType {
  const id = (deviceId || "").toLowerCase()
  const dir = (direction || "").toLowerCase()
  if (id.includes("intrare") || id.includes("entry") || id.includes("gate_in") || dir === "in" || dir === "entry") {
    return "entry"
  }
  if (id.includes("iesire") || id.includes("exit") || id.includes("gate_out") || dir === "out" || dir === "exit") {
    return "exit"
  }
  return "unknown"
}

function withinTolerance(now: Date, start: Date, end: Date, toleranceMinutes: number): boolean {
  const tolMs = toleranceMinutes * 60 * 1000
  return now.getTime() >= start.getTime() - tolMs && now.getTime() <= end.getTime() + tolMs
}

function getBookingWindow(booking: { startDate: string; startTime: string; endDate: string; endTime: string }): { start: Date; end: Date } {
  const start = new Date(`${booking.startDate}T${booking.startTime}:00`)
  const end = new Date(`${booking.endDate}T${booking.endTime}:00`)
  return { start, end }
}

async function findMatchingActiveBookingByPlate(plateNumber: string, eventTime: Date): Promise<MatchedBooking | null> {
  // Active statuses in the app
  const activeStatuses = ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']
  const normalizedTarget = normalizeLicensePlate(plateNumber)
  const today = new Date().toISOString().split("T")[0]

  const bookingsRef = collection(db, "bookings")
  // Broad query: active statuses and not ended before today
  const q = query(
    bookingsRef,
    where("status", "in", activeStatuses),
    where("endDate", ">=", today)
  )
  const snapshot = await getDocs(q)

  let candidates: Array<{ booking: MatchedBooking; score: number }> = []
  snapshot.forEach(docSnap => {
    const data = docSnap.data() as any
    const normalizedDbPlate = normalizeLicensePlate(data.licensePlate || "")
    if (normalizedDbPlate !== normalizedTarget) return
    const { start, end } = getBookingWindow(data)
    // Use 120 min tolerance each side (matches “Acces cu max 2h înainte” UI hint)
    const isInWindow = withinTolerance(eventTime, start, end, 120)
    if (!isInWindow) return
    // Prefer bookings that strictly contain the time; fallback to tolerance
    const strictlyInside = eventTime >= start && eventTime <= end
    const score = strictlyInside ? 2 : 1
    candidates.push({
      booking: {
        id: docSnap.id,
        licensePlate: data.licensePlate,
        startDate: data.startDate,
        startTime: data.startTime,
        endDate: data.endDate,
        endTime: data.endTime,
        status: data.status,
        apiBookingNumber: data.apiBookingNumber
      },
      score
    })
  })

  if (candidates.length === 0) return null
  // Pick highest score, then the one that ends soonest
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const aEnd = new Date(`${a.booking.endDate}T${a.booking.endTime}:00`).getTime()
    const bEnd = new Date(`${b.booking.endDate}T${b.booking.endTime}:00`).getTime()
    return aEnd - bEnd
  })
  return candidates[0].booking
}

export async function handleLprEvent(input: LprEventInput): Promise<{
  savedEventId: string
  matchedBookingId?: string
  eventType: LprEventType
}> {
  const plate = (input.plateNumber || "").trim()
  const normalizedPlate = normalizeLicensePlate(plate)
  const eventType = inferEventType(input.deviceId, input.direction)
  const eventTime = parseToDate(input.accurateTime) || parseToDate(input.snapTime) || new Date()

  // Save raw LPR event
  const eventsCol = collection(db, "lpr_events")
  const saved = await addDoc(eventsCol, {
    plateNumber: plate || null,
    normalizedPlate: normalizedPlate || null,
    laneNo: input.laneNo ?? null,
    deviceId: input.deviceId ?? null,
    direction: input.direction ?? null,
    snapTime: input.snapTime ?? null,
    accurateTime: input.accurateTime ?? null,
    eventType,
    receivedAt: serverTimestamp(),
    raw: input.raw ?? null
  })

  // If no plate, skip matching
  if (!normalizedPlate) {
    return { savedEventId: saved.id, eventType }
  }

  // Try match a booking by plate and time window
  const matched = await findMatchingActiveBookingByPlate(normalizedPlate, eventTime)
  if (!matched) {
    return { savedEventId: saved.id, eventType }
  }

  // Update booking with LPR info
  const bookingRef = doc(db, "bookings", matched.id)
  const bookingSnap = await getDoc(bookingRef)
  const currentLpr = bookingSnap.exists() ? (bookingSnap.data() as any).lpr || {} : {}
  const wasInside: boolean = currentLpr.isInside === true
  const lprUpdate: Record<string, any> = {
    "lpr.lastSeenAt": eventTime.toISOString(),
    "lpr.lastSeenDeviceId": input.deviceId ?? null,
    "lpr.lastSeenLaneNo": input.laneNo ?? null,
    "lpr.lastSeenPlateNumber": normalizedPlate,
    "lpr.lastEventType": eventType,
    "lpr.lastEventAccurateTime": input.accurateTime ?? null,
    lastUpdated: serverTimestamp()
  }
  if (eventType === "entry") {
    lprUpdate["lpr.arrivedAt"] = lprUpdate["lpr.arrivedAt"] ?? eventTime.toISOString()
    lprUpdate["lpr.isInside"] = true
  } else if (eventType === "exit") {
    lprUpdate["lpr.departedAt"] = lprUpdate["lpr.departedAt"] ?? eventTime.toISOString()
    lprUpdate["lpr.isInside"] = false
  }
  await updateDoc(bookingRef, lprUpdate)

  // Also append event to booking subcollection "gateEvents"
  const gateEventsCol = collection(bookingRef, "gateEvents")
  await addDoc(gateEventsCol, {
    eventType,
    plateNumber: normalizedPlate,
    laneNo: input.laneNo ?? null,
    deviceId: input.deviceId ?? null,
    direction: input.direction ?? null,
    snapTime: input.snapTime ?? null,
    accurateTime: input.accurateTime ?? null,
    lprEventId: saved.id,
    createdAt: serverTimestamp()
  })

  // Update live occupancy counter (backward compatible, separate doc)
  if (eventType === "entry" || eventType === "exit") {
    const occupancyDocRef = doc(db, "config", "parkingLive")
    // Ensure doc exists
    await setDoc(occupancyDocRef, { occupiedCount: 0, lastUpdated: serverTimestamp() }, { merge: true })
    // Idempotency: only adjust if state changes
    if (eventType === "entry" && !wasInside) {
      await updateDoc(occupancyDocRef, {
        occupiedCount: increment(1),
        lastUpdated: serverTimestamp(),
        lastChange: {
          type: "entry",
          bookingId: matched.id,
          plateNumber: normalizedPlate,
          deviceId: input.deviceId ?? null,
          at: eventTime.toISOString()
        }
      })
    }
    if (eventType === "exit" && wasInside) {
      await updateDoc(occupancyDocRef, {
        occupiedCount: increment(-1),
        lastUpdated: serverTimestamp(),
        lastChange: {
          type: "exit",
          bookingId: matched.id,
          plateNumber: normalizedPlate,
          deviceId: input.deviceId ?? null,
          at: eventTime.toISOString()
        }
      })
    }
  }

  // Backfill lpr_events with matched booking id
  await updateDoc(doc(db, "lpr_events", saved.id), {
    matchedBookingId: matched.id
  })

  return {
    savedEventId: saved.id,
    matchedBookingId: matched.id,
    eventType
  }
}


