#!/usr/bin/env node
/**
 * Compare Firestore `prices` standardPrice/days with Ashic WP per-day rates.
 *
 * Usage:
 * GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/validate-prices-vs-ashic-formula.js
 */

const { initializeApp, cert, getApps } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const path = require("path")
const fs = require("fs")

const ASHIC_STANDARD_PER_DAY_RATES = [
  { maxDays: 1, rate: 60.0 },
  { maxDays: 2, rate: 60.0 },
  { maxDays: 3, rate: 50.67 },
  { maxDays: 4, rate: 46.0 },
  { maxDays: 5, rate: 43.0 },
  { maxDays: 6, rate: 41.17 },
  { maxDays: 7, rate: 39.71 },
  { maxDays: 8, rate: 38.88 },
  { maxDays: 9, rate: 37.78 },
  { maxDays: 10, rate: 37.4 },
  { maxDays: 11, rate: 36.82 },
  { maxDays: 12, rate: 36.42 },
  { maxDays: 13, rate: 36.0 },
  { maxDays: 14, rate: 35.71 },
  { maxDays: 15, rate: 35.4 },
  { maxDays: 16, rate: 35.25 },
  { maxDays: 17, rate: 35.0 },
  { maxDays: 18, rate: 34.44 },
  { maxDays: 19, rate: 33.95 },
  { maxDays: 20, rate: 33.5 },
  { maxDays: 21, rate: 33.14 },
  { maxDays: 22, rate: 32.77 },
  { maxDays: 23, rate: 32.43 },
  { maxDays: 24, rate: 32.17 },
  { maxDays: 25, rate: 31.88 },
  { maxDays: 26, rate: 31.62 },
  { maxDays: 27, rate: 31.33 },
  { maxDays: 28, rate: 31.18 },
  { maxDays: 29, rate: 30.97 },
]

function getAshicStandardPerDayRate(days) {
  const bucket = ASHIC_STANDARD_PER_DAY_RATES.find((entry) => days <= entry.maxDays)
  return bucket?.rate ?? 30.77
}

function initFirebase() {
  if (getApps().length) return getFirestore()

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!credPath) {
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path.")
    process.exit(1)
  }

  const resolved = path.resolve(credPath)
  if (!fs.existsSync(resolved)) {
    console.error(`Credentials file not found: ${resolved}`)
    process.exit(1)
  }

  const sa = require(resolved)
  initializeApp({ credential: cert(sa) })
  return getFirestore()
}

async function main() {
  const db = initFirebase()
  const snap = await db.collection("prices").orderBy("days").get()

  if (snap.empty) {
    console.log("No price tiers found in Firestore.")
    return
  }

  const tolerance = 0.02
  let mismatches = 0

  console.log("days | standardPrice | perDay (Firestore) | Ashic rate | delta")
  console.log("-----|---------------|--------------------|------------|------")

  snap.forEach((docSnap) => {
    const data = docSnap.data()
    const days = Number(data.days || 0)
    const standardPrice = Number(data.standardPrice || 0)
    if (days <= 0 || standardPrice <= 0) return

    const perDay = standardPrice / days
    const ashicRate = getAshicStandardPerDayRate(days)
    const delta = Math.abs(perDay - ashicRate)
    const ok = delta <= tolerance

    if (!ok) mismatches += 1

    console.log(
      `${String(days).padStart(4)} | ${String(standardPrice).padStart(13)} | ${perDay.toFixed(2).padStart(18)} | ${ashicRate.toFixed(2).padStart(10)} | ${delta.toFixed(2)}${ok ? "" : "  <-- MISMATCH"}`
    )
  })

  console.log(`\nDone. ${mismatches} tier(s) differ by more than ${tolerance} lei/day from Ashic formula.`)
  process.exit(mismatches > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
