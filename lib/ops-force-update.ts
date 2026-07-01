import { doc, setDoc, db } from "@/lib/server-firestore"
import { getMobileAppSettings, normalizeAppUpdate, type AppUpdateSettings } from "@/lib/mobile-app-settings"

const DEFAULT_OPS_PASSWORD = "1234567890"

export function getOpsForceUpdatePassword(): string {
  return process.env.FORCE_UPDATE_OPS_PASSWORD?.trim() || DEFAULT_OPS_PASSWORD
}

export function verifyOpsForceUpdatePassword(password: unknown): boolean {
  if (typeof password !== "string" || !password.trim()) return false
  return password === getOpsForceUpdatePassword()
}

export async function getForceUpdateSettings(): Promise<AppUpdateSettings> {
  const settings = await getMobileAppSettings()
  return settings.appUpdate
}

export async function saveForceUpdateSettings(
  raw: Partial<AppUpdateSettings>
): Promise<AppUpdateSettings> {
  const current = await getForceUpdateSettings()
  const next = normalizeAppUpdate({
    ...current,
    ...raw,
    minVersion:
      typeof raw.minVersion === "string" && raw.minVersion.trim()
        ? raw.minVersion.trim()
        : current.minVersion,
    iosUrl: typeof raw.iosUrl === "string" ? raw.iosUrl.trim() : current.iosUrl,
    androidUrl:
      typeof raw.androidUrl === "string" ? raw.androidUrl.trim() : current.androidUrl,
    latestVersion:
      typeof raw.latestVersion === "string" ? raw.latestVersion.trim() : current.latestVersion,
    message: typeof raw.message === "string" ? raw.message.trim() : current.message,
  })

  await setDoc(
    doc(db, "config", "mobileAppSettings"),
    {
      appUpdate: {
        enabled: next.enabled,
        forceUpdate: next.forceUpdate,
        minVersion: next.minVersion,
        latestVersion: next.latestVersion || null,
        iosUrl: next.iosUrl,
        androidUrl: next.androidUrl,
        message: next.message || null,
      },
    },
    { merge: true }
  )

  return next
}
