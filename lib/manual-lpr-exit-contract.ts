export type ManualExitRow = {
  id: string; licensePlate: string; startDate: string | null; startTime: string | null
  endDate: string | null; endTime: string | null
}
export type ManualExitContext = {
  booking: ManualExitRow; version: string; serverNow: string
  hasPreviousVisit?: boolean
  lastEntry?: string | null
  arrival: string | null; departure: string | null; inside: boolean
  duplicates: ManualExitRow[]
  association?: { bookingId: string; arrival: string; outsidePeriod: boolean } | null
  restoration?: { sourceBookingId: string; arrival: string; correctedAbsentAt: string; version: string } | null
}
export type ManualExitSaveInput = {
  bookingId: string; version: string; requestId: string
  date?: string; time?: string; useServerNow?: boolean
  entryMode?: "new_visit" | "correct_arrival" | "associate_visit" | "restore_deleted_visit"; confirmReentry?: boolean
  restorationVersion?: string; restorationReason?: string; confirmRestoration?: boolean
  confirmAssociation?: boolean
  confirmPresence?: boolean
  confirmMissingArrival?: boolean; confirmDuplicates?: boolean; confirmOverwrite?: boolean
}
