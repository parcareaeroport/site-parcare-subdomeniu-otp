#!/usr/bin/env node
/**
 * Unit tests for booking-pricing logic (no Firestore).
 * Run: node scripts/test-booking-pricing.js
 */

function normalizeTimeHHmm(time) {
  if (!time) return "00:00"
  const match = String(time).trim().match(/^(\d{1,2})\s*:\s*(\d{1,2})$/)
  if (!match) return String(time).trim()
  return `${String(parseInt(match[1], 10)).padStart(2, "0")}:${String(parseInt(match[2], 10)).padStart(2, "0")}`
}

function computeBillableDays(startDate, startTime, endDate, endTime) {
  const startDateStr = (startDate || "").trim()
  const endDateStr = (endDate || "").trim() || startDateStr
  if (!startDateStr) return 1

  const startDt = new Date(`${startDateStr}T${normalizeTimeHHmm(startTime)}:00`)
  const endDt = new Date(`${endDateStr}T${normalizeTimeHHmm(endTime)}:00`)

  if (!Number.isNaN(startDt.getTime()) && !Number.isNaN(endDt.getTime()) && endDt > startDt) {
    return Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000)))
  }
  return 1
}

function resolvePriceTier(days, tiers) {
  if (!days || days <= 0 || !tiers.length) return null
  const sorted = [...tiers].sort((a, b) => a.days - b.days)
  return sorted.find((tier) => tier.days === days) || sorted.find((tier) => tier.days >= days) || sorted[sorted.length - 1]
}

function getTierTotal(tier, paymentMethod) {
  const DEFAULT_ONLINE_DISCOUNT_PERCENT = 20
  function roundPrice(value) {
    return Math.round(value * 100) / 100
  }
  function hasExplicitOnlineDiscount(t) {
    if (typeof t.reducereAplicata === "number" && t.reducereAplicata > 0) return true
    if (typeof t.discountPercentage === "number" && t.discountPercentage > 0) return true
    if (
      typeof t.discountedPrice === "number" &&
      !Number.isNaN(t.discountedPrice) &&
      Math.abs(t.discountedPrice - t.standardPrice) > 0.001
    ) {
      return true
    }
    return false
  }
  if (paymentMethod === "at_parking") return tier.standardPrice
  if (hasExplicitOnlineDiscount(tier)) {
    return typeof tier.discountedPrice === "number" ? tier.discountedPrice : tier.standardPrice
  }
  return roundPrice(tier.standardPrice * (1 - DEFAULT_ONLINE_DISCOUNT_PERCENT / 100))
}

function computeBookingTotal(days, tiers, paymentMethod) {
  const tier = resolvePriceTier(days, tiers)
  if (!tier) return 0
  return Math.round(getTierTotal(tier, paymentMethod) * 100) / 100
}

const tiers = [
  { days: 1, standardPrice: 60, discountedPrice: 50 },
  { days: 3, standardPrice: 152, discountedPrice: 108 },
  { days: 7, standardPrice: 278, discountedPrice: 228 },
]

let passed = 0
let failed = 0

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed += 1
    console.log(`  OK  ${label}`)
  } else {
    failed += 1
    console.error(`  FAIL ${label}: expected ${expected}, got ${actual}`)
  }
}

console.log("booking-pricing tests\n")

assertEqual(computeBillableDays("2026-03-05", "10:00", "2026-03-06", "10:00"), 1, "24h = 1 day")
assertEqual(computeBillableDays("2026-03-05", "10:00", "2026-03-06", "11:00"), 2, "26h = 2 days")
assertEqual(resolvePriceTier(5, tiers).days, 7, "5 days -> tier 7")
assertEqual(computeBookingTotal(3, tiers, "online"), 108, "3 days online")
assertEqual(computeBookingTotal(3, tiers, "at_parking"), 152, "3 days at parking")
assertEqual(computeBookingTotal(5, tiers, "online"), 228, "5 days online uses tier 7")
assertEqual(
  computeBookingTotal(3, [{ days: 3, standardPrice: 152.01 }], "online"),
  121.61,
  "3 days WP online default 20%"
)
assertEqual(
  computeBookingTotal(3, [{ days: 3, standardPrice: 152.01 }], "at_parking"),
  152.01,
  "3 days WP at parking"
)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
