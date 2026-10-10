import { adminDb } from "@/lib/firebase-admin"
import { normalizeLoyaltyState, reverseLoyaltyAfterBooking } from "@/lib/loyalty-state"
import { getLoyaltyProgramFromSettings } from "@/lib/mobile-app-settings.shared"
import type { BookingLoyaltyImpact, LoyaltyReversalStatus } from "@/lib/booking-cancellation-types"

export function isCancelledBooking(data: FirebaseFirestore.DocumentData): boolean {
  return /cancelled|anulat/i.test(String(data.status || "")) || data.payOnSiteStatus === "cancelled"
}

type ReversalEvaluation = {
  record: FirebaseFirestore.DocumentData | null
  status: LoyaltyReversalStatus
  impact: BookingLoyaltyImpact
  profileUpdate?: { ref: FirebaseFirestore.DocumentReference; loyalty: NonNullable<BookingLoyaltyImpact["after"]> }
}

/** Read and calculate only. Shared by preview and mutations; never writes or calls Multipark. */
export async function evaluateBookingLoyalty(
  tx: Pick<FirebaseFirestore.Transaction, "get">,
  data: FirebaseFirestore.DocumentData,
): Promise<ReversalEvaluation> {
  const record = data.loyaltyRecord
  const legacy = !record
  const impact: BookingLoyaltyImpact = {
    clientLabel: String(data.clientName || "").trim() || String(data.clientEmail || "").trim() || "Clientul",
    status: "not_eligible", basis: legacy ? "legacy_eligibility" : "record",
    before: null, after: null, pointsRemoved: 0, freeDaysReturned: 0, pointsToRecoverAdded: 0,
  }
  const result = (status: LoyaltyReversalStatus, audit = record || null): ReversalEvaluation => ({
    record: audit, status, impact: { ...impact, status },
  })
  const review = () => result("needs_review", {
    ...(record || {}), reversalStatus: "needs_review", reversalBasis: impact.basis, reviewAt: new Date(),
  })
  if (record?.reversalStatus === "needs_review") return review()

  const alreadyReversed = Boolean(record?.reversedAt)
  const historicCancelled = isCancelledBooking(data) && !alreadyReversed
  const eligible = !legacy || (data.bookingOrigin === "mobile-app" && data.userId && data.apiSuccess === true &&
    ["confirmed_paid", "confirmed_pay_on_site"].includes(data.status))
  const zeroAward = record?.pointsAwarded === 0 && record?.freeDaysUsed === 0
  const unchangedStatus: LoyaltyReversalStatus | null = alreadyReversed ? "already_reversed"
    : historicCancelled ? "historic_cancelled" : !eligible ? "not_eligible" : null

  const uid = String(record?.userId || data.userId || "").trim()
  const explicitCol = record?.profileCollection
  let profile: FirebaseFirestore.DocumentSnapshot | undefined
  if (uid && !uid.includes("/")) {
    if (explicitCol === "users" || explicitCol === "guests") {
      profile = await tx.get(adminDb.collection(explicitCol).doc(uid))
    } else if (legacy) {
      const [user, guest] = await Promise.all([
        tx.get(adminDb.collection("users").doc(uid)),
        tx.get(adminDb.collection("guests").doc(uid)),
      ])
      if (user.exists !== guest.exists) profile = user.exists ? user : guest
    }
  }
  if (profile?.exists) {
    impact.before = normalizeLoyaltyState(profile.data()?.loyalty)
    impact.after = { ...impact.before }
  }
  // Show an existing balance even when this particular booking has no point to revoke.
  if (unchangedStatus) return result(unchangedStatus)
  if (zeroAward) return result("reversed", {
    ...record, reversedAt: new Date(), reversalStatus: "reversed", reversalBasis: "record",
  })
  if (!profile?.exists || !profile.data()?.loyalty) return review()

  let threshold = Number(record?.reservationsPerFreeDay)
  if (legacy) {
    const settings = await tx.get(adminDb.collection("config").doc("mobileAppSettings"))
    threshold = getLoyaltyProgramFromSettings(settings.data()).reservationsPerFreeDay
  }
  if (!Number.isFinite(threshold) || threshold < 1) return review()
  const pointsAwarded = legacy ? 1 : record.pointsAwarded
  const freeDaysUsed = legacy ? (data.loyaltyFreeDayApplied === true ? 1 : 0) : record.freeDaysUsed
  if (![0, 1].includes(pointsAwarded) || ![0, 1].includes(freeDaysUsed)) return review()
  const after = reverseLoyaltyAfterBooking(impact.before, threshold, freeDaysUsed, pointsAwarded)
  impact.after = after
  impact.pointsRemoved = impact.before!.points - after.points
  impact.freeDaysReturned = freeDaysUsed
  impact.pointsToRecoverAdded = after.pointsToRecover - impact.before!.pointsToRecover
  return {
    ...result("reversed", {
      ...(record || {}), version: 1, userId: uid, profileCollection: profile.ref.parent.id,
      pointsAwarded, freeDaysUsed, reservationsPerFreeDay: threshold,
      reversedAt: new Date(), reversalStatus: "reversed", reversalBasis: impact.basis,
    }),
    profileUpdate: { ref: profile.ref, loyalty: after },
  }
}

/** Caller saves the audit with the booking/archive in the same transaction. */
export async function reverseBookingLoyalty(tx: FirebaseFirestore.Transaction, data: FirebaseFirestore.DocumentData) {
  const evaluated = await evaluateBookingLoyalty(tx, data)
  if (evaluated.profileUpdate) {
    tx.update(evaluated.profileUpdate.ref, { loyalty: evaluated.profileUpdate.loyalty, updatedAt: new Date() })
  }
  return { record: evaluated.record, status: evaluated.status, impact: evaluated.impact }
}
