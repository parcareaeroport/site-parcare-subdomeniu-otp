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

export type LoyaltyProgramConfig = {
  enabled: boolean
  reservationsPerFreeDay: number
  freeDayHours: number
  maxBillableDaysForAutoRedeem: number
  homeMessageTemplate?: string
}

export type NetopiaFeaturesConfig = {
  googlePayEnabled: boolean
  applePayEnabled: boolean
  tokenizationEnabled: boolean
}

export type MobileAppSettings = {
  paymentProvider: MobilePaymentProvider
  stripeEnabled: boolean
  netopiaEnabled: boolean
  netopia: NetopiaFeaturesConfig
  pricesEnabled: boolean
  reservationsEnabled: boolean
  testPaymentEnabled: boolean
  appUpdate: AppUpdateSettings
  loyaltyProgram: LoyaltyProgramConfig
}

export const DEFAULT_NETOPIA_FEATURES: NetopiaFeaturesConfig = {
  googlePayEnabled: false,
  applePayEnabled: false,
  tokenizationEnabled: false,
}

export const DEFAULT_LOYALTY_PROGRAM: LoyaltyProgramConfig = {
  enabled: true,
  reservationsPerFreeDay: 4,
  freeDayHours: 24,
  maxBillableDaysForAutoRedeem: 1,
}

const DEFAULT_APP_UPDATE: AppUpdateSettings = {
  enabled: false,
  forceUpdate: false,
  minVersion: "1.0.0",
  iosUrl: "",
  androidUrl: "",
}

const DEFAULT_SETTINGS: MobileAppSettings = {
  paymentProvider: "netopia",
  stripeEnabled: true,
  netopiaEnabled: true,
  netopia: DEFAULT_NETOPIA_FEATURES,
  pricesEnabled: true,
  reservationsEnabled: true,
  testPaymentEnabled: false,
  appUpdate: DEFAULT_APP_UPDATE,
  loyaltyProgram: DEFAULT_LOYALTY_PROGRAM,
}

export function normalizeNetopiaFeatures(raw: unknown): NetopiaFeaturesConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_NETOPIA_FEATURES
  const data = raw as Record<string, unknown>
  return {
    googlePayEnabled: !!data.googlePayEnabled,
    applePayEnabled: !!data.applePayEnabled,
    tokenizationEnabled: !!data.tokenizationEnabled,
  }
}

export function normalizeLoyaltyProgram(raw: unknown): LoyaltyProgramConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_LOYALTY_PROGRAM
  const data = raw as Record<string, unknown>
  const reservationsPerFreeDay = parseInt(String(data.reservationsPerFreeDay ?? 4), 10)
  const freeDayHours = parseInt(String(data.freeDayHours ?? 24), 10)
  const maxBillableDaysForAutoRedeem = parseInt(
    String(data.maxBillableDaysForAutoRedeem ?? 1),
    10
  )

  return {
    enabled: data.enabled !== false,
    reservationsPerFreeDay: reservationsPerFreeDay > 0 ? reservationsPerFreeDay : 4,
    freeDayHours: freeDayHours > 0 ? freeDayHours : 24,
    maxBillableDaysForAutoRedeem:
      maxBillableDaysForAutoRedeem > 0 ? maxBillableDaysForAutoRedeem : 1,
    homeMessageTemplate:
      typeof data.homeMessageTemplate === "string" ? data.homeMessageTemplate : undefined,
  }
}

export function getLoyaltyProgramFromSettings(data: unknown): LoyaltyProgramConfig {
  if (!data || typeof data !== "object") return DEFAULT_LOYALTY_PROGRAM
  return normalizeLoyaltyProgram((data as Record<string, unknown>).loyaltyProgram)
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
      netopia: normalizeNetopiaFeatures(data.netopia),
      pricesEnabled: data.pricesEnabled !== false,
      reservationsEnabled: data.reservationsEnabled !== false,
      testPaymentEnabled: !!data.testPaymentEnabled,
      appUpdate: normalizeAppUpdate(data.appUpdate),
      loyaltyProgram: getLoyaltyProgramFromSettings(data),
    }
  } catch (error) {
    console.warn("[mobile-app-settings] Failed to load settings, using defaults.", error)
    return DEFAULT_SETTINGS
  }
}
