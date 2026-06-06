export type LprPresenceInput = {
  lpr?: {
    isInside?: boolean
    arrivedAt?: unknown
    departedAt?: unknown
    lastSeenAt?: unknown
    lastEventType?: unknown
  } | null
}

export type LprPresenceState = {
  isEffectivelyInside: boolean
  reason: "inside" | "not_marked_inside" | "last_event_exit" | "departed_after_arrival" | "departed_without_arrival"
}

export function lprTimestampToMillis(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === "object") {
    const maybeTimestamp = value as {
      toDate?: () => Date
      seconds?: number
      _seconds?: number
      nanoseconds?: number
      _nanoseconds?: number
    }
    if (typeof maybeTimestamp.toDate === "function") {
      const ms = maybeTimestamp.toDate().getTime()
      return Number.isFinite(ms) ? ms : null
    }
    const seconds =
      typeof maybeTimestamp.seconds === "number"
        ? maybeTimestamp.seconds
        : typeof maybeTimestamp._seconds === "number"
          ? maybeTimestamp._seconds
          : null
    if (seconds !== null) {
      const nanos =
        typeof maybeTimestamp.nanoseconds === "number"
          ? maybeTimestamp.nanoseconds
          : typeof maybeTimestamp._nanoseconds === "number"
            ? maybeTimestamp._nanoseconds
            : 0
      return seconds * 1000 + Math.floor(nanos / 1_000_000)
    }
  }
  return null
}

export function getLprPresenceState(input: LprPresenceInput): LprPresenceState {
  const lpr = input.lpr || {}
  if (lpr.isInside !== true) {
    return { isEffectivelyInside: false, reason: "not_marked_inside" }
  }

  const lastEventType = String(lpr.lastEventType || "").trim().toLowerCase()
  const arrivedAtMs = lprTimestampToMillis(lpr.arrivedAt)
  const departedAtMs = lprTimestampToMillis(lpr.departedAt)
  const lastSeenAtMs = lprTimestampToMillis(lpr.lastSeenAt)

  if (lastEventType.includes("exit")) {
    return { isEffectivelyInside: false, reason: "last_event_exit" }
  }
  if (lastEventType.includes("entry")) {
    if (departedAtMs !== null) {
      if (lastSeenAtMs !== null) {
        return lastSeenAtMs > departedAtMs
          ? { isEffectivelyInside: true, reason: "inside" }
          : { isEffectivelyInside: false, reason: "departed_after_arrival" }
      }
      if (arrivedAtMs === null || departedAtMs >= arrivedAtMs) {
        return { isEffectivelyInside: false, reason: arrivedAtMs === null ? "departed_without_arrival" : "departed_after_arrival" }
      }
    }
    return { isEffectivelyInside: true, reason: "inside" }
  }

  if (departedAtMs !== null && arrivedAtMs === null) {
    return { isEffectivelyInside: false, reason: "departed_without_arrival" }
  }
  if (departedAtMs !== null && arrivedAtMs !== null && departedAtMs >= arrivedAtMs) {
    return { isEffectivelyInside: false, reason: "departed_after_arrival" }
  }

  return { isEffectivelyInside: true, reason: "inside" }
}
