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
  netopiaForcedTestMode: boolean
  netopiaForcedTestAmount?: number
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

export const DEFAULT_APP_UPDATE: AppUpdateSettings = {
  enabled: false,
  forceUpdate: false,
  minVersion: "1.0.0",
  iosUrl: "",
  androidUrl: "",
}

export const DEFAULT_MOBILE_APP_SETTINGS: MobileAppSettings = {
  paymentProvider: "netopia",
  stripeEnabled: true,
  netopiaEnabled: true,
  netopia: DEFAULT_NETOPIA_FEATURES,
  netopiaForcedTestMode: false,
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

export function normalizeAppUpdate(raw: unknown): AppUpdateSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_APP_UPDATE
  const data = raw as Record<string, unknown>

  return {
    enabled: !!data.enabled,
    forceUpdate: !!data.forceUpdate,
    minVersion:
      typeof data.minVersion === "string" && data.minVersion ? data.minVersion : "1.0.0",
    latestVersion: typeof data.latestVersion === "string" ? data.latestVersion : undefined,
    iosUrl: typeof data.iosUrl === "string" ? data.iosUrl : "",
    androidUrl: typeof data.androidUrl === "string" ? data.androidUrl : "",
    message: typeof data.message === "string" ? data.message : undefined,
  }
}
