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
  occupancyIncremented?: boolean
  occupancyDecremented?: boolean
  source?: string
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

function parseBookingDateTime(dateStr?: string, timeStr?: string): Date | null {
  const d = (dateStr || "").trim()
  const t = (timeStr || "").trim()
  if (!d || !t) return null

  // Accept HH:mm and HH:mm:ss
  const normalizedTime =
    t.length === 5 ? `${t}:00` : t.length === 8 ? t : t

  const dt = new Date(`${d}T${normalizedTime}`)
  if (!Number.isNaN(dt.getTime())) return dt

  // Fallback: try legacy "YYYY-MM-DD HH:mm:ss"
  const dt2 = new Date(`${d} ${normalizedTime}`)
  return Number.isNaN(dt2.getTime()) ? null : dt2
}

function getBookingWindow(
  booking: { startDate: string; startTime: string; endDate: string; endTime: string }
): { start: Date; end: Date } | null {
  const start = parseBookingDateTime(booking.startDate, booking.startTime)
  const end = parseBookingDateTime(booking.endDate, booking.endTime)
  if (!start || !end) return null
  return { start, end }
}

async function findMatchingActiveBookingByPlate(
  plateNumber: string,
  eventTime: Date,
  eventType: LprEventType,
): Promise<MatchedBooking | null> {
  // Active statuses in the app
  const activeStatuses = ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']
  const normalizedTarget = normalizeLicensePlate(plateNumber)
  // IMPORTANT: match relative to the event time day, not "server today" (prevents missing matches on timezone/date boundary).
  const eventDay = eventTime.toISOString().split("T")[0]

  const bookingsRef = collection(db, "bookings")
  // Broad query: active statuses and not ended before the event day
  // NOTE: this may miss some edge cases (e.g. manual bookings with unexpected status),
  // so we also have a plate-specific fallback below.
  const q = query(bookingsRef, where("status", "in", activeStatuses), where("endDate", ">=", eventDay))
  let snapshot = await getDocs(q)

  let candidates: Array<{
    booking: MatchedBooking
    inWindow: boolean
    strictlyInside: boolean
    distanceMin: number
    preferState: number
    preferSource: number
  }> = []
  const pushCandidate = (docSnap: any) => {
    const data = docSnap.data() as any
    const normalizedDbPlate = normalizeLicensePlate(data.licensePlate || "")
    if (normalizedDbPlate !== normalizedTarget) return
    // Never match against unmatched_lpr placeholders.
    if (data.status === "unmatched_lpr") return

    const lprInside = data?.lpr?.isInside === true
    // Prefer bookings that align with the event direction:
    // - entry: prefer not already inside
    // - exit: prefer already inside
    const preferState =
      eventType === "exit" ? (lprInside ? 1 : 0) : eventType === "entry" ? (lprInside ? 0 : 1) : 0
    // Prefer manual bookings when plate collides (admin expects LPR to fill the manual row, not create a new one).
    const preferSource = data.source === "manual" ? 1 : 0

    const window = getBookingWindow({
      startDate: data.startDate,
      startTime: data.startTime,
      endDate: data.endDate,
      endTime: data.endTime,
    })

    // If we can parse the window, compute a good match score; otherwise keep as weaker fallback.
    let inWindow = false
    let strictlyInside = false
    let distanceMin = Number.POSITIVE_INFINITY
    if (window) {
      const { start, end } = window
      // Use 120 min tolerance each side (matches “Acces cu max 2h înainte” UI hint)
      inWindow = withinTolerance(eventTime, start, end, 120)
      strictlyInside = eventTime >= start && eventTime <= end
      const anchor = eventType === "exit" ? end : start
      distanceMin = Math.abs(Math.round((eventTime.getTime() - anchor.getTime()) / (1000 * 60)))
    }

    candidates.push({
      booking: {
        id: docSnap.id,
        licensePlate: data.licensePlate,
        startDate: data.startDate,
        startTime: data.startTime,
        endDate: data.endDate,
        endTime: data.endTime,
        status: data.status,
        apiBookingNumber: data.apiBookingNumber,
        occupancyIncremented: data.occupancyIncremented,
        occupancyDecremented: data.occupancyDecremented,
        source: data.source,
      },
      inWindow,
      strictlyInside,
      distanceMin,
      preferState,
      preferSource,
    })
  }

  snapshot.forEach(pushCandidate)

  // Fallback: If the broad status-based query returned no plate matches, do a plate-specific lookup.
  // This prevents creating new unmatched_lpr records when an admin-created manual booking exists but has an unexpected status/value.
  if (candidates.length === 0 && normalizedTarget) {
    try {
      const qByPlate = query(bookingsRef, where("licensePlate", "==", normalizedTarget))
      snapshot = await getDocs(qByPlate)
      snapshot.forEach(pushCandidate)
    } catch (e) {
      // If fallback fails (indexes/permissions), we'll behave as "no match".
      console.error("LPR: fallback plate-only lookup failed", e)
    }
  }

  if (candidates.length === 0) return null

  // Prefer candidates inside the (start..end) window (with tolerance),
  // then by state alignment (exit prefers inside, entry prefers outside),
  // then prefer manual source (admin-created row should receive the LPR),
  // then by distance to expected anchor (entry≈start, exit≈end),
  // then by earliest end (stable).
  candidates.sort((a, b) => {
    if (a.inWindow !== b.inWindow) return a.inWindow ? -1 : 1
    if (a.strictlyInside !== b.strictlyInside) return a.strictlyInside ? -1 : 1
    if (a.preferState !== b.preferState) return b.preferState - a.preferState
    if (a.preferSource !== b.preferSource) return b.preferSource - a.preferSource
    if (a.distanceMin !== b.distanceMin) return a.distanceMin - b.distanceMin
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
  try {
    console.log('🟦 [LPR] handleLprEvent START', {
      input: {
        plateNumber: input.plateNumber,
        laneNo: input.laneNo,
        snapTime: input.snapTime,
        accurateTime: input.accurateTime,
        deviceId: input.deviceId,
        direction: input.direction
      }
    })
  } catch {}

  const plate = (input.plateNumber || "").trim()
  const normalizedPlate = normalizeLicensePlate(plate)
  const eventType = inferEventType(input.deviceId, input.direction)
  const eventTime = parseToDate(input.accurateTime) || parseToDate(input.snapTime) || new Date()
  try {
    console.log('🧮 [LPR] Derived event details', {
      normalizedPlate,
      eventType,
      deviceId: input.deviceId,
      direction: input.direction,
      eventTimeIso: eventTime?.toISOString()
    })
  } catch {}

  // Whitelist short-circuit: dacă plăcuța este în `lpr_whitelist`, nu facem nicio acțiune
  if (normalizedPlate) {
    try {
      const whitelistDoc = await getDoc(doc(db, "lpr_whitelist", normalizedPlate))
      if (whitelistDoc.exists()) {
        console.log('⛔ [LPR] Plate is whitelisted, skipping all processing', { normalizedPlate })
        return {
          savedEventId: "whitelist_skip",
          eventType,
        }
      }
    } catch (e) {
      console.error('❌ [LPR] Failed to check whitelist, continuing processing', e)
    }
  }

  // Save raw LPR event
  const eventsCol = collection(db, "lpr_events")
  let saved
  try {
    saved = await addDoc(eventsCol, {
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
    console.log('💾 [LPR] Event persisted', { lprEventId: saved.id })
  } catch (e) {
    console.error('❌ [LPR] Failed to persist LPR event', e)
    throw e
  }

  // If no plate, skip matching
  if (!normalizedPlate) {
    console.warn('⚠️ [LPR] Missing plate number - skipping booking match')
    return { savedEventId: saved.id, eventType }
  }

  // Try match a booking by plate and time window
  let matched: MatchedBooking | null = null
  try {
    console.log('🔍 [LPR] Attempting to match booking', {
      normalizedPlate,
      eventTimeIso: eventTime.toISOString()
    })
    matched = await findMatchingActiveBookingByPlate(normalizedPlate, eventTime, eventType)
    if (!matched) {
      console.warn('ℹ️ [LPR] No active booking matched for plate/time window', {
        normalizedPlate,
        eventType,
        eventTimeIso: eventTime.toISOString()
      })
      // Handle UNMATCHED flow: introducem mașina în lista de rezervări (bookings) cu status special
      const bookingsRef = collection(db, "bookings")
      try {
        if (eventType === "entry") {
          // Căutăm dacă există deja o rezervare LPR deschisă pentru această plăcuță
          const q = query(
            bookingsRef,
            where("status", "==", "unmatched_lpr"),
            where("lpr.isInside", "==", true),
            where("licensePlate", "==", normalizedPlate)
          )
          const snap = await getDocs(q)
          if (!snap.empty) {
            console.log('⏭️ [LPR] Unmatched entry but already inside - updating lastSeen (booking unmatched_lpr)', { count: snap.size })
            const docSnap = snap.docs[0]
            await updateDoc(doc(db, "bookings", docSnap.id), {
              "lpr.lastSeenAt": eventTime.toISOString(),
              "lpr.lastSeenDeviceId": input.deviceId ?? null,
              "lpr.lastEventType": eventType,
              lastUpdated: serverTimestamp()
            })
          } else {
            console.log('➕ [LPR] Creating unmatched_lpr booking record (entry)')
            const startDateStr = eventTime.toISOString().split("T")[0]
            const timePart = eventTime.toTimeString().slice(0, 5) // HH:mm
            const newDocRef = await addDoc(bookingsRef, {
              licensePlate: normalizedPlate,
              source: "lpr",
              status: "unmatched_lpr",
              startDate: startDateStr,
              startTime: timePart,
              endDate: "",
              endTime: "",
              durationMinutes: 0,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp(),
              lpr: {
                isInside: true,
                arrivedAt: eventTime.toISOString(),
                lastSeenAt: eventTime.toISOString(),
                lastSeenDeviceId: input.deviceId ?? null,
                lastEventType: eventType
              },
              occupancyIncremented: true,
              occupancyIncrementedAt: serverTimestamp()
            })
            console.log('✅ [LPR] Unmatched booking created', { bookingId: newDocRef.id })
            // Increment occupancy pentru intrare fără rezervare
            try {
              const occupancyDocRef = doc(db, "config", "parkingLive")
              // IMPORTANT: do not write occupiedCount=0 here (it would reset the counter on every event)
              await setDoc(occupancyDocRef, { lastUpdated: serverTimestamp() }, { merge: true })
              await updateDoc(occupancyDocRef, {
                occupiedCount: increment(1),
                lastUpdated: serverTimestamp(),
                lastChange: {
                  type: "entry_unmatched",
                  bookingId: newDocRef.id,
                  plateNumber: normalizedPlate,
                  deviceId: input.deviceId ?? null,
                  at: eventTime.toISOString()
                }
              })
            } catch (e) {
              console.error('❌ [LPR] Failed to increment occupancy for unmatched entry', e)
            }
          }
        } else if (eventType === "exit") {
          const q = query(
            bookingsRef,
            where("status", "==", "unmatched_lpr"),
            where("lpr.isInside", "==", true),
            where("licensePlate", "==", normalizedPlate)
          )
          const snap = await getDocs(q)
          if (!snap.empty) {
            const docSnap = snap.docs[0]
            console.log('🚪 [LPR] Marking unmatched_lpr booking as exited', { bookingId: docSnap.id })

            const data: any = docSnap.data()
            const startDate = data.startDate
            const startTime = data.startTime
            let durationMinutes = data.durationMinutes || 0
            if (startDate && startTime) {
              const startTs = new Date(`${startDate}T${startTime}:00`).getTime()
              const endTs = eventTime.getTime()
              if (!Number.isNaN(startTs) && endTs > startTs) {
                durationMinutes = Math.round((endTs - startTs) / (1000 * 60))
              }
            }

            const occupancyIncrementedFlag = data.occupancyIncremented === true
            const occupancyDecrementedFlag = data.occupancyDecremented === true

            await updateDoc(doc(db, "bookings", docSnap.id), {
              "lpr.isInside": false,
              "lpr.departedAt": eventTime.toISOString(),
              "lpr.lastSeenAt": eventTime.toISOString(),
              "lpr.lastSeenDeviceId": input.deviceId ?? null,
              "lpr.lastEventType": eventType,
              endDate: eventTime.toISOString().split("T")[0],
              endTime: eventTime.toTimeString().slice(0, 5),
              durationMinutes,
              lastUpdated: serverTimestamp(),
              ...(occupancyIncrementedFlag && !occupancyDecrementedFlag
                ? {
                    occupancyDecremented: true,
                    occupancyDecrementedAt: serverTimestamp()
                  }
                : {})
            })
            // Decrement occupancy pentru ieșire fără rezervare (idempotent)
            if (occupancyIncrementedFlag && !occupancyDecrementedFlag) {
            try {
              const occupancyDocRef = doc(db, "config", "parkingLive")
              // IMPORTANT: do not write occupiedCount=0 here (it would reset the counter on every event)
              await setDoc(occupancyDocRef, { lastUpdated: serverTimestamp() }, { merge: true })
              await updateDoc(occupancyDocRef, {
                occupiedCount: increment(-1),
                lastUpdated: serverTimestamp(),
                lastChange: {
                  type: "exit_unmatched",
                  bookingId: docSnap.id,
                  plateNumber: normalizedPlate,
                  deviceId: input.deviceId ?? null,
                  at: eventTime.toISOString()
                }
              })
            } catch (e) {
              console.error('❌ [LPR] Failed to decrement occupancy for unmatched exit', e)
              }
            } else {
              console.log('⏭️ [LPR] Skip unmatched decrement: already decremented or never incremented')
            }
          } else {
            console.log('ℹ️ [LPR] Exit received for unmatched plate but no open record found - skipping')
          }
        } else {
          console.log('ℹ️ [LPR] Unknown eventType for unmatched flow - no state changes')
        }
      } catch (e) {
        console.error('❌ [LPR] Unmatched flow failed', e)
      }
      return { savedEventId: saved.id, eventType }
    }
    console.log('🎯 [LPR] Matched booking', {
      bookingId: matched.id,
      licensePlate: matched.licensePlate,
      start: `${matched.startDate} ${matched.startTime}`,
      end: `${matched.endDate} ${matched.endTime}`,
      status: matched.status
    })
  } catch (e) {
    console.error('❌ [LPR] Booking match failed with exception', e)
    return { savedEventId: saved.id, eventType }
  }

  // Update booking with LPR info
  const bookingRef = doc(db, "bookings", matched.id)
  let wasInside = false
  let occupancyIncrementedFlag = false
  let occupancyDecrementedFlag = false
  try {
    const bookingSnap = await getDoc(bookingRef)
    const currentLpr = bookingSnap.exists() ? (bookingSnap.data() as any).lpr || {} : {}
    wasInside = currentLpr.isInside === true
    occupancyIncrementedFlag = bookingSnap.exists() ? (bookingSnap.data() as any).occupancyIncremented === true : false
    occupancyDecrementedFlag = bookingSnap.exists() ? (bookingSnap.data() as any).occupancyDecremented === true : false
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
      // Ensure we always store a stable ISO string (UI expects string; old data might be Timestamp)
      const existingArrived =
        typeof currentLpr.arrivedAt === "string" && !Number.isNaN(new Date(currentLpr.arrivedAt).getTime())
          ? currentLpr.arrivedAt
          : null
      lprUpdate["lpr.arrivedAt"] = existingArrived || eventTime.toISOString()
      lprUpdate["lpr.isInside"] = true
      if (!occupancyIncrementedFlag) {
        lprUpdate["occupancyIncremented"] = true
        lprUpdate["occupancyIncrementedAt"] = serverTimestamp()
      }
    } else if (eventType === "exit") {
      // Ensure we always store a stable ISO string (UI expects string; old data might be Timestamp)
      const existingDeparted =
        typeof currentLpr.departedAt === "string" && !Number.isNaN(new Date(currentLpr.departedAt).getTime())
          ? currentLpr.departedAt
          : null
      lprUpdate["lpr.departedAt"] = existingDeparted || eventTime.toISOString()
      lprUpdate["lpr.isInside"] = false
      if (occupancyIncrementedFlag && !occupancyDecrementedFlag) {
        lprUpdate["occupancyDecremented"] = true
        lprUpdate["occupancyDecrementedAt"] = serverTimestamp()
      }
    }
    console.log('🛠️ [LPR] Updating booking with LPR info', {
      bookingId: matched.id,
      wasInside,
      applying: { ...lprUpdate, lastUpdated: '[serverTimestamp]' }
    })
    await updateDoc(bookingRef, lprUpdate)
    console.log('✅ [LPR] Booking updated with LPR info', { bookingId: matched.id })
  } catch (e) {
    console.error('❌ [LPR] Failed to update booking with LPR info', e)
  }

  // Also append event to booking subcollection "gateEvents"
  try {
    const gateEventsCol = collection(bookingRef, "gateEvents")
    const gateRef = await addDoc(gateEventsCol, {
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
    console.log('📝 [LPR] Gate event appended to booking', { bookingId: matched.id, gateEventId: gateRef.id })
  } catch (e) {
    console.error('❌ [LPR] Failed to append gate event', e)
  }

  // Update live occupancy counter (backward compatible, separate doc)
  if (eventType === "entry" || eventType === "exit") {
    const occupancyDocRef = doc(db, "config", "parkingLive")
    try {
      // IMPORTANT: don't reset occupiedCount here; just ensure the doc exists
      await setDoc(occupancyDocRef, { lastUpdated: serverTimestamp() }, { merge: true })
    } catch (e) {
      console.error('❌ [LPR] Failed ensuring parkingLive doc', e)
    }
    // Idempotency: only adjust if state changes
    if (eventType === "entry" && !wasInside && !occupancyIncrementedFlag) {
      try {
        console.log('➕ [LPR] Increment occupiedCount (entry)', { bookingId: matched.id })
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
      } catch (e) {
        console.error('❌ [LPR] Failed to increment occupiedCount', e)
      }
    } else if (eventType === "entry" && wasInside) {
        console.log('⏭️ [LPR] Skip increment: already inside/occupancy counted (idempotent)')
    }
    if (eventType === "exit" && wasInside && occupancyIncrementedFlag && !occupancyDecrementedFlag) {
      try {
        console.log('➖ [LPR] Decrement occupiedCount (exit)', { bookingId: matched.id })
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
      } catch (e) {
        console.error('❌ [LPR] Failed to decrement occupiedCount', e)
      }
    } else if (eventType === "exit" && (!wasInside || occupancyDecrementedFlag || !occupancyIncrementedFlag)) {
      console.log('⏭️ [LPR] Skip decrement: already outside or occupancy already decremented (idempotent)')
    }
  }

  // Backfill lpr_events with matched booking id
  try {
    await updateDoc(doc(db, "lpr_events", saved.id), {
      matchedBookingId: matched.id
    })
    console.log('🔗 [LPR] Linked lpr_events to booking', { lprEventId: saved.id, bookingId: matched.id })
  } catch (e) {
    console.error('❌ [LPR] Failed to backfill lpr_events with matched booking id', e)
  }

  const result = {
    savedEventId: saved.id,
    matchedBookingId: matched.id,
    eventType
  }
  try {
    console.log('🏁 [LPR] handleLprEvent DONE', result)
  } catch {}
  return result
}


