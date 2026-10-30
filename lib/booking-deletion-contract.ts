import type { BookingLoyaltyImpact, LoyaltyReversalStatus } from "./booking-cancellation-types"

export type BookingDeletionContext = {
  booking: { id: string; licensePlate: string; startDate: string | null; startTime: string | null; endDate: string | null; endTime: string | null }
  version: string
  inside: boolean
  blockedReason: string | null
}
export type BookingDeletionInput = {
  bookingId: string
  version: string
  requestId: string
  confirmNotPresent?: boolean
}

export type BookingDeletionResult = {
  success: true
  decremented: boolean
  presenceCorrected: boolean
  multiparkCancelled: boolean
  multiparkAttempted: boolean
  loyaltyStatus: LoyaltyReversalStatus
  loyalty: BookingLoyaltyImpact
}
