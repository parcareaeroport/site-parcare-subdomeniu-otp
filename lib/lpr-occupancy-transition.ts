import { getLprPresenceState } from "./lpr-presence"

// Used both for physical crossings and an explicitly confirmed absence correction.
// Do not repair a pre-existing counter mismatch as a side effect of one operation.
export function lprOccupancyDelta(data: any, eventType: "entry" | "exit"): -1 | 0 | 1 {
  const inside = getLprPresenceState(data).isEffectivelyInside
  return eventType === "entry"
    ? (!inside && (!data.occupancyIncremented || data.occupancyDecremented) ? 1 : 0)
    : (inside && data.occupancyIncremented && !data.occupancyDecremented ? -1 : 0)
}
