import type { LoyaltyState } from "@/lib/loyalty-state"

export type LoyaltyReversalStatus = "reversed" | "already_reversed" | "needs_review" | "historic_cancelled" | "not_eligible"

export type BookingLoyaltyImpact = {
  clientLabel: string
  status: LoyaltyReversalStatus
  basis: "record" | "legacy_eligibility"
  before: Required<LoyaltyState> | null
  after: Required<LoyaltyState> | null
  pointsRemoved: number
  freeDaysReturned: number
  pointsToRecoverAdded: number
}

export type CancellationPreview = {
  bookingId: string
  loyalty: BookingLoyaltyImpact
  canConfirm: boolean
  blockingMessage: string | null
  multiparkRequired: boolean
}

export type CancellationResult = {
  success: true
  alreadyCancelled: boolean
  loyaltyStatus: LoyaltyReversalStatus
  loyalty: BookingLoyaltyImpact
  multiparkCancelled: boolean
  multiparkAttempted: boolean
}

export function formatCancellationLoyaltyResult(impact: BookingLoyaltyImpact): string {
  if (impact.status === "needs_review") return "Punctele necesită verificare manuală."
  if (!impact.before || !impact.after) return "Această anulare nu modifică punctele de fidelitate."
  const parts = [`${impact.clientLabel}: ${impact.before.points} → ${impact.after.points} puncte.`]
  if (impact.before.freeDaysAvailable !== impact.after.freeDaysAvailable) {
    parts.push(`Zile gratuite disponibile: ${impact.before.freeDaysAvailable} → ${impact.after.freeDaysAvailable}.`)
  }
  if (impact.pointsToRecoverAdded > 0) {
    parts.push(`De recuperat din rezervările viitoare: ${impact.pointsToRecoverAdded} ${impact.pointsToRecoverAdded === 1 ? "punct" : "puncte"}.`)
  }
  if (impact.freeDaysReturned > 0) parts.push("Ziua gratuită folosită pentru această rezervare a fost returnată înainte de recalcularea progresului.")
  return parts.join(" ")
}
