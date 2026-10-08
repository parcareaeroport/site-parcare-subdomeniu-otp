import { DEFAULT_LOYALTY_PROGRAM, type LoyaltyProgramConfig } from "@/lib/mobile-app-settings.shared"

export type LoyaltyState = {
  reservationsCount?: number
  freeDaysAvailable?: number
  points?: number
  pointsToRecover?: number
}

export type LoyaltyProgress = {
  remaining: number
  freeDaysAvailable: number
  reservationsCount: number
  reservationsPerFreeDay: number
}

export function normalizeLoyaltyState(loyalty?: LoyaltyState | null): Required<LoyaltyState> {
  return {
    reservationsCount: Math.max(0, Number(loyalty?.reservationsCount) || 0),
    freeDaysAvailable: Math.max(0, Number(loyalty?.freeDaysAvailable) || 0),
    points: Math.max(0, Number(loyalty?.points) || 0),
    pointsToRecover: Math.max(0, Number(loyalty?.pointsToRecover) || 0),
  }
}

export function computeLoyaltyProgress(
  loyalty: LoyaltyState | undefined | null,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): LoyaltyProgress {
  const normalized = normalizeLoyaltyState(loyalty)
  const threshold = Math.max(1, config.reservationsPerFreeDay)
  const mod = normalized.reservationsCount % threshold
  const remaining = (mod === 0 ? threshold : threshold - mod) + normalized.pointsToRecover
  return {
    remaining,
    freeDaysAvailable: normalized.freeDaysAvailable,
    reservationsCount: normalized.reservationsCount,
    reservationsPerFreeDay: threshold,
  }
}

export function advanceLoyaltyAfterBooking(
  loyalty: LoyaltyState | undefined | null,
  config: LoyaltyProgramConfig = DEFAULT_LOYALTY_PROGRAM
): Required<LoyaltyState> {
  const existing = normalizeLoyaltyState(loyalty)
  const threshold = Math.max(1, config.reservationsPerFreeDay)
  let reservationsCount = existing.reservationsCount + (existing.pointsToRecover > 0 ? 0 : 1)
  let freeDaysAvailable = existing.freeDaysAvailable

  while (reservationsCount >= threshold) {
    freeDaysAvailable += 1
    reservationsCount -= threshold
  }

  return {
    ...existing,
    reservationsCount,
    freeDaysAvailable,
    points: existing.points + 1,
    pointsToRecover: Math.max(0, existing.pointsToRecover - 1),
  }
}


/** Return consumed days first, then reverse the reservation's earned point. */
export function reverseLoyaltyAfterBooking(
  loyalty: LoyaltyState | undefined | null,
  threshold: number,
  freeDaysUsed = 0,
  pointsAwarded = 1,
): Required<LoyaltyState> {
  const next = normalizeLoyaltyState(loyalty)
  next.freeDaysAvailable += Math.max(0, freeDaysUsed)
  for (let i = 0; i < pointsAwarded; i += 1) {
    next.points = Math.max(0, next.points - 1)
    if (next.reservationsCount > 0) {
      next.reservationsCount -= 1
    } else if (next.freeDaysAvailable > 0) {
      next.freeDaysAvailable -= 1
      next.reservationsCount = Math.max(1, threshold) - 1
    } else {
      next.pointsToRecover += 1
    }
  }
  return next
}
