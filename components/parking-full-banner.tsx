"use client"

import { useEffect, useMemo, useState } from "react"
import { db } from "@/lib/firebase"
import { collection, doc, getCountFromServer, onSnapshot, query, where } from "firebase/firestore"

type BannerState = {
  occupiedCount: number
  fallbackOccupiedCount: number
  maxLimit: number
}

export default function ParkingFullBanner() {
  const [state, setState] = useState<BannerState>({ occupiedCount: 0, fallbackOccupiedCount: 0, maxLimit: 0 })

  useEffect(() => {
    const unsubLive = onSnapshot(
      doc(db, "config", "parkingLive"),
      (snap) => {
        const occupiedCount = Math.max(0, Number(snap.data()?.occupiedCount || 0))
        setState((prev) => ({ ...prev, occupiedCount }))
      },
      (err) => console.error("ParkingFullBanner: parkingLive listen error", err),
    )

    const unsubSettings = onSnapshot(
      doc(db, "config", "reservationSettings"),
      (snap) => {
        const maxLimit = Math.max(0, Number(snap.data()?.maxTotalReservations || 0))
        setState((prev) => ({ ...prev, maxLimit }))
      },
      (err) => console.error("ParkingFullBanner: reservationSettings listen error", err),
    )

    return () => {
      unsubLive()
      unsubSettings()
    }
  }, [])

  // Fallback: dacă parkingLive e 0/stale, numărăm realitatea LPR (count where lpr.isInside=true)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const q = query(collection(db, "bookings"), where("lpr.isInside", "==", true))
        const snap = await getCountFromServer(q)
        const c = Math.max(0, Number((snap.data() as any)?.count ?? 0))
        if (!cancelled) setState((prev) => ({ ...prev, fallbackOccupiedCount: c }))
      } catch (e) {
        console.error("ParkingFullBanner: fallback count error", e)
      }
    }
    refresh()
    const id = setInterval(refresh, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const displayOccupiedCount = useMemo(() => {
    return state.occupiedCount > 0 ? state.occupiedCount : state.fallbackOccupiedCount
  }, [state.fallbackOccupiedCount, state.occupiedCount])

  const isFull = useMemo(() => {
    if (!state.maxLimit) return false
    return displayOccupiedCount >= state.maxLimit
  }, [displayOccupiedCount, state.maxLimit])

  if (!isFull) return null

  return (
    <div className="sticky top-0 z-50 w-full bg-red-600 text-white">
      <div className="mx-auto max-w-7xl px-4 py-2 text-center text-sm font-semibold">
        PARCAREA ESTE FULL — momentan nu mai sunt locuri disponibile.
      </div>
    </div>
  )
}


