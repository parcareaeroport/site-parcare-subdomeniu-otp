"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { db } from "@/lib/firebase"
import { doc, onSnapshot } from "firebase/firestore"
import { computeDailyForecastOccupancy } from "@/lib/occupancy-forecast"

type BannerState = { maxLimit: number }

export default function ParkingFullBanner() {
  const pathname = usePathname()
  const [state, setState] = useState<BannerState>({ maxLimit: 0 })
  const [fullDays, setFullDays] = useState<string[]>([])

  useEffect(() => {
    const unsubSettings = onSnapshot(
      doc(db, "config", "reservationSettings"),
      (snap) => {
        const maxLimit = Math.max(0, Number(snap.data()?.maxTotalReservations || 0))
        setState((prev) => ({ ...prev, maxLimit }))
      },
      (err) => console.error("ParkingFullBanner: reservationSettings listen error", err),
    )

    return () => {
      unsubSettings()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const compute = async () => {
      try {
        if (!state.maxLimit) {
          if (!cancelled) setFullDays([])
          return
        }
        const today = new Date()
        const from = new Date(today)
        from.setDate(from.getDate() + 1) // tomorrow
        const to = new Date(today)
        to.setDate(to.getDate() + 31) // tomorrow + 30 days window
        const fromKey = from.toISOString().slice(0, 10)
        const toKey = to.toISOString().slice(0, 10)
        const res = await computeDailyForecastOccupancy({ from: fromKey, to: toKey })
        const days = res.rows.filter((r) => r.occupied >= state.maxLimit).map((r) => r.date)
        if (!cancelled) setFullDays(days)
      } catch (e) {
        console.error("ParkingFullBanner: forecast compute error", e)
        if (!cancelled) setFullDays([])
      }
    }
    compute()
    const id = setInterval(compute, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [state.maxLimit])

  const isAdminArea = useMemo(() => {
    return typeof pathname === "string" && pathname.startsWith("/admin")
  }, [pathname])

  const message = useMemo(() => {
    if (!state.maxLimit || fullDays.length === 0) return null
    const maxShown = 5
    const shown = fullDays.slice(0, maxShown).map((k) => {
      const d = new Date(`${k}T00:00:00`)
      if (Number.isNaN(d.getTime())) return k
      return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" })
    })
    const remaining = Math.max(0, fullDays.length - shown.length)
    const daysText = `${shown.join(", ")}${remaining > 0 ? ` (+${remaining} zile)` : ""}`
    return { daysText }
  }, [fullDays, state.maxLimit])

  if (!isAdminArea) return null
  if (!message) return null

  return (
    <div className="sticky top-0 z-50 w-full bg-red-600 text-white">
      <div className="mx-auto max-w-7xl px-4 py-2 text-center text-sm font-semibold">
        Atenție: în următoarele 30 de zile, parcare completă în {message.daysText}.{" "}
        <Link href="/admin/dashboard/ocupare?tab=forecast" className="underline underline-offset-2">
          Vezi mai multe aici
        </Link>
        .
      </div>
    </div>
  )
}


