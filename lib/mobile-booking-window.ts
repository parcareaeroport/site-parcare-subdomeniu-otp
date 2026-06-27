export type MobileBookingWindowValidation =
  | { ok: true }
  | {
      ok: false
      code: "INVALID_BOOKING_WINDOW" | "BOOKING_START_IN_PAST"
      message: string
    }

export function validateMobileBookingWindow(input: {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  now?: Date
}): MobileBookingWindowValidation {
  const start = new Date(`${input.startDate}T${input.startTime}:00`)
  const end = new Date(`${input.endDate}T${input.endTime}:00`)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return {
      ok: false,
      code: "INVALID_BOOKING_WINDOW",
      message: "Intervalul rezervării este invalid. Alege o dată de intrare și ieșire corectă.",
    }
  }

  if (start <= (input.now || new Date())) {
    return {
      ok: false,
      code: "BOOKING_START_IN_PAST",
      message: "Data de intrare este în trecut. Alege o perioadă viitoare.",
    }
  }

  return { ok: true }
}
