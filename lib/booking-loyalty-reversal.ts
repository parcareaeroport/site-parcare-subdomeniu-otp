import { adminDb } from "@/lib/firebase-admin"
import { reverseLoyaltyAfterBooking } from "@/lib/loyalty-state"
import { getLoyaltyProgramFromSettings } from "@/lib/mobile-app-settings.shared"

export function isCancelledBooking(data: FirebaseFirestore.DocumentData): boolean {
  return /cancelled|anulat/i.test(String(data.status || "")) || data.payOnSiteStatus === "cancelled"
}

/** Call before any transaction writes; caller saves the returned audit with the booking/archive. */
export async function reverseBookingLoyalty(
  tx: FirebaseFirestore.Transaction,
  data: FirebaseFirestore.DocumentData,
) {
  const record = data.loyaltyRecord
  if (record?.reversedAt || record?.reversalStatus === "needs_review") {
    return { record, status: record.reversalStatus === "needs_review" ? "needs_review" : "already_reversed" }
  }
  // Historic cancellations must never be corrected implicitly by deleting/retrying them.
  if (isCancelledBooking(data)) return { record: record || null, status: "historic_cancelled" }
  const legacy = !record
  if (legacy && !(data.bookingOrigin === "mobile-app" && data.userId && data.apiSuccess === true &&
    ["confirmed_paid", "confirmed_pay_on_site"].includes(data.status))) {
    return { record: record || null, status: "not_eligible" }
  }
  if (record && record.pointsAwarded === 0 && record.freeDaysUsed === 0) {
    return { record: { ...record, reversedAt: new Date(), reversalStatus: "reversed", reversalBasis: "record" }, status: "reversed" }
  }
  const uid = String(record?.userId || data.userId || "").trim()
  const review = () => ({
    record: { ...(record || {}), reversalStatus: "needs_review", reversalBasis: legacy ? "legacy_eligibility" : "record", reviewAt: new Date() },
    status: "needs_review",
  })
  if (!uid || uid.includes("/")) return review()
  const explicitCol = record?.profileCollection
  let profile: FirebaseFirestore.DocumentSnapshot
  if (explicitCol === "users" || explicitCol === "guests") {
    profile = await tx.get(adminDb.collection(explicitCol).doc(uid))
  } else if (legacy) {
    const [user, guest] = await Promise.all([
      tx.get(adminDb.collection("users").doc(uid)),
      tx.get(adminDb.collection("guests").doc(uid)),
    ])
    if (user.exists === guest.exists) return review()
    profile = user.exists ? user : guest
  } else return review()
  if (!profile.exists || !profile.data()?.loyalty) return review()
  let threshold = Number(record?.reservationsPerFreeDay)
  if (legacy) {
    const settings = await tx.get(adminDb.collection("config").doc("mobileAppSettings"))
    threshold = getLoyaltyProgramFromSettings(settings.data()).reservationsPerFreeDay
  }
  if (!Number.isFinite(threshold) || threshold < 1) return review()
  const pointsAwarded = legacy ? 1 : record.pointsAwarded
  const freeDaysUsed = legacy ? (data.loyaltyFreeDayApplied === true ? 1 : 0) : record.freeDaysUsed
  if (![0, 1].includes(pointsAwarded) || ![0, 1].includes(freeDaysUsed)) return review()
  tx.update(profile.ref, {
    loyalty: reverseLoyaltyAfterBooking(profile.data()!.loyalty, threshold, freeDaysUsed, pointsAwarded),
    updatedAt: new Date(),
  })
  return {
    record: {
      ...(record || {}), version: 1, userId: uid, profileCollection: profile.ref.parent.id,
      pointsAwarded, freeDaysUsed, reservationsPerFreeDay: threshold,
      reversedAt: new Date(), reversalStatus: "reversed",
      reversalBasis: legacy ? "legacy_eligibility" : "record",
    },
    status: "reversed",
  }
}
