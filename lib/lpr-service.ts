import { addDoc, collection, db, doc, getDoc, serverTimestamp, updateDoc } from "@/lib/server-firestore"
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
  raw?: unknown
}
export type LprEventType = "entry" | "exit" | "unknown"

function parseToDate(value: Nullable<string>): Date | null {
  if (typeof value !== "string" || !value.trim()) return null
  // Existing deployment stores camera wall-clock values as UTC-labelled ISO.
  // Make that legacy convention deterministic across hosts; explicit offsets remain intact.
  const asIso = value.trim().replace(" ", "T")
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(asIso) ? asIso : `${asIso}Z`
  const d = new Date(withZone)
  return isNaN(d.getTime()) ? null : d
}

function inferEventType(deviceId: Nullable<string>, direction: Nullable<string>): LprEventType {
  const id = typeof deviceId === "string" ? deviceId.toLowerCase() : ""
  const dir = typeof direction === "string" ? direction.toLowerCase() : ""
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
export async function handleLprEvent(input: LprEventInput): Promise<{
  savedEventId: string
  matchedBookingId?: string
  eventType: LprEventType
  degraded?: boolean
  warning?: string
}> {
  const plate = typeof input.plateNumber === "string" ? input.plateNumber.trim() : ""
  const normalizedPlate = normalizeLicensePlate(plate)
  const eventType = inferEventType(input.deviceId, input.direction)
  const eventTime = parseToDate(input.accurateTime) || parseToDate(input.snapTime)
  if (normalizedPlate) {
    try {
      if ((await getDoc(doc(db, "lpr_whitelist", normalizedPlate))).exists()) {
        return { savedEventId: "whitelist_skip", eventType }
      }
    } catch (error) {
      console.error("LPR whitelist check failed", error)
      return { savedEventId: "degraded_no_persist", eventType, degraded: true, warning: "whitelist_check_failed" }
    }
  }
  let saved: any
  try {
    saved = await addDoc(collection(db, "lpr_events"), {
      plateNumber: plate || null, normalizedPlate: normalizedPlate || null,
      laneNo: input.laneNo ?? null, deviceId: input.deviceId ?? null,
      direction: input.direction ?? null, snapTime: input.snapTime ?? null,
      accurateTime: input.accurateTime ?? null, eventType,
      receivedAt: serverTimestamp(), raw: input.raw ?? null,
      associationStatus: "pending",
    })
  } catch (error) {
    console.error("LPR receipt persistence failed", error)
    return { savedEventId: "degraded_no_persist", eventType, degraded: true, warning: "persist_failed" }
  }
  const eventRef = db.collection("lpr_events").doc(saved.id)
  if (!normalizedPlate || !eventTime || eventType === "unknown") {
    const warning = !normalizedPlate ? "missing_plate" : !eventTime ? "invalid_event_time" : "unknown_direction"
    await updateDoc(eventRef, { associationStatus: "needs_review", associationReason: warning })
    return { savedEventId: saved.id, eventType, warning }
  }
  const at = eventTime.toISOString()
  const eventMs = eventTime.getTime()
  // Allocated once, outside the retryable transaction.
  const newBookingRef = db.collection("bookings").doc()
  const stateRef = db.collection("lpr_plate_state").doc(normalizedPlate)
  try {
    return await db.runTransaction(async (tx) => {
      const stateSnap = await tx.get(stateRef)
      const state = stateSnap.data() || {}
      const bookings = db.collection("bookings")
      // Broad queries preserve support for legacy plates containing spaces/dashes.
      // They also find overdue visits, independently of the reservation end date.
      const [byPlate, openRows, activeRows] = await Promise.all([
        tx.get(bookings.where("licensePlate", "==", normalizedPlate)),
        tx.get(bookings.where("lpr.isInside", "==", true)),
        tx.get(bookings.where("status", "in", ACTIVE_STATUSES).where("endDate", ">=",
          new Date(eventMs - TOLERANCE_MS).toISOString().slice(0, 10))),
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
      const all = [...rows.values()]
      const review = (reason: string, ids: string[] = []) => {
        tx.update(eventRef, { associationStatus: "needs_review", associationReason: reason, candidateBookingIds: ids })
        return { savedEventId: saved.id, eventType, warning: reason }
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
          tx.update(eventRef, { associationStatus: "duplicate", matchedBookingId: state.bookingId || null })
          return { savedEventId: saved.id, eventType, ...(state.bookingId ? { matchedBookingId: state.bookingId } : {}) }
        }
        return review("simultaneous_event_requires_review")
      }
      const open = all.filter(row => getLprPresenceState(row.data).isEffectivelyInside)
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
        matchedBookingId: bookingRef.id, visitId,
        associationStatus: isNew || data.status === "unmatched_lpr" ? "unmatched_visit" : "matched",
      })
      return { savedEventId: saved.id, matchedBookingId: bookingRef.id, eventType }
    })
  } catch (error) {
    console.error("LPR atomic association failed", error)
    try { await updateDoc(eventRef, { associationStatus: "needs_review", associationReason: "association_failed" }) } catch {}
    return { savedEventId: saved.id, eventType, degraded: true, warning: "association_failed" }
  }
}
