import { doc, getDoc, db } from "@/lib/server-firestore"
import type { MobilePaymentProvider } from "@/lib/mobile-booking-mapper"

export type AppUpdateSettings = {
  enabled: boolean
  forceUpdate: boolean
  minVersion: string
  latestVersion?: string
  iosUrl: string
  androidUrl: string
  message?: string
}

export type MobileAppSettings = {
  paymentProvider: MobilePaymentProvider
  stripeEnabled: boolean
  netopiaEnabled: boolean
  pricesEnabled: boolean
  reservationsEnabled: boolean
  appUpdate: AppUpdateSettings
}

const DEFAULT_APP_UPDATE: AppUpdateSettings = {
  enabled: false,
  forceUpdate: false,
  minVersion: "1.0.0",
  iosUrl: "",
  androidUrl: "",
}

const DEFAULT_SETTINGS: MobileAppSettings = {
  paymentProvider: "stripe",
  stripeEnabled: true,
  netopiaEnabled: false,
  pricesEnabled: true,
  reservationsEnabled: true,
  appUpdate: DEFAULT_APP_UPDATE,
}

function normalizeAppUpdate(raw: any): AppUpdateSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_APP_UPDATE
  return {
    enabled: !!raw.enabled,
    forceUpdate: !!raw.forceUpdate,
    minVersion: typeof raw.minVersion === "string" && raw.minVersion ? raw.minVersion : "1.0.0",
    latestVersion: typeof raw.latestVersion === "string" ? raw.latestVersion : undefined,
    iosUrl: typeof raw.iosUrl === "string" ? raw.iosUrl : "",
    androidUrl: typeof raw.androidUrl === "string" ? raw.androidUrl : "",
    message: typeof raw.message === "string" ? raw.message : undefined,
  }
}

export async function getMobileAppSettings(): Promise<MobileAppSettings> {
  try {
    const snap = await getDoc(doc(db, "config", "mobileAppSettings"))
    if (!snap.exists()) {
      return DEFAULT_SETTINGS
    }

    const data = snap.data() || {}
    const paymentProvider =
      data.paymentProvider === "netopia" && data.netopiaEnabled
        ? "netopia"
        : data.paymentProvider === "netopia" && !data.netopiaEnabled
          ? "stripe"
          : data.paymentProvider === "stripe"
            ? "stripe"
            : DEFAULT_SETTINGS.paymentProvider

    return {
      paymentProvider,
      stripeEnabled: data.stripeEnabled !== false,
      netopiaEnabled: !!data.netopiaEnabled,
      pricesEnabled: data.pricesEnabled !== false,
      reservationsEnabled: data.reservationsEnabled !== false,
      appUpdate: normalizeAppUpdate(data.appUpdate),
    }
  } catch (error) {
    console.warn("[mobile-app-settings] Failed to load settings, using defaults.", error)
    return DEFAULT_SETTINGS
  }
}
