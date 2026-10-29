export type ManualExitRow = {
  id: string; licensePlate: string; startDate: string | null; startTime: string | null
  endDate: string | null; endTime: string | null
}
export type ManualExitContext = {
  booking: ManualExitRow; version: string; serverNow: string
  lastEntry?: string | null
  arrival: string | null; departure: string | null; inside: boolean
  duplicates: ManualExitRow[]
}
export type ManualExitSaveInput = {
  bookingId: string; version: string; requestId: string
  date?: string; time?: string; useServerNow?: boolean
  confirmMissingArrival?: boolean; confirmDuplicates?: boolean; confirmOverwrite?: boolean
}
