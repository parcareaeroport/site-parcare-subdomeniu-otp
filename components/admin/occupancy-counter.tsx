"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Car } from "lucide-react"
import { db } from "@/lib/firebase"
import { collection, doc, getCountFromServer, onSnapshot, query, where } from "firebase/firestore"
import { cn } from "@/lib/utils"

interface OccupancyCounterProps {
  /** Titlu custom pentru contor (default: "Ocupare Actuală") */
  title?: string
  /** Stil compact (fără card wrapper) */
  compact?: boolean
  /** Randare super compactă, toate elementele pe un singur rând */
  inline?: boolean
  /** Icon custom (default: Car) */
  icon?: React.ReactNode
  /** Clasă CSS custom pentru container */
  className?: string
  /** Dimensiune: default sau sm (text mai mic) */
  size?: "default" | "sm"
}

export function OccupancyCounter({
  title = "Ocupare Actuală",
  compact = false,
  inline = false,
  icon,
  className,
  size = "default",
}: OccupancyCounterProps) {
  const [occupiedCount, setOccupiedCount] = useState<number>(0)
  const [fallbackOccupiedCount, setFallbackOccupiedCount] = useState<number>(0)
  const [maxLimit, setMaxLimit] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  // Snapshot pentru occupiedCount din parkingLive
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "parkingLive"),
      (snap) => {
        const count = Math.max(0, Number(snap.data()?.occupiedCount || 0))
        setOccupiedCount(count)
        setLoading(false)
      },
      (err) => {
        console.error("Error listening to parkingLive:", err)
        setLoading(false)
      }
    )
    return () => unsub()
  }, [])

  // Fallback: dacă parkingLive e 0/stale, calculează ocuparea din realitatea LPR (count where lpr.isInside=true)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const q = query(collection(db, "bookings"), where("lpr.isInside", "==", true))
        const snap = await getCountFromServer(q)
        const c = Math.max(0, Number((snap.data() as any)?.count ?? 0))
        if (!cancelled) setFallbackOccupiedCount(c)
      } catch (e) {
        // Dacă nu există permisiuni pentru count, păstrăm fallback-ul curent
        console.error("Error computing fallback occupancy (count isInside)", e)
      }
    }

    refresh()
    const id = setInterval(refresh, 60000) // refresh la 60s (ieftin: server-side count)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  // Snapshot pentru maxLimit din reservationSettings
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "reservationSettings"),
      (snap) => {
        const limit = Number(snap.data()?.maxTotalReservations || 0)
        setMaxLimit(limit)
      },
      (err) => {
        console.error("Error listening to reservationSettings:", err)
      }
    )
    return () => unsub()
  }, [])

  const displayOccupiedCount = occupiedCount > 0 ? occupiedCount : fallbackOccupiedCount
  const percentage = maxLimit > 0 ? Math.min(100, Math.round((displayOccupiedCount / maxLimit) * 100)) : 0
  const isWarning = percentage >= 80 && percentage < 100
  const isCritical = percentage >= 100

  const statusColor = isCritical
    ? "text-red-600"
    : isWarning
    ? "text-orange-600"
    : "text-green-600"

  const bgColor = isCritical
    ? "bg-red-50 border-red-200"
    : isWarning
    ? "bg-orange-50 border-orange-200"
    : "bg-green-50 border-green-200"

  const badgeVariant = isCritical ? "destructive" : isWarning ? "default" : "secondary"

  if (inline) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 border",
          isCritical ? "border-red-200 bg-red-50" : isWarning ? "border-orange-200 bg-orange-50" : "border-gray-200 bg-white",
          className,
        )}
      >
        {icon || <Car className="h-4 w-4 text-gray-600" />}
        {title && <span className="text-xs font-medium text-gray-700">{title}</span>}
        <span className="text-sm font-semibold tabular-nums">
          {loading ? "—" : displayOccupiedCount} / {loading ? "—" : maxLimit}
        </span>
      </div>
    )
  }

  const titleSize = size === "sm" ? "text-xs" : "text-sm"
  const countSize = size === "sm" ? "text-2xl" : "text-4xl"
  const totalSize = size === "sm" ? "text-xl" : "text-2xl"
  const gapSize = size === "sm" ? "gap-1.5" : "gap-2"
  const paddingCompact = size === "sm" ? "p-3" : "p-4"
  const paddingCard = size === "sm" ? "pt-4" : "pt-6"

  const CounterContent = () => (
    <div className={cn("space-y-3", className)}>
      {/* Header cu icon și titlu */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon || <Car className={cn("h-5 w-5", statusColor)} />}
          <span className={cn("font-medium text-gray-700", titleSize)}>{title}</span>
        </div>
        {(isWarning || isCritical) && (
          <AlertTriangle className={cn("h-4 w-4", isCritical ? "text-red-600" : "text-orange-600")} />
        )}
      </div>

      {/* Contor principal cu gradient */}
      <div className={cn("flex items-baseline", gapSize)}>
        <div className={cn("font-bold tabular-nums", countSize, statusColor)}>
          {loading ? "—" : displayOccupiedCount}
        </div>
        <div className={cn("font-medium text-gray-400", totalSize === "text-xl" ? "text-xl" : "text-2xl")}>/</div>
        <div className={cn("font-semibold text-gray-600 tabular-nums", totalSize)}>
          {loading ? "—" : maxLimit}
        </div>
      </div>

      {/* Status */}
      {!loading && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{percentage}% ocupat</span>
          {maxLimit > 0 && (
            <Badge variant={badgeVariant} className="text-xs">
              {maxLimit - displayOccupiedCount > 0 ? `${maxLimit - displayOccupiedCount} disponibile` : "Complet"}
            </Badge>
          )}
        </div>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className={cn("rounded-lg border-2", paddingCompact, bgColor)}>
        <CounterContent />
      </div>
    )
  }

  return (
    <Card className={cn("border-2", bgColor)}>
      <CardContent className={paddingCard}>
        <CounterContent />
      </CardContent>
    </Card>
  )
}

