export const DEFAULT_MOBILE_ONLINE_DISCOUNT_PERCENT = 20

export type PricingSettings = {
  mobileOnlineDiscountPercent: number
}

export const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  mobileOnlineDiscountPercent: DEFAULT_MOBILE_ONLINE_DISCOUNT_PERCENT,
}

export function normalizeMobileOnlineDiscountPercent(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_MOBILE_ONLINE_DISCOUNT_PERCENT
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100))
}

export function normalizePricingSettings(raw: unknown): PricingSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PRICING_SETTINGS
  const data = raw as Record<string, unknown>
  return {
    mobileOnlineDiscountPercent: normalizeMobileOnlineDiscountPercent(
      data.mobileOnlineDiscountPercent
    ),
  }
}
