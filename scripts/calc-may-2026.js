#!/usr/bin/env node
/**
 * Simulează calculele paginii Admin > Rezervări pentru 1–31 mai 2026.
 * Filtru: createdAt în interval (ca în UI).
 *
 * Usage:
 * GOOGLE_APPLICATION_CREDENTIALS=./parcare-aeroport-ebe28-firebase-adminsdk-fbsvc-58af606f25.json node scripts/calc-may-2026.js
 */

const { initializeApp, cert } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const path = require("path")

const sa = require(path.resolve(__dirname, "../parcare-aeroport-ebe28-firebase-adminsdk-fbsvc-58af606f25.json"))
initializeApp({ credential: cert(sa) })
const db = getFirestore()

const FROM = new Date("2026-05-01T00:00:00")
const TO = new Date("2026-05-31T23:59:59.999")

function coerceMoney(value) {
  if (value === undefined || value === null) return 0
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const n = Number(value.trim().replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function computeDurationDays(b) {
  const startDate = (b.startDate || "").trim()
  if (!startDate) return 1
  const endDate = (b.endDate || "").trim() || startDate
  const startTime = (b.startTime || "").trim()
  const endTime = (b.endTime || "").trim()
  if (startDate && startTime && endDate && endTime) {
    const s = new Date(`${startDate}T${startTime}:00`)
    const e = new Date(`${endDate}T${endTime}:00`)
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e > s) {
      return Math.max(1, Math.ceil((e - s) / (24 * 60 * 60 * 1000)))
    }
  }
  const s = new Date(startDate)
  const e = new Date(endDate)
  if (!Number.isNaN(s) && !Number.isNaN(e)) {
    return Math.max(1, Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1)
  }
  return 1
}

function computePriceForDays(days, tiers) {
  if (!days || days <= 0 || !tiers.length) return 0
  const sorted = [...tiers].sort((a, b) => a.days - b.days)
  const exact = sorted.find((p) => p.days === days)
  const match = exact || sorted.find((p) => p.days >= days) || sorted[sorted.length - 1]
  const val = match.discountedPrice ?? match.standardPrice
  return typeof val === "number" && Number.isFinite(val) ? val : 0
}

function computeBookingRowValue(b, tiers) {
  const amount = coerceMoney(b.amount)
  if (amount > 0) return amount
  return computePriceForDays(computeDurationDays(b), tiers)
}

function isLost(b) {
  const s = String(b.status || "").toLowerCase()
  return s === "expired" || s.includes("cancelled") || s.includes("anulat") || s.includes("api_error_cancel")
}

function isPayOnSiteBooking(b) {
  return b.source === "pay_on_site" || (String(b.status || "") === "confirmed_pay_on_site" && b.source !== "lpr")
}

function isOnlineBooking(b) {
  if (b.source === "manual") return false
  if (b.source === "lpr") return false
  if (isPayOnSiteBooking(b)) return false
  if (isLprNoReservation(b)) return false
  return true
}

function isOnlinePaidBooking(b) {
  if (isPayOnSiteBooking(b)) return false
  return b.paymentStatus === "paid" || String(b.status || "") === "confirmed_paid"
}

function isManualPaidBooking(b) {
  if (b.source !== "manual") return false
  const m = String(b.manualPaymentStatus || "")
  return m === "paid" || b.paymentStatus === "paid"
}

function isLprNoReservation(b) {
  return b.status === "unmatched_lpr" || (b.source === "lpr" && !b.apiBookingNumber)
}

function isLprNoReservationCompleted(b) {
  if (!isLprNoReservation(b)) return false
  const lpr = b.lpr || {}
  return Boolean(lpr.departedAt) || Boolean(b.endDate && b.endTime)
}

async function loadTiers() {
  const snap = await db.collection("prices").orderBy("days").get()
  const tiers = []
  snap.forEach((d) => {
    const data = d.data()
    const sp = Number(data.standardPrice || 0)
    const dp = data.discountedPrice ? Number(data.discountedPrice) : undefined
    const red = data.reducereAplicata !== undefined ? Number(data.reducereAplicata) : undefined
    const derived = sp > 0 && typeof red === "number" && !Number.isNaN(red) ? Math.max(0, sp - red) : undefined
    const finalDp =
      typeof dp === "number" && !Number.isNaN(dp) && dp > 0
        ? dp
        : typeof derived === "number" && derived > 0
          ? derived
          : undefined
    if (Number(data.days || 0) > 0 && sp > 0) {
      tiers.push({ days: Number(data.days), standardPrice: sp, discountedPrice: finalDp })
    }
  })
  return tiers
}

async function fetchMayBookings() {
  const all = []
  let cursor = null
  const pageSize = 500
  while (true) {
    let q = db
      .collection("bookings")
      .where("createdAt", ">=", FROM)
      .where("createdAt", "<=", TO)
      .orderBy("createdAt", "desc")
      .limit(pageSize)
    if (cursor) q = q.startAfter(cursor)
    const snap = await q.get()
    if (snap.empty) break
    snap.docs.forEach((d) => all.push({ id: d.id, ...d.data() }))
    if (snap.size < pageSize) break
    cursor = snap.docs[snap.docs.length - 1]
  }
  return all
}

async function main() {
  console.log("\n=== Calcule Admin Rezervări: 1–31 mai 2026 ===")
  console.log("Filtru: Creată la (createdAt) în interval\n")

  const [tiers, bookings] = await Promise.all([loadTiers(), fetchMayBookings()])
  console.log(`Booking-uri încărcate: ${bookings.length}\n`)

  const active = bookings.filter((b) => !isLost(b))
  const lost = bookings.filter((b) => isLost(b))

  const rowVal = (b) => computeBookingRowValue(b, tiers)

  const onlineTotalValue = active.filter(isOnlineBooking).reduce((s, b) => s + rowVal(b), 0)
  const onlineReceivedValue = active.filter(isOnlinePaidBooking).reduce((s, b) => s + rowVal(b), 0)
  const payOnSiteValue = active.filter(isPayOnSiteBooking).reduce((s, b) => s + rowVal(b), 0)
  const manualPaidValue = active.filter(isManualPaidBooking).reduce((s, b) => s + rowVal(b), 0)
  const manualTotalValue = active.filter((b) => b.source === "manual").reduce((s, b) => s + rowVal(b), 0)
  const lprCompletedValue = active.filter(isLprNoReservationCompleted).reduce((s, b) => s + rowVal(b), 0)

  const totalProRataValue = onlineReceivedValue + payOnSiteValue + manualPaidValue
  const totalPotentialValue = active
    .filter((b) => !isLprNoReservation(b) || isLprNoReservationCompleted(b))
    .reduce((s, b) => s + rowVal(b), 0)

  // Referințe alternative
  const confirmedStatuses = new Set(["confirmed_paid", "confirmed_test", "confirmed_pay_on_site"])
  const confirmedInMay = bookings.filter((b) => confirmedStatuses.has(b.status))
  const sumRawAmountConfirmed = confirmedInMay.reduce((s, b) => s + coerceMoney(b.amount), 0)
  const sumResolvedConfirmed = confirmedInMay.reduce((s, b) => s + rowVal(b), 0)

  // Doar online încasat (Stripe) — strict paymentStatus paid + webhook
  const stripePaid = active.filter(
    (b) => b.paymentStatus === "paid" && (b.source === "webhook" || b.source === "test_mode"),
  )
  const stripePaidValue = stripePaid.reduce((s, b) => s + rowVal(b), 0)

  const fmt = (n) =>
    n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " LEI"

  console.log("--- Carduri pagină Rezervări (logică curentă) ---")
  console.log(`Rezervări active (non-anulate):     ${active.length}`)
  console.log(`Anulate/expirate în interval:        ${lost.length}`)
  console.log("")
  console.log(`Valoare totală (potențială):         ${fmt(totalPotentialValue)}`)
  console.log(`Încasat / estimare operațională:    ${fmt(totalProRataValue)}`)
  console.log("  = Online încasat + Plată la parcare + Manual achitat")
  console.log("")
  console.log("  Detaliu:")
  console.log(`    Online (total):                   ${fmt(onlineTotalValue)}`)
  console.log(`    Online încasat:                   ${fmt(onlineReceivedValue)}`)
  console.log(`    Plată la parcare (estimare):      ${fmt(payOnSiteValue)}`)
  console.log(`    Manual (total):                   ${fmt(manualTotalValue)}`)
  console.log(`    Manual achitat:                   ${fmt(manualPaidValue)}`)
  console.log(`    LPR fără rez. (doar ieșite):       ${fmt(lprCompletedValue)}`)
  console.log("")
  console.log("--- Alte totaluri (pentru comparație) ---")
  console.log(`Confirmed: sumă câmp amount (raw):   ${fmt(sumRawAmountConfirmed)} (${confirmedInMay.length} rez.)`)
  console.log(`Confirmed: sumă cu fallback prețuri:  ${fmt(sumResolvedConfirmed)}`)
  console.log(`Stripe paid (webhook/test):           ${fmt(stripePaidValue)} (${stripePaid.length} rez.)`)
  console.log("")
  console.log(
    totalProRataValue >= 200000
      ? "✓ Încasat/estimare >= 200.000 LEI"
      : `✗ Încasat/estimare sub 200k (lipsesc ${fmt(200000 - totalProRataValue).replace(" LEI", "")} LEI față de 200k)`,
  )
  console.log(
    totalPotentialValue >= 200000
      ? "✓ Valoare potențială >= 200.000 LEI"
      : `✗ Valoare potențială sub 200k`,
  )
  console.log("")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
