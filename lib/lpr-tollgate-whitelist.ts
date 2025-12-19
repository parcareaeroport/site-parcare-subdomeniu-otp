import { normalizeLicensePlate } from "@/lib/utils"

/**
 * Tollgate whitelist (NO Firebase):
 * - Set `LPR_TOLLGATE_WHITELIST` as comma/space separated plates.
 * - Example: `LPR_TOLLGATE_WHITELIST="B808CMD, DB04TEST"`
 *
 * This is used to short-circuit the Tollgate API before any Firestore read/write.
 */
function parseEnvList(envValue?: string): Set<string> {
  const raw = (envValue || "").trim()
  if (!raw) return new Set()
  const parts = raw
    .split(/[\s,;]+/g)
    .map((p) => normalizeLicensePlate(p))
    .filter(Boolean)
  return new Set(parts)
}

export function isTollgateWhitelistedPlate(plate: string | null | undefined): boolean {
  const normalized = normalizeLicensePlate(plate || "")
  if (!normalized) return false
  const set = parseEnvList(process.env.LPR_TOLLGATE_WHITELIST)
  return set.has(normalized)
}


