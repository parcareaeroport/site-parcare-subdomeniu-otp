import "server-only"
import { getLprPresenceState, lprTimestampToMillis } from "./lpr-presence"
import { normalizeLicensePlate } from "./utils"
import { bookingLprTimes, compareLprTimes, lprTime, type LprTime } from "./lpr-time"

type Snapshot = FirebaseFirestore.DocumentSnapshot
export type ExitPointerEvidence = { linked: Snapshot | null; archived: Snapshot | null }

/** Read only, inside the caller's transaction. Missing live documents are not
 * themselves proof of deletion: require the corresponding closed archive too.
 */
export async function readExitPointerEvidence(tx: FirebaseFirestore.Transaction, db: FirebaseFirestore.Firestore,
  bookingId: string, state: FirebaseFirestore.DocumentData | undefined, knownLinked?: Snapshot | null): Promise<ExitPointerEvidence> {
  const id = state?.bookingId
  if (typeof id !== "string" || !id || id === bookingId || id.includes("/")) return { linked: null, archived: null }
  const linked = knownLinked === undefined ? await tx.get(db.collection("bookings").doc(id)) : knownLinked
  const archived = !linked?.exists ? await tx.get(db.collection("deleted_bookings").doc(id)) : null
  return { linked, archived }
}

type Decision = {
  updatePointer: boolean
  conflict?: "inconsistent_visit_state"
  reconciliation?: { reason: "archived_reference"; previousBookingId: string; previousVisitId: string }
}

/** Only the single live stay may take over a verified obsolete archive pointer.
 * Existing other stays (including a confirmed duplicate) are never overwritten.
 * Historical clock corrections continue to preserve a newer visit's pointer.
 */
export function exitPointerDecision(input: {
  bookingId: string; booking: FirebaseFirestore.DocumentData; plate: string
  state: FirebaseFirestore.DocumentData | undefined; openBookingIds: string[]
  evidence: ExitPointerEvidence; at: LprTime
}): Decision {
  const { bookingId, booking, state, evidence, at } = input
  const inside = getLprPresenceState(booking).isEffectivelyInside
  if (!inside) return { updatePointer: !!state && state.bookingId === bookingId &&
    (state.visitId ?? null) === (booking.lpr?.visitId ?? null) }
  if (!state) return { updatePointer: true }
  if (state.bookingId === bookingId) return { updatePointer: true } // Shared exit guard checks the visit and clock.
  // Duplicate selection still requires the existing explicit operator confirmation.
  if (input.openBookingIds.length !== 1 || input.openBookingIds[0] !== bookingId) return { updatePointer: false }
  const bad: Decision = { updatePointer: false, conflict: "inconsistent_visit_state" }
  const archive = evidence.archived?.data(), lpr = archive?.lpr
  if (evidence.linked?.exists || !evidence.archived?.exists || !archive ||
    evidence.archived.id !== state.bookingId || archive.originalBookingId && archive.originalBookingId !== state.bookingId ||
    archive.deletedReason !== "admin_delete" || lprTimestampToMillis(archive.deletedAt) === null ||
    normalizeLicensePlate(String(archive.licensePlate || "")) !== input.plate ||
    lpr?.isInside !== false || getLprPresenceState(archive).isEffectivelyInside ||
    archive.restoredLprToBookingId || !state.visitId || lpr.visitId !== state.visitId) return bad
  const clocks = [lprTime(state.lastEventAt, state.lastEventAtInstant), ...bookingLprTimes(archive)]
  // Don't replace an ordering boundary newer than the exit, or guess invalid/DST clocks.
  if (clocks.some(clock => { const order = compareLprTimes(at, clock); return order === null || order === -1 })) return bad
  return { updatePointer: true, reconciliation: {
    reason: "archived_reference", previousBookingId: state.bookingId, previousVisitId: state.visitId,
  } }
}
