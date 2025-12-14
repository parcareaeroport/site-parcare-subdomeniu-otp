"use client"

import { useEffect, useMemo, useState } from "react"
import { db } from "@/lib/firebase"
import { doc, onSnapshot } from "firebase/firestore"

type BannerState = {
  occupiedCount: number
  maxLimit: number
}

export default function ParkingFullBanner() {
  const [state, setState] = useState<BannerState>({ occupiedCount: 0, maxLimit: 0 })

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

  const isFull = useMemo(() => {
    if (!state.maxLimit) return false
    return state.occupiedCount >= state.maxLimit
  }, [state.maxLimit, state.occupiedCount])

  if (!isFull) return null

  return (
    <div className="sticky top-0 z-50 w-full bg-red-600 text-white">
      <div className="mx-auto max-w-7xl px-4 py-2 text-center text-sm font-semibold">
        PARCAREA ESTE FULL — momentan nu mai sunt locuri disponibile.
      </div>
    </div>
  )
}


