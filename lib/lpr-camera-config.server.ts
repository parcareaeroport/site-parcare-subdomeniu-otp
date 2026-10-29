import "server-only"
import { timingSafeEqual } from "node:crypto"
import { manualExitClock } from "@/lib/manual-lpr-exit.server"
export type CameraTimeMode = "romania_wall_clock" | "instant"
export type CameraConfig = { direction:"entry"|"exit"; timestampMode:CameraTimeMode; maxEventAgeMinutes?:number }
export function validSecret(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
export function cameraConfiguration(deviceId: unknown): CameraConfig | null {
  if (typeof deviceId !== "string") return null
  try {
    const all = JSON.parse(process.env.LPR_DEVICES_JSON || "{}")
    const cfg = Object.prototype.hasOwnProperty.call(all, deviceId) ? all[deviceId] : null
    if (cfg?.maxEventAgeMinutes !== undefined && (!Number.isFinite(cfg.maxEventAgeMinutes) || cfg.maxEventAgeMinutes <= 0)) return null
    return cfg && ["entry","exit"].includes(cfg.direction) && ["romania_wall_clock","instant"].includes(cfg.timestampMode) ? cfg : null
  } catch { return null }
}
/** Existing records use Romania civil time with a Z label. A device must explicitly
 * declare whether it sends that civil clock or a real instant. No historical conversion.
 * DST's repeated hour cannot always be distinguished at legacy precision;
 * contradictory ordering is sent to review by the visit processor.
 */
export function parseCameraTime(value: unknown, mode: CameraTimeMode = "romania_wall_clock"): string | null {
  if (typeof value !== "string") return null
  const s = value.trim().replace(" ","T")
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (!match) return null
  const civil = `${match[1]}${(match[2] || ".").padEnd(4,"0")}Z`
  if (!Number.isFinite(Date.parse(civil)) || new Date(civil).toISOString() !== civil) return null
  if (mode === "romania_wall_clock") return !match[3] || match[3] === "Z" ? civil : null
  if (!match[3]) return null // Never guess the source offset.
  const instant = new Date(s)
  if (!Number.isFinite(instant.getTime())) return null
  return manualExitClock(instant).replace(".000Z", civil.slice(-5))
}
