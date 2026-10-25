import { getLprPresenceState, type LprPresenceInput } from "./lpr-presence"

/** The same effective-document count used by the Occupancy plate list. */
export function countEffectiveLprOccupancy(rows: Iterable<LprPresenceInput>): number {
  let count = 0
  for (const row of rows) if (getLprPresenceState(row).isEffectivelyInside) count++
  return count
}
