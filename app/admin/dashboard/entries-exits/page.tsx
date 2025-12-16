"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { getDailyEntries, getDailyExits, type DailyEntryExit } from "@/lib/admin-stats"
import { doc, serverTimestamp, updateDoc, collection, getDocs, orderBy, query } from "firebase/firestore"
import { db } from "@/lib/firebase"

type EnrichedRow = DailyEntryExit & {
  startDate?: string
  endDate?: string
  delayMinutesComputed?: number
  amountDueText?: string
  amountDueValue?: number
  isLate?: boolean
  autoCancelled?: boolean
  isPayOnSite?: boolean
  isOnlinePaid?: boolean
}

const PAY_ON_SITE_CANCEL_AFTER_MIN = 180 // 3h
const LATE_FEE_PER_DAY = 30 // lei / zi întârziere (online)
const ONLINE_GRACE_MINUTES = 60 // 1h bonus la ultima zi (online)

type PriceEntry = {
  days: number
  standardPrice: number
  discountedPrice?: number
}

function parseDateTime(date?: string, time?: string) {
  if (!date || !time) return null
  const asIso = `${date}T${time.length === 5 ? `${time}:00` : time}`
  const d = new Date(asIso)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseDateTimeUTC(date?: string, time?: string) {
  if (!date || !time) return null
  const asIso = `${date}T${time.length === 5 ? `${time}:00` : time}Z`
  const d = new Date(asIso)
  return Number.isNaN(d.getTime()) ? null : d
}

function getExactPriceForDays(priceTable: PriceEntry[], days: number): number | null {
  if (!days || days <= 0) return null
  if (!priceTable || priceTable.length === 0) return null
  const exact = priceTable.find((p) => p.days === days)
  if (exact) return (exact.discountedPrice ?? exact.standardPrice) || null
  // fallback: nearest greater, otherwise last
  const sorted = [...priceTable].sort((a, b) => a.days - b.days)
  const nearest = sorted.find((p) => p.days >= days) || sorted[sorted.length - 1]
  if (!nearest) return null
  return (nearest.discountedPrice ?? nearest.standardPrice) || null
}

function formatDelay(minutes?: number) {
  if (minutes === undefined || minutes === null) return "-"
  if (minutes === 0) return "La timp"
  const abs = Math.abs(minutes)
  if (abs < 60) return `${minutes > 0 ? "" : "-"}${abs} min`
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const label = m === 0 ? `${h} h` : `${h} h ${m} min`
  return minutes > 0 ? label : `- ${label}`
}

async function autoCancelPayOnSite(id: string) {
  try {
    await updateDoc(doc(db, "bookings", id), {
      status: "cancelled_pay_on_site_timeout",
      lastUpdated: serverTimestamp(),
      cancelReason: "Depășire 3h la plată la parcare (auto)"
    })
  } catch (e) {
    console.error("Failed to auto-cancel pay_on_site booking", e)
  }
}

export default function EntriesExitsPage() {
  const [isClient, setIsClient] = useState(false)
  const [activeTab, setActiveTab] = useState<"entries" | "exits">("entries")
  const [includeFuture, setIncludeFuture] = useState(false)
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split("T")[0]
  })
  const [entries, setEntries] = useState<DailyEntryExit[]>([])
  const [exits, setExits] = useState<DailyEntryExit[]>([])
  const [loading, setLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState("")
  const [priceTable, setPriceTable] = useState<PriceEntry[]>([])
  const [entriesView, setEntriesView] = useState<"both" | "main" | "late">("both")
  const [exitsView, setExitsView] = useState<"both" | "main" | "late">("both")
  const jumpToTab = (tab: "entries" | "exits") => {
    setActiveTab(tab)
    setEntriesView("both")
    setExitsView("both")
    setTimeout(() => {
      const id = tab === "entries" ? "entries-main" : "exits-main"
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 60)
  }
  const scrollToSection = (sectionId: string, tab: "entries" | "exits") => {
    setActiveTab(tab)
    if (tab === "entries") {
      setEntriesView(sectionId === "entries-main" ? "main" : sectionId === "entries-late" ? "late" : "both")
    } else {
      setExitsView(sectionId === "exits-main" ? "main" : sectionId === "exits-late" ? "late" : "both")
    }
    setTimeout(() => {
      const el = document.getElementById(sectionId)
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 60)
  }

  useEffect(() => setIsClient(true), [])

  useEffect(() => {
    if (isClient) {
      loadData()
      loadPrices()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, selectedDate, includeFuture])

  useEffect(() => {
    const tick = () => setCurrentTime(new Date().toTimeString().slice(0, 5))
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [e1, e2] = await Promise.all([
        getDailyEntries(selectedDate, includeFuture),
        getDailyExits(selectedDate, includeFuture)
      ])
      setEntries(e1)
      setExits(e2)
    } catch (e) {
      console.error("Error loading entries/exits", e)
      setEntries([])
      setExits([])
    } finally {
      setLoading(false)
    }
  }

  const loadPrices = async () => {
    try {
      const q = query(collection(db, "prices"), orderBy("days"))
      const snap = await getDocs(q)
      const items: PriceEntry[] = snap.docs.map((d) => {
        const data: any = d.data()
        const standardPrice = Number(data.standardPrice || 0)
        const reducereAplicata = data.reducereAplicata !== undefined ? Number(data.reducereAplicata) : undefined
        const discountedFromReduction =
          standardPrice > 0 && typeof reducereAplicata === "number" && !Number.isNaN(reducereAplicata)
            ? Math.max(0, standardPrice - reducereAplicata)
            : undefined
        const discountedFromField = data.discountedPrice ? Number(data.discountedPrice) : undefined
        return {
          days: Number(data.days || 0),
          standardPrice,
          // Prefer "Preț Final (RON)" (discounted) if available; otherwise derive it from reducereAplicata.
          discountedPrice:
            typeof discountedFromField === "number" && !Number.isNaN(discountedFromField) && discountedFromField > 0
              ? discountedFromField
              : typeof discountedFromReduction === "number" && discountedFromReduction > 0
                ? discountedFromReduction
                : undefined,
        }
      }).filter((p) => p.days > 0 && p.standardPrice > 0)
      setPriceTable(items)
    } catch (e) {
      console.error("Error loading prices", e)
      setPriceTable([])
    }
  }

  const enrichRow = (row: DailyEntryExit, kind: "entry" | "exit"): EnrichedRow => {
    const withDates = row as Partial<EnrichedRow>
    const scheduledDate = kind === "entry" ? withDates.startDate ?? selectedDate : withDates.endDate ?? selectedDate
    const scheduledTime = row.time
    // IMPORTANT: keep LPR comparisons consistent with how LPR times are stored (UTC clock for camera-local time)
    const scheduled = parseDateTimeUTC(scheduledDate, scheduledTime)
    const now = new Date()
    let delay = row.delayMinutes

    // Prefer actual LPR time (if available) for delay calculation.
    // This prevents showing "late" just because "now" is after scheduled, when the car actually arrived early.
    if (delay === undefined && scheduled && row.actualTime) {
      const actual = parseDateTimeUTC(scheduledDate, row.actualTime)
      if (actual) {
        const diffMin = Math.round((actual.getTime() - scheduled.getTime()) / (1000 * 60))
        if (!Number.isNaN(diffMin)) delay = diffMin
      }
    }

    if (delay === undefined && scheduled) {
      const diffMin = Math.round((now.getTime() - scheduled.getTime()) / (1000 * 60))
      delay = diffMin > 0 ? diffMin : 0
    }

    let amountDueText: string | undefined
    let amountDueValue: number | undefined
    let autoCancelled = false
    const raw: any = row as any
    const isPayOnSite = row.source === "pay_on_site"
    const isOnlinePaid =
      raw.paymentStatus === "paid" ||
      raw.status === "confirmed_paid" ||
      raw.status === "paid" ||
      raw.status === "confirmed"

    if (kind === "exit" && scheduled) {
      const endBase = scheduled.getTime()

      // ONLINE: rule stays separate below
      if (isPayOnSite || !isOnlinePaid) {
        // PAY-ON-SITE + MANUAL + LPR (unpaid): exact price by total days (booked + extra late days)
        // If we already have a computed delay (from LPR departedAt), use it.
        // Otherwise, estimate against "now" (car likely still inside).
        const overdueMin =
          typeof delay === "number"
            ? Math.max(0, delay)
            : Math.max(0, Math.round((now.getTime() - endBase) / (1000 * 60)))

        // booked days (from booking start/end). Prefer time diff; fallback calendar days.
        const startDate = withDates.startDate
        const startTime = raw.startTime || row.time
        let bookedDays = 1
        const endDateVal = withDates.endDate
        const endTimeVal = (withDates as any).endTime || raw.endTime || row.time

        const startDt = startDate && startTime ? parseDateTime(startDate, startTime) : null
        const endDt = endDateVal && endTimeVal ? parseDateTime(endDateVal, endTimeVal) : null
        if (startDt && endDt && endDt.getTime() > startDt.getTime()) {
          bookedDays = Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000)))
        } else if (startDate && endDateVal && startDate !== endDateVal) {
          const startDay = new Date(`${startDate}T00:00:00`)
          const endDay = new Date(`${endDateVal}T00:00:00`)
          const diffMs = endDay.getTime() - startDay.getTime()
          if (diffMs >= 0) {
            bookedDays = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)) + 1)
          }
        }

        // Extra days should count only after full 24h blocks, not for a few hours delay.
        // (Example: 3h delay => 0 extra days; 25h delay => 1 extra day.)
        const extraDays = overdueMin > 0 ? Math.floor(overdueMin / (60 * 24)) : 0
        const totalDays = Math.max(1, bookedDays + extraDays)

        const totalPrice = getExactPriceForDays(priceTable, totalDays)
        if (totalPrice !== null && totalPrice > 0) {
          amountDueValue = totalPrice
          amountDueText = `${totalPrice.toFixed(2)} LEI`
        } else {
          amountDueText = "Calcul conform tarifelor MULTIPARK/WP"
        }

        if (isPayOnSite && overdueMin > PAY_ON_SITE_CANCEL_AFTER_MIN) {
          autoCancelled = true
          autoCancelPayOnSite(row.id).catch(() => {})
  }
      } else {
        // ONLINE: allowed exit = start + days*24h + grace (60 min)
        const startDateVal = withDates.startDate
        const startTimeVal = raw.startTime || row.time
        const endDateVal = withDates.endDate
        const endTimeVal = (withDates as any).endTime || raw.endTime || row.time
        const startDt = startDateVal && startTimeVal ? parseDateTime(startDateVal, startTimeVal) : null
        const endDt = endDateVal && endTimeVal ? parseDateTime(endDateVal, endTimeVal) : null
        let days = 1
        if (startDt && endDt && endDt.getTime() > startDt.getTime()) {
          const diffMs = endDt.getTime() - startDt.getTime()
          days = Math.ceil(diffMs / (24 * 60 * 60 * 1000))
        }
        const graceMs = ONLINE_GRACE_MINUTES * 60 * 1000
        const allowedExitMs = startDt
          ? startDt.getTime() + days * 24 * 60 * 60 * 1000 + graceMs
          : endBase + graceMs
        const overMs = now.getTime() - allowedExitMs
        if (overMs > 0) {
          const daysLate = Math.ceil(overMs / (24 * 60 * 60 * 1000))
          amountDueValue = daysLate * LATE_FEE_PER_DAY
          amountDueText = `${amountDueValue.toFixed(2)} LEI`
        } else {
          amountDueText = "Achitat"
        }
      }
    }

    return {
      ...(row as any),
      startDate: withDates.startDate,
      endDate: withDates.endDate,
      delayMinutesComputed: delay,
      amountDueText,
      amountDueValue,
      isLate: delay !== undefined && delay > 0,
      autoCancelled,
      isPayOnSite,
      isOnlinePaid
    }
  }

  const enrichedEntries = useMemo(() => entries.map((e) => enrichRow(e, "entry")), [entries])
  const enrichedExits = useMemo(() => exits.map((e) => enrichRow(e, "exit")), [exits])

  const mainEntries = useMemo(() => enrichedEntries.filter((e) => !e.isLate), [enrichedEntries])
  const mainExits = useMemo(() => enrichedExits.filter((e) => !e.isLate), [enrichedExits])
  const lateEntries = enrichedEntries.filter((e) => e.isLate)
  const lateExits = enrichedExits.filter((e) => e.isLate)

  if (!isClient) return null

  const renderTable = (
    rows: EnrichedRow[],
    kind: "entry" | "exit",
    opts?: {
      showDelay?: boolean
      showLprTime?: boolean
    },
  ) => {
    const showDelay = opts?.showDelay ?? kind === "exit"
    const showLprTime = opts?.showLprTime ?? kind === "entry"
    const cardBg = kind === "entry" ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-200"
    return (
    <>
      {/* Desktop table */}
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 font-semibold">ORA</th>
              <th className="text-left py-2 px-2 font-semibold">NR ÎNMATRICULARE</th>
              <th className="text-left py-2 px-2 font-semibold">TEL</th>
              <th className="text-left py-2 px-2 font-semibold">NR PERSOANE</th>
              {showLprTime && <th className="text-left py-2 px-2 font-semibold">LPR</th>}
              {showDelay && <th className="text-left py-2 px-2 font-semibold">Ore întârziate</th>}
              {kind === "exit" && <th className="text-left py-2 px-2 font-semibold">Valoarea de plată</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-3 px-2 font-medium">
                  <span className="font-semibold">{row.time}</span>
                </td>
                <td className="py-3 px-2">
                  <div className="flex flex-col items-start gap-1">
                    {row.source === "manual" && (
                      <Badge
                        variant="outline"
                        className="text-pink-700 border-pink-400 bg-pink-100 text-[10px] leading-tight whitespace-nowrap px-2 py-1"
                      >
                        MANUAL
                      </Badge>
                    )}
                    {row.isOnlinePaid && row.source !== "manual" && row.source !== "pay_on_site" && (
                      <Badge
                        variant="outline"
                        className="text-green-700 border-green-400 bg-green-100 text-[10px] leading-tight whitespace-nowrap px-2 py-1"
                      >
                        ONLINE
                      </Badge>
                    )}
                    {row.source === "pay_on_site" && (
                      <Badge
                        variant="outline"
                        className="text-orange-700 border-orange-400 bg-orange-100 text-[10px] leading-tight whitespace-nowrap px-2 py-1"
                      >
                        PLATĂ LA PARCARE
                      </Badge>
                    )}
                    <span className="font-semibold">{row.licensePlate}</span>
                  </div>
                </td>
                <td className="py-3 px-2">{row.phone}</td>
                <td className="py-3 px-2 text-center">{row.numberOfPersons}</td>
                {showLprTime && (
                  <td className="py-3 px-2">
                    {row.actualTime ? <span className="font-semibold">{row.actualTime}</span> : "-"}
                  </td>
                )}
                {showDelay && (
                  <td className={`py-3 px-2 ${row.delayMinutesComputed && row.delayMinutesComputed > 0 ? "text-red-700 font-semibold" : ""}`}>
                    {row.delayMinutesComputed !== undefined ? formatDelay(row.delayMinutesComputed) : "-"}
                  </td>
                )}
              {kind === "exit" && (
                <td className="py-3 px-2">
                  {row.amountDueText ? (
                    row.amountDueText.toLowerCase().includes("achitat") ? (
                      <span className="text-green-700 font-semibold">Achitat</span>
                    ) : (
                      <span className="text-red-700 font-semibold">{row.amountDueText}</span>
                    )
                  ) : typeof row.amount === "number" ? (
                    <span className="text-red-700 font-semibold">{row.amount.toFixed(2)} LEI</span>
                  ) : row.isOnlinePaid ? (
                    <span className="text-green-700 font-semibold">Achitat</span>
                  ) : (
                    "-"
                  )}
                  {row.autoCancelled && (
                    <div className="text-xs text-red-700 font-semibold">Anulat automat (depășit 3h)</div>
                  )}
                </td>
              )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={row.id} className={`rounded-lg border p-3 shadow-sm ${cardBg}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {row.source === "manual" && (
                  <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                    MANUAL
                  </Badge>
                )}
                {row.isOnlinePaid && row.source !== "manual" && row.source !== "pay_on_site" && (
                  <Badge variant="outline" className="text-green-700 border-green-400 bg-green-100 text-xs">
                    ONLINE
                  </Badge>
                )}
                {row.source === "pay_on_site" && (
                  <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                    PLATĂ LA PARCARE
                  </Badge>
                )}
                <span className="font-semibold text-base">{row.licensePlate}</span>
              </div>
              <span className="text-sm font-semibold">{row.time}</span>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">Telefon</div>
              <div className="text-right text-gray-900">{row.phone || "-"}</div>

              <div className="text-muted-foreground">Nr persoane</div>
              <div className="text-right text-gray-900">{row.numberOfPersons}</div>

              {showLprTime && (
                <>
                  <div className="text-muted-foreground">LPR</div>
                  <div className="text-right text-gray-900">{row.actualTime || "-"}</div>
                </>
              )}

              {showDelay && (
                <>
                  <div className="text-muted-foreground">Întârziere</div>
                  <div className={`text-right ${row.delayMinutesComputed && row.delayMinutesComputed > 0 ? "text-red-700 font-semibold" : "text-gray-900"}`}>
                    {row.delayMinutesComputed !== undefined ? formatDelay(row.delayMinutesComputed) : "-"}
                  </div>
                </>
              )}

              {kind === "exit" && (
                <>
                  <div className="text-muted-foreground">De plată</div>
                  <div className="text-right text-gray-900">
                    {row.amountDueText
                      ? row.amountDueText.toLowerCase().includes("achitat")
                        ? <span className="text-green-700 font-semibold">Achitat</span>
                        : <span className="text-red-700 font-semibold">{row.amountDueText}</span>
                      : typeof row.amount === "number"
                        ? <span className="text-red-700 font-semibold">{row.amount.toFixed(2)} LEI</span>
                        : row.isOnlinePaid
                          ? <span className="text-green-700 font-semibold">Achitat</span>
                          : "-"
                    }
                    {row.autoCancelled && <div className="text-xs text-red-700 font-semibold">Anulat auto (3h)</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )}

  return (
    <div className="space-y-6 pb-24 md:pb-0">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intrări/Ieșiri</h1>
          <p className="text-muted-foreground text-xs md:text-sm">
            Selectează data (ex: 25.10.2025) și vezi intrările/ieșirile pentru acea zi.
          </p>
        </div>
        <Button onClick={loadData} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Se încarcă..." : "Actualizează"}
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <div>
          <Label htmlFor="date-select" className="block text-sm font-medium text-gray-700 mb-2">
            Selectează data
          </Label>
            <input
              id="date-select"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary date-input-dd-mm-yyyy"
            />
          </div>
        </div>
        
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as "entries" | "exits")
          setEntriesView("both")
          setExitsView("both")
        }}
      >
        <TabsList className="grid w-full grid-cols-2 md:static fixed bottom-0 left-0 z-30 bg-white border-t shadow md:border-none md:shadow-none">
          <TabsTrigger
            value="entries"
            className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-900 data-[state=active]:border-blue-200 md:border md:border-transparent"
          >
            Intrări
          </TabsTrigger>
          <TabsTrigger
            value="exits"
            className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-900 data-[state=active]:border-amber-200 md:border md:border-transparent"
          >
            Ieșiri
          </TabsTrigger>
        </TabsList>

        <TabsContent value="entries" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {entriesView !== "late" && (
              <Card className="h-full border-blue-200 bg-blue-50" id="entries-main">
            <CardHeader>
                <CardTitle>Intrări</CardTitle>
            </CardHeader>
            <CardContent>
                {mainEntries.length === 0 ? <p className="text-gray-500">Nu există intrări.</p> : renderTable(mainEntries, "entry", { showDelay: false, showLprTime: true })}
            </CardContent>
          </Card>
            )}

            {entriesView !== "main" && (
              <Card className="h-full border-blue-200 bg-blue-50" id="entries-late">
            <CardHeader>
                <CardTitle>Intrări întârziate</CardTitle>
             
            </CardHeader>
            <CardContent>
                {lateEntries.length === 0 ? <p className="text-gray-500">Nu există intrări întârziate.</p> : renderTable(lateEntries, "entry", { showDelay: true, showLprTime: true })}
            </CardContent>
          </Card>
            )}
        </div>
        </TabsContent>

        <TabsContent value="exits" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            {exitsView !== "late" && (
              <Card className="h-full border-amber-200 bg-amber-50" id="exits-main">
                <CardHeader>
                <CardTitle>Ieșiri</CardTitle>
          
                </CardHeader>
                <CardContent>
                {mainExits.length === 0 ? <p className="text-gray-500">Nu există ieșiri.</p> : renderTable(mainExits, "exit")}
                </CardContent>
              </Card>
            )}
            
            {exitsView !== "main" && (
              <Card className="h-full border-amber-200 bg-amber-50" id="exits-late">
                <CardHeader>
                <CardTitle>Ieșiri întârziate</CardTitle>
                </CardHeader>
                <CardContent>
                {lateExits.length === 0 ? <p className="text-gray-500">Nu există ieșiri întârziate.</p> : renderTable(lateExits, "exit")}
                </CardContent>
              </Card>
            )}
          </div>
            </TabsContent>
          </Tabs>

      {/* Bottom quick-nav for mobile */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t shadow">
        <div className="grid grid-cols-2 text-base font-semibold divide-x">
          <button
            type="button"
            className="py-3 flex flex-col items-center justify-center bg-blue-50"
            onClick={() => jumpToTab("entries")}
          >
            Intrări
          </button>
          <button
            type="button"
            className="py-3 flex flex-col items-center justify-center bg-amber-50"
            onClick={() => jumpToTab("exits")}
          >
            Ieșiri
          </button>
        </div>
      </div>
    </div>
  )
} 

