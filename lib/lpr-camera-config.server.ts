import "server-only"
import { timingSafeEqual } from "node:crypto"
import { romaniaCivilClock, uniqueLprInstant } from "./lpr-time"
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
  return romaniaCivilClock(instant)
}

export function cameraEventInstant(value: unknown, mode: CameraTimeMode = "romania_wall_clock"): string | null {
  const wall = parseCameraTime(value, mode)
  if (!wall) return null
  return mode === "instant" ? new Date(String(value).trim().replace(" ", "T")).toISOString() : uniqueLprInstant(wall)
}

/** Positive offset means the camera is ahead. Never infer an offset from receipt
 * time: queued messages must keep their original chronology. Absent config = 0.
 * Invalid configuration fails closed, rather than silently using an incorrect clock. */
export function cameraClockOffsetSeconds(deviceId: unknown): number | null {
  const json = process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON
  if (!json) return 0
  try {
    const offsets = JSON.parse(json)
    if (!offsets || typeof offsets !== "object" || Array.isArray(offsets)) return null
    if (typeof deviceId !== "string" || !Object.prototype.hasOwnProperty.call(offsets, deviceId)) return 0
    const offset = offsets[deviceId]
    return typeof offset === "number" && Number.isInteger(offset) && Math.abs(offset) <= 86400 ? offset : null
  } catch { return null }
}

export function correctedCameraTime(value: unknown, mode: CameraTimeMode = "romania_wall_clock", offsetSeconds: number | null = 0) {
  const originalWall = parseCameraTime(value, mode)
  const originalInstant = cameraEventInstant(value, mode)
  if (!originalWall || offsetSeconds === null || !Number.isInteger(offsetSeconds) || Math.abs(offsetSeconds) > 86400)
    return { wall: null, instant: null, originalWall, originalInstant }
  // Civil camera clocks must be corrected BEFORE resolving Romania's DST offset.
  // Instant cameras instead shift the actual instant before deriving the civil clock.
  if (mode === "instant" && originalInstant) {
    const instant = new Date(Date.parse(originalInstant) - offsetSeconds * 1000).toISOString()
    return { wall: romaniaCivilClock(new Date(instant)), instant, originalWall, originalInstant }
  }
  const wall = new Date(Date.parse(originalWall) - offsetSeconds * 1000).toISOString()
  return { wall, instant: uniqueLprInstant(wall), originalWall, originalInstant }
}
