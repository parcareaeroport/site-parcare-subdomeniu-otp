"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, RefreshCw } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { db } from "@/lib/firebase"
import { doc, onSnapshot } from "firebase/firestore"
import {
  computeDailyForecastOccupancy,
  type DailyForecastRow,
} from "@/lib/occupancy-forecast"

type DateRange = { from: string; to: string }

function toIsoDate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

export function OccupancyForecast() {
  const [range, setRange] = useState<DateRange>(() => {
    const today = new Date()
    const from = toIsoDate(addDays(today, 1))
    const to = toIsoDate(addDays(today, 31))
    return { from, to }
  })

  const [maxTotalReservations, setMaxTotalReservations] = useState<number>(0)
  const [rows, setRows] = useState<DailyForecastRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [maybeTruncated, setMaybeTruncated] = useState(false)

  // Capacity live: config/reservationSettings.maxTotalReservations
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "reservationSettings"),
      (snap) => {
        const limit = Number(snap.data()?.maxTotalReservations || 0)
        setMaxTotalReservations(Number.isFinite(limit) ? limit : 0)
      },
      (err) => {
        console.error("OccupancyForecast: error listening to reservationSettings", err)
      },
    )
    return () => unsub()
  }, [])

  const canCompute = useMemo(() => {
    return Boolean(range.from) && Boolean(range.to) && range.from <= range.to
  }, [range.from, range.to])

  const reload = async () => {
    if (!canCompute) {
      setError("Interval invalid: data de început trebuie să fie <= data de sfârșit.")
      setRows([])
      return
    }
    setLoading(true)
    setError(null)
    setMaybeTruncated(false)
    try {
      const res = await computeDailyForecastOccupancy({
        from: range.from,
        to: range.to,
      })
      setRows(res.rows)
      setMaybeTruncated(res.maybeTruncated)
    } catch (e) {
      console.error("OccupancyForecast: failed computing forecast", e)
      setError("Nu am putut calcula ocuparea forecast.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Ocupare pe zile (forecast)</CardTitle>
          </div>
   
        </CardHeader>
        <CardContent className="space-y-3">
          {error && <div className="text-sm text-red-700">{error}</div>}
          {maybeTruncated && (
            <div className="text-xs text-orange-700">
              Atenție: rezultatele pot fi incomplete (s-au încărcat prea multe rezervări pentru intervalul selectat).
            </div>
          )}

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="py-2 pr-4">Data</TableHead>
                  <TableHead className="py-2 pr-4">Ocupate</TableHead>
                  <TableHead className="py-2 pr-4">Capacitate</TableHead>
                  <TableHead className="py-2 pr-4">Procent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Se calculează...
                      </span>
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      Nicio zi de afișat pentru intervalul selectat.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const cap = maxTotalReservations
                    const pct = cap > 0 ? Math.round((r.occupied / cap) * 100) : 0
                    const isFullOrOver = cap > 0 && r.occupied >= cap
                    return (
                      <TableRow key={r.date} className={isFullOrOver ? "bg-red-50" : ""}>
                        <TableCell className="py-2 pr-4 font-medium">{r.date}</TableCell>
                        <TableCell
                          className={["py-2 pr-4 tabular-nums", isFullOrOver ? "text-red-700 font-semibold" : ""].join(" ")}
                        >
                          {r.occupied}
                        </TableCell>
                        <TableCell className="py-2 pr-4 tabular-nums">{cap}</TableCell>
                        <TableCell
                          className={["py-2 pr-4 tabular-nums", isFullOrOver ? "text-red-700 font-semibold" : ""].join(" ")}
                        >
                          {pct}%
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


