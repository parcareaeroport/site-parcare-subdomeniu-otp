"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { getDailyEntries, getDailyExits, type DailyEntryExit } from "@/lib/admin-stats"
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, where, limit } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/context/auth-context"
import { writeManualLprEvent } from "@/lib/manual-lpr-event"

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

const LATE_FEE_PER_DAY = 30 // lei / zi întârziere (online)
const ONLINE_GRACE_MINUTES = 60 // 1h bonus la ultima zi (online)

type PriceEntry = {
  days: number
  standardPrice: number
  discountedPrice?: number
}

type ManualLprKind = "entry" | "exit"

type ManualLprDialogState = {
  open: boolean
  kind: ManualLprKind
  row: EnrichedRow | null
  date: string
  time: string
  confirmOverwrite: boolean
  saving: boolean
}

function normalizeHHmm(time?: string) {
  if (!time) return time
  const t = String(time).trim()
  // Accept "H:mm" or "HH:mm" and normalize to "HH:mm"
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return t
  const hh = m[1].padStart(2, "0")
  const mm = m[2]
  const ss = m[3]
  return ss ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`
}

function parseDateTime(date?: string, time?: string) {
  if (!date || !time) return null
  const tt = normalizeHHmm(time)
  if (!tt || tt.toLowerCase() === "n/a") return null
  const asIso = `${date}T${tt.length === 5 ? `${tt}:00` : tt}`
  const d = new Date(asIso)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseDateTimeUTC(date?: string, time?: string) {
  if (!date || !time) return null
  const tt = normalizeHHmm(time)
  if (!tt || tt.toLowerCase() === "n/a") return null
  const asIso = `${date}T${tt.length === 5 ? `${tt}:00` : tt}Z`
  const d = new Date(asIso)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatShortDateDM(date?: string) {
  if (!date) return ""
  // Expect "YYYY-MM-DD"; if not, just return as-is.
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(date)
  const [, , mm, dd] = m
  return `${dd}/${mm}`
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

function getScheduledSortKey(row: Partial<EnrichedRow>, kind: "entry" | "exit", fallbackDate: string): number {
  const date = kind === "entry" ? row.startDate ?? fallbackDate : row.endDate ?? fallbackDate
  // Some sources store start/end times separately; prefer the kind-specific field when present.
  const anyRow: any = row as any
  const time = kind === "entry" ? (anyRow.startTime ?? row.time) : (anyRow.endTime ?? row.time)
  const dt = parseDateTime(date, time)
  if (dt) return dt.getTime()
  // Fallback: sort unknown/invalid times last, but keep deterministic ordering by string
  const t = normalizeHHmm(time) ?? ""
  return Number.MAX_SAFE_INTEGER - Math.min(999_999, t.length)
}

export default function EntriesExitsPage() {
  const { toast } = useToast()
  const { user, isAdmin } = useAuth()
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
  const loadingRef = useRef(false)
  const [currentTime, setCurrentTime] = useState("")
  const [priceTable, setPriceTable] = useState<PriceEntry[]>([])
  const [entriesView, setEntriesView] = useState<"both" | "main" | "late">("both")
  const [exitsView, setExitsView] = useState<"both" | "main" | "late">("both")
  const [manualLpr, setManualLpr] = useState<ManualLprDialogState>({
    open: false,
    kind: "entry",
    row: null,
    date: "",
    time: "",
    confirmOverwrite: false,
    saving: false,
  })
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

  // Auto-refresh data every minute (skip when tab is hidden; avoid overlapping requests)
  useEffect(() => {
    if (!isClient) return
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      loadData()
    }, 60000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, selectedDate, includeFuture])

  const openManualLprDialog = (row: EnrichedRow, kind: ManualLprKind) => {
    const fallbackDate =
      kind === "entry" ? (row.startDate ?? selectedDate) : (row.endDate ?? selectedDate)
    const defaultTime = normalizeHHmm(row.actualTime) || normalizeHHmm(row.time) || normalizeHHmm(currentTime) || "12:00"
    setManualLpr({
      open: true,
      kind,
      row,
      date: fallbackDate,
      time: defaultTime,
      confirmOverwrite: false,
      saving: false,
    })
  }

  const closeManualLprDialog = () => {
    setManualLpr((s) => ({ ...s, open: false, row: null, saving: false, confirmOverwrite: false }))
  }

  const toManualLprIsoZ = (date: string, time: string): string | null => {
    if (!date || !time) return null
    const d = String(date).trim()
    const t = normalizeHHmm(time)
    if (!t || t.toLowerCase() === "n/a") return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(t)) return null
    const iso = `${d}T${t.length === 5 ? `${t}:00` : t}Z`
    const parsed = new Date(iso)
    return Number.isNaN(parsed.getTime()) ? null : iso
  }

  const isCarryOverEligibleStatus = (raw: any): boolean => {
    // We only carry over "real" bookings (not cancelled/expired) that operations care about,
    // regardless of payment method (card/online or pay-on-site).
    const s = String(raw?.status || "").toLowerCase()
    if (!s) return false
    if (s === "expired" || s.includes("cancelled")) return false
    if (s === "unmatched_lpr") return false
    // Keep this aligned with Firestore "in" query sets below.
    return (
      s === "confirmed_paid" ||
      s === "paid" ||
      s === "confirmed" ||
      s === "confirmed_test" ||
      s === "confirmed_pay_on_site"
    )
  }

  const fetchCarryOverLateEntries = async (date: string): Promise<DailyEntryExit[]> => {
    try {
      const bookingsRef = collection(db, "bookings")
      const q = query(
        bookingsRef,
        where("startDate", "<", date),
        where("status", "in", ["confirmed_paid", "paid", "confirmed", "confirmed_test", "confirmed_pay_on_site"]),
        where("lpr.arrivedAt", "==", null),
        orderBy("startDate", "asc"),
        orderBy("startTime", "asc"),
      )
      const snap = await getDocs(q)
      const out: DailyEntryExit[] = []
      snap.forEach((d) => {
        const b: any = d.data()
        if (!isCarryOverEligibleStatus(b)) return
        const lpr = b.lpr || {}
        if (lpr?.arrivedAt) return
        out.push({
          id: d.id,
          startDate: b.startDate || undefined,
          endDate: b.endDate || undefined,
          time: b.startTime || "N/A",
          licensePlate: b.licensePlate || "N/A",
          phone: b.clientPhone || "N/A",
          numberOfPersons: b.numberOfPersons ? b.numberOfPersons : "N/A",
          source: b.source || "webhook",
          bookingStatus: b.status,
          actualTime: undefined,
          delayMinutes: undefined,
          amount: typeof b.amount === "number" ? b.amount : undefined,
        })
      })
      return out
    } catch (e) {
      console.error("Error fetching carry-over late entries", e)
      return []
    }
  }

  const fetchCarryOverLateExits = async (date: string): Promise<DailyEntryExit[]> => {
    try {
      const bookingsRef = collection(db, "bookings")
      const q = query(
        bookingsRef,
        where("endDate", "<", date),
        where("status", "in", ["confirmed_paid", "paid", "confirmed", "confirmed_test", "confirmed_pay_on_site"]),
        where("lpr.isInside", "==", true),
        orderBy("endDate", "asc"),
        orderBy("endTime", "asc"),
      )
      const snap = await getDocs(q)
      const out: DailyEntryExit[] = []
      snap.forEach((d) => {
        const b: any = d.data()
        if (!isCarryOverEligibleStatus(b)) return
        const lpr = b.lpr || {}
        if (lpr?.departedAt) return
        if (lpr?.isInside !== true) return
        out.push({
          id: d.id,
          startDate: b.startDate || undefined,
          endDate: b.endDate || undefined,
          time: b.endTime || "N/A",
          licensePlate: b.licensePlate || "N/A",
          phone: b.clientPhone || "N/A",
          numberOfPersons: b.numberOfPersons ? b.numberOfPersons : "N/A",
          source: b.source || "webhook",
          bookingStatus: b.status,
          hasArrived: true,
          actualTime: undefined,
          delayMinutes: undefined,
          amount: typeof b.amount === "number" ? b.amount : undefined,
        })
      })
      return out
    } catch (e) {
      console.error("Error fetching carry-over late exits", e)
      return []
    }
  }

  const saveManualLpr = async () => {
    const row = manualLpr.row
    if (!row?.id) return

    if (!user) {
      toast({
        title: "Acces restricționat",
        description: "Trebuie să fii autentificat pentru a seta manual intrarea/ieșirea LPR.",
        variant: "destructive",
      })
      return
    }

    const isoZ = toManualLprIsoZ(manualLpr.date, manualLpr.time)
    if (!isoZ) {
      toast({
        title: "Dată/Oră invalidă",
        description: "Verifică data și ora (ex: 2025-12-24 și 14:30).",
        variant: "destructive",
      })
      return
    }

    const hasExisting = Boolean(row.actualTime)
    if (hasExisting && !manualLpr.confirmOverwrite) {
      toast({
        title: "Confirmare necesară",
        description: "Există deja o valoare LPR. Bifează confirmarea ca să suprascrii.",
        variant: "destructive",
      })
      return
    }

    try {
      setManualLpr((s) => ({ ...s, saving: true }))

      const kind = manualLpr.kind
      await writeManualLprEvent({
        bookingId: row.id,
        plateNumber: row.licensePlate || "",
        eventType: kind,
        eventTimeIsoZ: isoZ,
        adminUid: user?.uid ?? null,
        adminEmail: user?.email ?? null,
      })

      toast({
        title: "Salvat",
        description:
          manualLpr.kind === "entry" ? "Intrarea LPR a fost setată manual." : "Ieșirea LPR a fost setată manual.",
      })
      closeManualLprDialog()
      await loadData()
    } catch (e: any) {
      console.error("Manual LPR override failed", e)
      toast({
        title: "Eroare la salvare",
        description: e?.message ? String(e.message) : "Nu s-a putut salva modificarea.",
        variant: "destructive",
      })
      setManualLpr((s) => ({ ...s, saving: false }))
    }
  }

  const loadData = async () => {
    try {
      if (loadingRef.current) return
      loadingRef.current = true
      setLoading(true)
      const [e1, e2, carryEntries, carryExits] = await Promise.all([
        getDailyEntries(selectedDate, includeFuture),
        getDailyExits(selectedDate, includeFuture)
        ,
        fetchCarryOverLateEntries(selectedDate),
        fetchCarryOverLateExits(selectedDate),
      ])

      const dedupeById = <T extends { id: string }>(rows: T[]): T[] => {
        const seen = new Set<string>()
        const out: T[] = []
        for (const r of rows) {
          if (!r?.id) continue
          if (seen.has(r.id)) continue
          seen.add(r.id)
          out.push(r)
        }
        return out
      }

      setEntries(dedupeById([...e1, ...carryEntries]))
      setExits(dedupeById([...e2, ...carryExits]))
    } catch (e) {
      console.error("Error loading entries/exits", e)
      setEntries([])
      setExits([])
    } finally {
      setLoading(false)
      loadingRef.current = false
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

  const isCancelledOrExpiredStatus = (status?: string) => {
    const s = String(status || "").toLowerCase()
    if (!s) return false
    return s === "expired" || s.includes("cancelled")
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
      // NOTE:
      // The UI "ORA" values are treated as Romania local clock time by operations,
      // but here `scheduled` is parsed as UTC (with "Z") for consistency with stored LPR clock strings.
      // When there is NO LPR time yet (we compare against "now"), this would undercount lateness by the local UTC offset.
      // Fix by compensating with the local timezone offset (e.g. RO winter +120 min, summer +180 min).
      const tzCompMin = -now.getTimezoneOffset()
      delay = diffMin + tzCompMin > 0 ? diffMin + tzCompMin : 0
    }

    let amountDueText: string | undefined
    let amountDueValue: number | undefined
    let autoCancelled = false
    const raw: any = row as any
    const isPayOnSite = row.source === "pay_on_site"
    const isLprUnpaid = row.source === "lpr" || row.bookingStatus === "unmatched_lpr" || raw.status === "unmatched_lpr"
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

        // PAY-ON-SITE and LPR must always show the payable amount (base price + any extra days) in red.
        // Only non-LPR unpaid sources (e.g. some manual flows) keep the old "Achitat" UI when not overdue.
        if (!isPayOnSite && !isLprUnpaid && overdueMin <= 0) {
          amountDueText = "Achitat"
        } else {
          // Extra days billing policy (pay-on-site / unpaid):
          // The payment terminal charges an additional full day for ANY overdue time past the scheduled end,
          // so we must round up (ceil) instead of counting only full 24h blocks.
          // (Example: 3h delay => 1 extra day; 25h delay => 2 extra days.)
          const extraDays = overdueMin > 0 ? Math.ceil(overdueMin / (60 * 24)) : 0
          const totalDays = Math.max(1, bookedDays + extraDays)

          const totalPrice = getExactPriceForDays(priceTable, totalDays)
          if (totalPrice !== null && totalPrice > 0) {
            amountDueValue = totalPrice
            amountDueText = `${totalPrice.toFixed(2)} LEI`
          } else {
            amountDueText = "Calcul conform tarifelor MULTIPARK/WP"
          }
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

  const visibleEnrichedEntries = useMemo(
    () => enrichedEntries.filter((e) => !isCancelledOrExpiredStatus((e as any).bookingStatus)),
    [enrichedEntries],
  )
  const visibleEnrichedExits = useMemo(
    () => enrichedExits.filter((e) => !isCancelledOrExpiredStatus((e as any).bookingStatus)),
    [enrichedExits],
  )

  // "Intrări" (main) should list only upcoming entries (not yet arrived via LPR).
  // Entries that already happened (have LPR actualTime) should not appear here.
  const mainEntries = useMemo(() => {
    // Main "Intrări" must show ONLY the selected day.
    const rows = visibleEnrichedEntries.filter((e) => (e.startDate ?? selectedDate) === selectedDate && !e.isLate && !e.actualTime)
    return [...rows].sort(
      (a, b) =>
        getScheduledSortKey(a, "entry", selectedDate) - getScheduledSortKey(b, "entry", selectedDate),
    )
  }, [visibleEnrichedEntries, selectedDate])
  // "Ieșiri" (main) should list only upcoming exits (not yet departed via LPR).
  // Exits that already happened (have LPR actualTime) should not appear here.
  const mainExits = useMemo(() => {
    // Main "Ieșiri" must show ONLY the selected day.
    const rows = visibleEnrichedExits.filter((e) => (e.endDate ?? selectedDate) === selectedDate && e.hasArrived === true && !e.isLate && !e.actualTime)
    return [...rows].sort(
      (a, b) => getScheduledSortKey(a, "exit", selectedDate) - getScheduledSortKey(b, "exit", selectedDate),
    )
  }, [visibleEnrichedExits, selectedDate])
  // "Intrări întârziate" should list only bookings that are late AND still not arrived (no LPR actualTime yet).
  // Once LPR confirms arrival, it should disappear from this list.
  const lateEntries = useMemo(() => {
    // IMPORTANT: late entries are cumulative (carry-over) from previous days,
    // but we should NOT include future days when includeFuture=true.
    const rows = visibleEnrichedEntries.filter((e) => {
      const d = (e.startDate ?? selectedDate)
      return d <= selectedDate && e.isLate && !e.actualTime
    })
    return [...rows].sort(
      (a, b) =>
        getScheduledSortKey(a, "entry", selectedDate) - getScheduledSortKey(b, "entry", selectedDate),
    )
  }, [visibleEnrichedEntries, selectedDate])
  // "Ieșiri întârziate" should list only bookings that are late AND still not departed (no LPR actualTime yet).
  // Once LPR confirms departure, it should disappear from this list.
  const lateExits = useMemo(() => {
    // Keep consistent with late entries: allow carry-over from previous days, exclude future.
    const rows = visibleEnrichedExits.filter((e) => {
      const d = (e.endDate ?? selectedDate)
      return d <= selectedDate && e.hasArrived === true && e.isLate && !e.actualTime
    })
    return [...rows].sort((a, b) => {
      // Most recent scheduled exit first (so newest late is on top, oldest at the bottom).
      const ka = getScheduledSortKey(a, "exit", selectedDate)
      const kb = getScheduledSortKey(b, "exit", selectedDate)
      if (kb !== ka) return kb - ka
      // Deterministic tie-breaker to avoid "random" ordering when times are equal/missing.
      const plateA = String(a.licensePlate ?? "").toLowerCase()
      const plateB = String(b.licensePlate ?? "").toLowerCase()
      if (plateA !== plateB) return plateA.localeCompare(plateB)
      return String(a.id ?? "").localeCompare(String(b.id ?? ""))
    })
  }, [visibleEnrichedExits, selectedDate])

  if (!isClient) return null

  const renderTable = (
    rows: EnrichedRow[],
    kind: "entry" | "exit",
    opts?: {
      showDelay?: boolean
      showLprTime?: boolean
      showScheduledDateTime?: boolean
    },
  ) => {
    const showDelay = opts?.showDelay ?? kind === "exit"
    const showLprTime = opts?.showLprTime ?? kind === "entry"
    const showScheduledDateTime = opts?.showScheduledDateTime ?? false
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
                  {(() => {
                    const scheduledDate = kind === "entry" ? row.startDate : row.endDate
                    const showDate = showScheduledDateTime && Boolean(scheduledDate)
                    return (
                      <div className="flex flex-col leading-tight">
                        {showDate && <span className="text-xs text-gray-600">{formatShortDateDM(scheduledDate)}</span>}
                        <span className="font-semibold">{row.time}</span>
                      </div>
                    )
                  })()}
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
                    {(row.source === "lpr" || row.bookingStatus === "unmatched_lpr") && (
                      <Badge
                        variant="outline"
                        className="text-purple-700 border-purple-400 bg-purple-100 text-[10px] leading-tight whitespace-nowrap px-2 py-1"
                      >
                        LPR
                      </Badge>
                    )}
                    {row.isOnlinePaid && row.source !== "manual" && row.source !== "pay_on_site" && row.source !== "lpr" && (
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
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 font-semibold text-left"
                      onClick={() => openManualLprDialog(row, kind)}
                    >
                      {row.licensePlate}
                    </Button>
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
                  {typeof row.amountDueValue === "number" && row.amountDueValue > 0 ? (
                    <span className="text-red-700 font-semibold">{row.amountDueText ?? `${row.amountDueValue.toFixed(2)} LEI`}</span>
                  ) : row.amountDueText?.toLowerCase().includes("achitat") ? (
                      <span className="text-green-700 font-semibold">Achitat</span>
                  ) : row.amountDueText ? (
                    // Non-numeric info (e.g. "Calcul conform...") should not be highlighted as debt
                    <span className="text-gray-900">{row.amountDueText}</span>
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
                {(row.source === "lpr" || row.bookingStatus === "unmatched_lpr") && (
                  <Badge variant="outline" className="text-purple-700 border-purple-400 bg-purple-100 text-xs">
                    LPR
                  </Badge>
                )}
                {row.isOnlinePaid && row.source !== "manual" && row.source !== "pay_on_site" && row.source !== "lpr" && (
                  <Badge variant="outline" className="text-green-700 border-green-400 bg-green-100 text-xs">
                    ONLINE
                  </Badge>
                )}
                {row.source === "pay_on_site" && (
                  <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                    PLATĂ LA PARCARE
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 font-semibold text-base"
                  onClick={() => openManualLprDialog(row, kind)}
                >
                  {row.licensePlate}
                </Button>
              </div>
              {(() => {
                const scheduledDate = kind === "entry" ? row.startDate : row.endDate
                const showDate = showScheduledDateTime && Boolean(scheduledDate)
                return (
                  <div className="flex flex-col items-end leading-tight">
                    {showDate && <span className="text-[11px] text-gray-600">{formatShortDateDM(scheduledDate)}</span>}
                    <span className="text-sm font-semibold">{row.time}</span>
                  </div>
                )
              })()}
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
                    {typeof row.amountDueValue === "number" && row.amountDueValue > 0
                      ? <span className="text-red-700 font-semibold">{row.amountDueText ?? `${row.amountDueValue.toFixed(2)} LEI`}</span>
                      : row.amountDueText?.toLowerCase().includes("achitat")
                        ? <span className="text-green-700 font-semibold">Achitat</span>
                        : row.amountDueText
                          ? <span className="text-gray-900">{row.amountDueText}</span>
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
                {lateEntries.length === 0 ? <p className="text-gray-500">Nu există intrări întârziate.</p> : renderTable(lateEntries, "entry", { showDelay: true, showLprTime: true, showScheduledDateTime: true })}
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
                {lateExits.length === 0 ? <p className="text-gray-500">Nu există ieșiri întârziate.</p> : renderTable(lateExits, "exit", { showScheduledDateTime: true })}
                </CardContent>
              </Card>
            )}
          </div>
            </TabsContent>
          </Tabs>

      <Dialog
        open={manualLpr.open}
        onOpenChange={(open) => {
          if (!open) closeManualLprDialog()
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {manualLpr.kind === "entry" ? "Setează Intrare LPR (manual)" : "Setează Ieșire LPR (manual)"}
            </DialogTitle>
            <DialogDescription>
              {manualLpr.row?.licensePlate ? (
                <>
                  Nr: <span className="font-semibold">{manualLpr.row.licensePlate}</span>
                </>
              ) : (
                "Completează data și ora."
              )}
            </DialogDescription>
          </DialogHeader>

          {!user && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Trebuie să fii autentificat pentru a salva modificări manuale LPR.
            </div>
          )}

          <div className="grid gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="manual-lpr-date">Data</Label>
                <Input
                  id="manual-lpr-date"
                  type="date"
                  value={manualLpr.date}
                  disabled={manualLpr.saving}
                  onChange={(e) => setManualLpr((s) => ({ ...s, date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manual-lpr-time">Ora</Label>
                <Input
                  id="manual-lpr-time"
                  type="time"
                  value={manualLpr.time}
                  disabled={manualLpr.saving}
                  onChange={(e) => setManualLpr((s) => ({ ...s, time: e.target.value }))}
                />
              </div>
            </div>

            {Boolean(manualLpr.row?.actualTime) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm text-amber-900">
                  Există deja o valoare LPR pentru acest rând:{" "}
                  <span className="font-semibold">{manualLpr.row?.actualTime}</span>. Pentru suprascriere, bifează
                  confirmarea.
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Checkbox
                    id="manual-lpr-overwrite"
                    checked={manualLpr.confirmOverwrite}
                    disabled={manualLpr.saving}
                    onCheckedChange={(v) => setManualLpr((s) => ({ ...s, confirmOverwrite: v === true }))}
                  />
                  <Label htmlFor="manual-lpr-overwrite" className="text-sm">
                    Confirm suprascrierea valorii LPR existente
                  </Label>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeManualLprDialog} disabled={manualLpr.saving}>
              Renunță
            </Button>
            <Button
              type="button"
              onClick={saveManualLpr}
              disabled={
                manualLpr.saving ||
                !manualLpr.row?.id ||
                !user ||
                (Boolean(manualLpr.row?.actualTime) && !manualLpr.confirmOverwrite)
              }
            >
              {manualLpr.saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Salvează
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

