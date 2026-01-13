"use client"

import { useMemo, useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Car } from "lucide-react"
import { db } from "@/lib/firebase"
import { collection, doc, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore"
import { cn } from "@/lib/utils"
import { format as formatDateFn } from "date-fns"

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

  /**
   * mode="live": afișează ocuparea live (parkingLive), cu fallback la count(lpr.isInside==true)
   * mode="active": calculează ocuparea pentru o zi/interval (rezervări active în range + LPR fără rezervare inside)
   */
  mode?: "live" | "active"

  /** Interval selectat (ex: pagina Bookings). Dacă lipsește și mode="active", se folosește ziua de azi. */
  range?: { from?: Date; to?: Date }

  /** Dacă este setat, afișează exact această valoare (pentru consistență cu tabelul/filtrele UI). */
  countOverride?: number
}

export function OccupancyCounter({
  title = "Ocupare Actuală",
  compact = false,
  inline = false,
  icon,
  className,
  size = "default",
  mode = "live",
  range,
  countOverride,
}: OccupancyCounterProps) {
  const [occupiedCount, setOccupiedCount] = useState<number>(0)
  const [fallbackOccupiedCount, setFallbackOccupiedCount] = useState<number>(0)
  const [activeRangeCount, setActiveRangeCount] = useState<number>(0)
  const [maxLimit, setMaxLimit] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  // Snapshot pentru occupiedCount din parkingLive
  useEffect(() => {
    if (mode !== "live") return
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
  }, [mode])

  // Fallback: dacă parkingLive e 0/stale, calculează ocuparea din realitatea LPR (count where lpr.isInside=true)
  useEffect(() => {
    if (mode !== "live") return
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
  }, [mode])

  // mode="active": calculează ocuparea pentru zi/interval:
  // (1) Rezervări active care se suprapun peste range-ul selectat (manual + pay_on_site + online paid)
  // (2) + LPR fără rezervare (unmatched_lpr) care sunt inside
  useEffect(() => {
    if (mode !== "active") return
    let cancelled = false

    const from = range?.from ?? new Date()
    const to = range?.to ?? range?.from ?? new Date()
    const fromKey = formatDateFn(from, "yyyy-MM-dd")
    const toKey = formatDateFn(to, "yyyy-MM-dd")

    const activeStatuses = ["confirmed_paid", "confirmed_test", "confirmed", "paid", "confirmed_pay_on_site"]

    const refresh = async () => {
      try {
        // 1) Count unmatched LPR inside
        let unmatchedInside = 0
        try {
          const qUnmatched = query(
            collection(db, "bookings"),
            where("status", "==", "unmatched_lpr"),
            where("lpr.isInside", "==", true),
          )
          const snapUnmatched = await getCountFromServer(qUnmatched)
          unmatchedInside = Math.max(0, Number((snapUnmatched.data() as any)?.count ?? 0))
        } catch (e) {
          console.error("OccupancyCounter(active): failed counting unmatched_lpr inside", e)
        }

        // 2) Fetch candidate active bookings (endDate >= fromKey) then filter client-side by overlap (startDate <= toKey)
        // NOTE: Firestore doesn't allow range filters on two different fields in one query.
        const qCandidates = query(
          collection(db, "bookings"),
          where("status", "in", activeStatuses),
          where("endDate", ">=", fromKey),
          orderBy("endDate", "asc"),
          limit(2500),
        )
        const snap = await getDocs(qCandidates)

        let scheduled = 0
        snap.forEach((d) => {
          const b: any = d.data()
          const startDate = String(b.startDate || "")
          const endDate = String(b.endDate || "")
          if (!startDate || !endDate) return
          if (startDate > toKey) return // starts after the selected interval
          // În mode="active" numărăm TOATE rezervările active care se suprapun peste interval,
          // indiferent dacă sunt încă neplătite (ex: rezervare online creată dar fără confirmare plată).
          // "Încasat" este un card separat și rămâne strict pe paid.
          scheduled += 1
        })

        const total = Math.max(0, scheduled + unmatchedInside)
        if (!cancelled) {
          setActiveRangeCount(total)
          setLoading(false)
        }
      } catch (e) {
        console.error("OccupancyCounter(active): failed computing active occupancy", e)
        if (!cancelled) setLoading(false)
      }
    }

    refresh()
    const id = setInterval(refresh, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [mode, range?.from, range?.to])

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

  const displayOccupiedCount = useMemo(() => {
    if (typeof countOverride === "number") return Math.max(0, countOverride)
    if (mode === "active") return activeRangeCount
    // parkingLive can lag behind the real LPR state; prefer the safer (higher) of the two.
    return Math.max(occupiedCount, fallbackOccupiedCount)
  }, [activeRangeCount, countOverride, fallbackOccupiedCount, mode, occupiedCount])
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

