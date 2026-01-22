"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { getDailyEntries, getDailyExits, type DailyEntryExit } from "@/lib/admin-stats"
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc, where, limit } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/context/auth-context"
import { writeManualLprEvent } from "@/lib/manual-lpr-event"
import { normalizeLicensePlate } from "@/lib/utils"

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

const DEBUG_ROW_DETAILS = process.env.NEXT_PUBLIC_ADMIN_ROW_DEBUG === "true"
const DEBUG_EXIT_SIM = process.env.NEXT_PUBLIC_ADMIN_EXIT_SIM === "true" || DEBUG_ROW_DETAILS
const DEBUG_EXIT_SIM_WRITE = process.env.NEXT_PUBLIC_ADMIN_EXIT_SIM_WRITE === "true"

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

function coerceMoney(value: any): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") {
    const s = value.trim()
    if (!s) return undefined
    const n = Number(s.replace(",", "."))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
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

const DAY_MS = 24 * 60 * 60 * 1000

function computeTotalDaysByStartClock(startDt: Date | null, endDt: Date | null): number | null {
  if (!startDt || !endDt) return null
  const diffMs = endDt.getTime() - startDt.getTime()
  if (!Number.isFinite(diffMs)) return null
  if (diffMs <= 0) return 1
  return Math.max(1, Math.ceil(diffMs / DAY_MS))
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

function shiftIsoDate(isoYmd: string, deltaDays: number): string {
  // isoYmd: "YYYY-MM-DD"
  const d = new Date(`${isoYmd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoYmd
  d.setDate(d.getDate() + deltaDays)
  return d.toISOString().slice(0, 10)
}

function diffCalendarDays(startDate?: string, endDate?: string): number {
  if (!startDate || !endDate) return 0
  const s = new Date(`${startDate}T00:00:00`)
  const e = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0
  const diffMs = e.getTime() - s.getTime()
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)))
}

function safeJsonStringify(value: any): string {
  try {
    return JSON.stringify(
      value,
      (_k, v) => {
        // Firestore Timestamp
        if (v && typeof v === "object" && typeof v.toDate === "function") {
          try {
            return v.toDate().toISOString()
          } catch {
            return v
          }
        }
        return v
      },
      2,
    )
  } catch (e) {
    return `<<json stringify failed: ${String((e as any)?.message || e)}>>`
  }
}

function getExactPriceForDays(
  priceTable: PriceEntry[],
  days: number,
  opts?: {
    useDiscounted?: boolean
  },
): number | null {
  if (!days || days <= 0) return null
  if (!priceTable || priceTable.length === 0) return null
  const useDiscounted = opts?.useDiscounted ?? true
  const exact = priceTable.find((p) => p.days === days)
  if (exact) return (useDiscounted ? (exact.discountedPrice ?? exact.standardPrice) : exact.standardPrice) || null
  // fallback: nearest greater, otherwise last
  const sorted = [...priceTable].sort((a, b) => a.days - b.days)
  const nearest = sorted.find((p) => p.days >= days) || sorted[sorted.length - 1]
  if (!nearest) return null
  return (useDiscounted ? (nearest.discountedPrice ?? nearest.standardPrice) : nearest.standardPrice) || null
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
  const [simulatedExits, setSimulatedExits] = useState<DailyEntryExit[]>([])
  const [simDialogOpen, setSimDialogOpen] = useState(false)
  const [simType, setSimType] = useState<"pay_on_site" | "online">("pay_on_site")
  const [simStartDate, setSimStartDate] = useState(() => new Date().toISOString().split("T")[0])
  const [simStartTime, setSimStartTime] = useState("10:00")
  const [simEndDate, setSimEndDate] = useState(() => new Date().toISOString().split("T")[0])
  const [simEndTime, setSimEndTime] = useState("10:00")
  const [simNowDate, setSimNowDate] = useState<string>("")
  const [simNowTime, setSimNowTime] = useState<string>("")
  const [simPlate, setSimPlate] = useState("SIM123")
  const [simPhone, setSimPhone] = useState("07")
  const [simPersons, setSimPersons] = useState("1")
  const [simWriting, setSimWriting] = useState(false)

  const simPreview = useMemo(() => {
    try {
      const row = buildSimulatedExit()
      const enriched = enrichRow(row, "exit")
      const computed = buildDebugComputed(enriched, "exit", null)
      return { row: enriched, computed, error: null as string | null }
    } catch (e: any) {
      return { row: null as any, computed: null as any, error: e?.message ? String(e.message) : String(e) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simType, simStartDate, simStartTime, simEndDate, simEndTime, simNowDate, simNowTime, simPlate, simPhone, simPersons, priceTable])

  // Debug helper: enable by adding `?debugCarry=1` to the URL.
  const debugCarry =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debugCarry") === "1"

  const [debugDialog, setDebugDialog] = useState<{
    open: boolean
    kind: "entry" | "exit"
    row: EnrichedRow | null
    loading: boolean
    docData: any | null
    computed: any | null
    deleting?: boolean
    deleteConfirm?: string
    error?: string
  }>({
    open: false,
    kind: "entry",
    row: null,
    loading: false,
    docData: null,
    computed: null,
    deleting: false,
    deleteConfirm: "",
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
    // Carry-over should keep showing anything that operations still care about:
    // exclude only cancelled/expired/unmatched_lpr. (Some legacy rows can have missing/odd statuses.)
    const s = String(raw?.status || "").toLowerCase()
    if (s === "expired" || s.includes("cancelled")) return false
    if (s === "unmatched_lpr") return false
    return true
  }

  const fetchCarryOverLateEntries = async (date: string): Promise<DailyEntryExit[]> => {
    try {
      const bookingsRef = collection(db, "bookings")
      // IMPORTANT: carry-over entries should include "no-show" bookings that operations still cares about.
      // We include `api_error` too (common for legacy/no-show rows), but still exclude cancels/expired elsewhere.
      // NOTE: we do NOT filter by `lpr.arrivedAt == null` in Firestore because that DOES NOT match missing fields.
      // Many legacy bookings have no `lpr.arrivedAt` field at all, and would not be carried over to the next day.
      // We'll filter (arrivedAt missing/true) client-side instead.
      const q = query(
        bookingsRef,
        where("startDate", ">=", shiftIsoDate(date, -7)),
        where("startDate", "<", date),
        where("status", "in", ["confirmed_paid", "paid", "confirmed", "confirmed_test", "confirmed_pay_on_site", "api_error"]),
        orderBy("startDate", "asc"),
        orderBy("startTime", "asc"),
        limit(500),
      )
      const snap = await getDocs(q)
      if (debugCarry) {
        console.log("[entries-exits][debugCarry] carryEntries(query) fetched", {
          selectedDate: date,
          count: snap.size,
        })
      }
      const rows = snap.docs
        .map((d) => ({ id: d.id, data: d.data() as any }))
        .filter(({ data }) => {
          if (!isCarryOverEligibleStatus(data)) return false
          const lpr = data?.lpr || {}
          const hasArrived = Boolean(lpr?.arrivedAt) || lpr?.isInside === true
          if (hasArrived) return false
          // Avoid flooding with very old no-shows:
          // keep carry-over even if endDate is in the past, but only up to 7 days behind selectedDate.
          const endDate = String(data?.endDate || "")
          const cutoffDate = shiftIsoDate(date, -7)
          if (endDate && endDate < cutoffDate) return false
          // If startTime is missing, still include (sorted last by fallback).
          return true
        })
        .map(({ id, data }) => ({
          id,
          startDate: data.startDate || undefined,
          endDate: data.endDate || undefined,
          time: data.startTime || "N/A",
          startTime: data.startTime || undefined,
          endTime: data.endTime || undefined,
          licensePlate: data.licensePlate || "N/A",
          phone: data.clientPhone || "N/A",
          numberOfPersons: data.numberOfPersons ? data.numberOfPersons : "N/A",
          source: data.source || "webhook",
          bookingStatus: data.status,
          actualTime: undefined,
          delayMinutes: undefined,
          amount: coerceMoney(data.amount),
        }))

      const out: DailyEntryExit[] = rows

      // Extra debug: compare against a broader query without `status in (...)` to see what we are missing.
      if (debugCarry) {
        try {
          // NOTE: do NOT query on `lpr.arrivedAt == null` here because it requires a composite index.
          // We'll fetch candidates by startDate only and filter client-side.
          const qAll = query(
            bookingsRef,
            where("startDate", "<", date),
            orderBy("startDate", "asc"),
            orderBy("startTime", "asc"),
            limit(200),
          )
          const snapAll = await getDocs(qAll)
          const idsWithStatus = new Set(snap.docs.map((d) => d.id))
          const eligible = snapAll.docs
            .map((d) => {
              const b: any = d.data()
              const status = b?.status
              const lpr = b?.lpr || {}
              const hasArrivedAt = Boolean(lpr?.arrivedAt)
              const isCancelledOrExpired =
                String(status || "").toLowerCase() === "expired" || String(status || "").toLowerCase().includes("cancelled")
              const isUnmatched = String(status || "").toLowerCase() === "unmatched_lpr"
              const endDate = String(b?.endDate || "")
              const cutoffDate = shiftIsoDate(date, -7)
              const alreadyEnded = Boolean(endDate && endDate < cutoffDate)
              return {
                id: d.id,
                startDate: b.startDate,
                startTime: b.startTime,
                status,
                source: b.source,
                hasArrivedAt,
                isCancelledOrExpired,
                isUnmatched,
                alreadyEnded,
              }
            })
            .filter((x) => !x.isCancelledOrExpired && !x.isUnmatched && !x.hasArrivedAt && !x.alreadyEnded)

          const missing = eligible
            .filter((x) => !idsWithStatus.has(x.id))
            .slice(0, 25)

          const statusCounts = eligible.reduce((acc: Record<string, number>, x) => {
            const k = x.status === undefined || x.status === null || String(x.status).trim() === "" ? "(missing/empty)" : String(x.status)
            acc[k] = (acc[k] || 0) + 1
            return acc
          }, {})

          console.log("[entries-exits][debugCarry] carryEntries(query-no-status) compare", {
            selectedDate: date,
            countNoStatusRaw: snapAll.size,
            eligibleNoStatus: eligible.length,
            countWithStatus: snap.size,
            eligibleStatusBreakdown: statusCounts,
            missingPreview: missing,
          })
        } catch (e) {
          console.warn("[entries-exits][debugCarry] carryEntries compare failed", e)
        }
      }

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
        where("status", "in", ["confirmed_paid", "paid", "confirmed", "confirmed_test", "confirmed_pay_on_site", "api_error"]),
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
          startTime: b.startTime || undefined,
          endTime: b.endTime || undefined,
          licensePlate: b.licensePlate || "N/A",
          phone: b.clientPhone || "N/A",
          numberOfPersons: b.numberOfPersons ? b.numberOfPersons : "N/A",
          source: b.source || "webhook",
          status: b.status,
          paymentStatus: b.paymentStatus,
          bookingStatus: b.status,
          hasArrived: true,
          actualTime: undefined,
          delayMinutes: undefined,
          amount: coerceMoney(b.amount),
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
      if (debugCarry) {
        console.log("[entries-exits][debugCarry] loadData counts", {
          selectedDate,
          includeFuture,
          dailyEntries: e1.length,
          dailyExits: e2.length,
          carryEntries: carryEntries.length,
          carryExits: carryExits.length,
        })
      }

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

  function enrichRow(row: DailyEntryExit, kind: "entry" | "exit"): EnrichedRow {
    const withDates = row as Partial<EnrichedRow>
    const scheduledDate = kind === "entry" ? withDates.startDate ?? selectedDate : withDates.endDate ?? selectedDate
    const scheduledTime = row.time
    // IMPORTANT: keep LPR comparisons consistent with how LPR times are stored (UTC clock for camera-local time)
    const scheduled = parseDateTimeUTC(scheduledDate, scheduledTime)
    const raw: any = row as any
    const now = raw?.__nowOverride ? new Date(raw.__nowOverride) : new Date()
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
          // We bill by "24h blocks from START time", not "any minutes past scheduled END".
          // That means an extra day is added only after crossing the next 24h boundary counted from startDt.
          // Example: start=18.02 16:00, end=22.02 19:00 => bookedDays=5.
          // If now=22.02 22:00, totalDaysByClock is still 5 (no extra day yet).
          // Only after 23.02 16:00+ do we become 6.
          const effectiveEndDt =
            typeof delay === "number" && endDt
              ? new Date(endDt.getTime() + Math.max(0, delay) * 60 * 1000)
              : overdueMin > 0
                ? now
                : endDt

          const totalDaysByClock = computeTotalDaysByStartClock(startDt, effectiveEndDt)
          const fallbackExtraDays = overdueMin > 0 ? Math.ceil(overdueMin / (60 * 24)) : 0
          const totalDays = Math.max(1, totalDaysByClock !== null ? Math.max(bookedDays, totalDaysByClock) : bookedDays + fallbackExtraDays)
          const extraDays = Math.max(0, totalDays - bookedDays)

          const storedAmount = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : null

          // For pay-on-site and LPR, keep the UI in sync with the booking detail dialog:
          // - If there are NO extra days, show the stored booking.amount (it is the authoritative value shown in "Rezervări").
          // - If there ARE extra days (overdue), compute from the same price source as the dialog:
          //   - pay_on_site: STANDARD (no discount)
          //   - LPR: discounted tier when available (same as Rezervări -> computeBookingRowValue)
          if ((isPayOnSite || isLprUnpaid) && storedAmount !== null && storedAmount > 0 && extraDays === 0) {
            amountDueValue = storedAmount
            amountDueText = `${storedAmount.toFixed(2)} LEI`
          } else {
            const totalPrice = getExactPriceForDays(priceTable, totalDays, { useDiscounted: !isPayOnSite })
            if (totalPrice !== null && totalPrice > 0) {
              amountDueValue = totalPrice
              amountDueText = `${totalPrice.toFixed(2)} LEI`
            } else if ((isPayOnSite || isLprUnpaid) && storedAmount !== null && storedAmount > 0 && totalDays === bookedDays) {
              // Fallback: if price table isn't available, still show stored amount for pay-on-site/LPR-unpaid.
              amountDueValue = storedAmount
              amountDueText = `${storedAmount.toFixed(2)} LEI`
            } else {
              amountDueText = "Calcul conform tarifelor MULTIPARK/WP"
            }
          }
        }

      } else {
        // ONLINE: allowed exit = scheduled END + grace (60 min)
        // This must match what operations expects in the "Ieșiri întârziate" table:
        // charge 30 lei/zi for any time past the scheduled end + 60 min.
        const endDateVal = withDates.endDate
        const endTimeVal = (withDates as any).endTime || raw.endTime || row.time
        const endDtLocal = endDateVal && endTimeVal ? parseDateTime(endDateVal, endTimeVal) : null
        const graceMs = ONLINE_GRACE_MINUTES * 60 * 1000
        const allowedExitMs = endDtLocal ? endDtLocal.getTime() + graceMs : endBase + graceMs
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

  function buildDebugComputed(row: EnrichedRow, kind: "entry" | "exit", rawDoc: any | null) {
    const rawRow: any = row as any
    const now = rawRow?.__nowOverride ? new Date(rawRow.__nowOverride) : new Date()
    const scheduledDate = kind === "entry" ? (row.startDate ?? selectedDate) : (row.endDate ?? selectedDate)
    const scheduledTime = row.time
    const scheduledUtc = parseDateTimeUTC(scheduledDate, scheduledTime)
    const anyRow: any = row as any
    const startDateVal = row.startDate ?? scheduledDate
    const endDateVal = row.endDate ?? scheduledDate
    const startTimeVal = anyRow.startTime ?? (kind === "entry" ? row.time : anyRow.startTime ?? row.time)
    const endTimeVal = anyRow.endTime ?? (kind === "exit" ? row.time : anyRow.endTime ?? row.time)

    const actualUtc = row.actualTime ? parseDateTimeUTC(scheduledDate, row.actualTime) : null
    const delayFromState = row.delayMinutesComputed

    const out: any = {
      kind,
      selectedDate,
      nowIso: now.toISOString(),
      docMeta: {
        createdAtIso:
          rawDoc?.createdAt && typeof rawDoc.createdAt?.toDate === "function"
            ? rawDoc.createdAt.toDate().toISOString()
            : null,
        createdAtLocal:
          rawDoc?.createdAt && typeof rawDoc.createdAt?.toDate === "function"
            ? rawDoc.createdAt
                .toDate()
                .toLocaleString("ro-RO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
            : null,
      },
      scheduled: { scheduledDate, scheduledTime, scheduledUtc: scheduledUtc?.toISOString() ?? null },
      actual: { actualTime: row.actualTime ?? null, actualUtc: actualUtc?.toISOString() ?? null },
      delayMinutesComputed: delayFromState ?? null,
      isLate: Boolean(row.isLate),
      paymentFlags: {
        source: anyRow.source ?? null,
        status: anyRow.bookingStatus ?? anyRow.status ?? null,
        paymentStatus: rawDoc?.paymentStatus ?? anyRow.paymentStatus ?? null,
        isPayOnSite: Boolean(row.isPayOnSite),
        isOnlinePaid: Boolean(row.isOnlinePaid),
      },
    }

    if (kind !== "exit") return out

    // Mirror the page logic, but keep intermediate values.
    const endBase = scheduledUtc?.getTime() ?? null
    const isPayOnSite = Boolean(row.isPayOnSite)
    const isOnlinePaid = Boolean(row.isOnlinePaid)

    const startDt = startDateVal && startTimeVal ? parseDateTime(startDateVal, startTimeVal) : null
    const endDt = endDateVal && endTimeVal ? parseDateTime(endDateVal, endTimeVal) : null

    // bookedDays (same approach as enrichRow)
    let bookedDays = 1
    if (startDt && endDt && endDt.getTime() > startDt.getTime()) {
      bookedDays = Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000)))
    } else if (startDateVal && endDateVal && startDateVal !== endDateVal) {
      const s0 = new Date(`${startDateVal}T00:00:00`)
      const e0 = new Date(`${endDateVal}T00:00:00`)
      const diffMs = e0.getTime() - s0.getTime()
      if (diffMs >= 0) bookedDays = Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)) + 1)
    }

    if (isPayOnSite || !isOnlinePaid) {
      const overdueMin =
        typeof delayFromState === "number"
          ? Math.max(0, delayFromState)
          : endBase
            ? Math.max(0, Math.round((now.getTime() - endBase) / (1000 * 60)))
            : null

      const effectiveEndDt =
        typeof delayFromState === "number" && endDt
          ? new Date(endDt.getTime() + Math.max(0, delayFromState) * 60 * 1000)
          : typeof overdueMin === "number" && overdueMin > 0
            ? now
            : endDt

      const totalDaysByClock = computeTotalDaysByStartClock(startDt, effectiveEndDt)
      const fallbackExtraDays = typeof overdueMin === "number" && overdueMin > 0 ? Math.ceil(overdueMin / (60 * 24)) : 0
      const totalDays = Math.max(1, totalDaysByClock !== null ? Math.max(bookedDays, totalDaysByClock) : bookedDays + fallbackExtraDays)
      const extraDays = Math.max(0, totalDays - bookedDays)
      const totalPrice = getExactPriceForDays(priceTable, totalDays)

      out.exitBilling = {
        mode: "pay_on_site_or_unpaid",
        start: { startDateVal, startTimeVal, startDt: startDt?.toISOString() ?? null },
        end: { endDateVal, endTimeVal, endDt: endDt?.toISOString() ?? null, endBase },
        overdueMin,
        bookedDays,
        totalDaysByClock,
        fallbackExtraDays,
        extraDays,
        totalDays,
        priceFromTable: totalPrice,
        displayed: { amountDueValue: row.amountDueValue ?? null, amountDueText: row.amountDueText ?? null },
      }
      return out
    }

    // ONLINE paid: allowed exit = scheduled END + grace (60 min)
    const graceMs = ONLINE_GRACE_MINUTES * 60 * 1000
    const allowedExitMs = endDt ? endDt.getTime() + graceMs : (endBase ?? 0) + graceMs
    const overMs = now.getTime() - allowedExitMs
    const daysLate = overMs > 0 ? Math.ceil(overMs / (24 * 60 * 60 * 1000)) : 0
    const fee = daysLate > 0 ? daysLate * LATE_FEE_PER_DAY : 0

    out.exitBilling = {
      mode: "online_paid",
      start: { startDateVal, startTimeVal, startDt: startDt?.toISOString() ?? null },
      end: { endDateVal, endTimeVal, endDt: endDt?.toISOString() ?? null, endBase },
      graceMs,
      allowedExitMs,
      overMs,
      daysLate,
      lateFeePerDay: LATE_FEE_PER_DAY,
      fee,
      displayed: { amountDueValue: row.amountDueValue ?? null, amountDueText: row.amountDueText ?? null },
    }
    return out
  }

  const openDebugDialog = async (row: EnrichedRow, kind: "entry" | "exit") => {
    if (!DEBUG_ROW_DETAILS) return
    if (!row?.id) return
    try {
      setDebugDialog({ open: true, kind, row, loading: true, docData: null, computed: null, deleting: false, deleteConfirm: "" })
      const snap = await getDoc(doc(db, "bookings", row.id))
      const docData = snap.exists() ? snap.data() : null
      const computed = buildDebugComputed(row, kind, docData)
      setDebugDialog({ open: true, kind, row, loading: false, docData, computed, deleting: false, deleteConfirm: "" })
    } catch (e: any) {
      setDebugDialog({
        open: true,
        kind,
        row,
        loading: false,
        docData: null,
        computed: null,
        deleting: false,
        deleteConfirm: "",
        error: e?.message ? String(e.message) : String(e),
      })
    }
  }

  function buildSimulatedExit() {
    const id = `sim-exit-${Date.now()}`
    const startDate = simStartDate
    const startTime = simStartTime
    const endDate = simEndDate || simStartDate
    const endTime = simEndTime

    const nowOverride =
      simNowDate && simNowTime
        ? `${simNowDate}T${normalizeHHmm(simNowTime) ?? simNowTime}:00`
        : new Date().toISOString()

    const base: DailyEntryExit = {
      id,
      startDate,
      endDate,
      time: endTime || "N/A",
      licensePlate: simPlate || "SIM",
      phone: simPhone || "N/A",
      numberOfPersons: simPersons || "1",
      source: simType === "pay_on_site" ? "pay_on_site" : "webhook",
      bookingStatus: simType === "pay_on_site" ? "confirmed_pay_on_site" : "confirmed_paid",
      hasArrived: true,
      // IMPORTANT: keep delay undefined so UI computes lateness consistently (timezone compensation included).
      delayMinutes: undefined,
    }

    const anyBase: any = base
    anyBase.status = base.bookingStatus
    anyBase.paymentStatus = simType === "online" ? "paid" : "pending"
    anyBase.__nowOverride = nowOverride
    anyBase.__simulated = true

    return base
  }

  function computeDurationMinutesForBooking(startDate: string, startTime: string, endDate: string, endTime: string) {
    const startDt = parseDateTime(startDate, startTime)
    const endDt = parseDateTime(endDate, endTime)
    if (!startDt || !endDt) return null
    const minutes = Math.round((endDt.getTime() - startDt.getTime()) / (1000 * 60))
    return minutes > 0 ? minutes : null
  }

  function computeMultiparkDurationMinutes(durationMinutes: number) {
    const roundedUpDays = Math.ceil(durationMinutes / (24 * 60))
    return Math.max(1, roundedUpDays) * 24 * 60
  }

  const writeSimulatedExitToFirestore = async () => {
    if (!DEBUG_EXIT_SIM_WRITE) return
    if (!isAdmin) return
    if (!user) return

    const startDt = parseDateTime(simStartDate, simStartTime)
    const endDt = parseDateTime(simEndDate, simEndTime)
    if (!startDt || !endDt || endDt.getTime() <= startDt.getTime()) {
      toast({
        title: "Date invalide",
        description: "Data/ora de ieșire trebuie să fie după data/ora de intrare.",
        variant: "destructive",
      })
      return
    }

    const plateNormalized = normalizeLicensePlate(String(simPlate || "SIM"))

    const endDate = simEndDate || simStartDate
    const durationMinutes = computeDurationMinutesForBooking(simStartDate, simStartTime, endDate, simEndTime)
    if (!durationMinutes) {
      toast({
        title: "Durată invalidă",
        description: "Nu pot calcula durata rezervării (minute).",
        variant: "destructive",
      })
      return
    }

    const days = Math.max(1, Math.ceil(durationMinutes / (24 * 60)))
    const amountFromTable = getExactPriceForDays(priceTable, days)

    // Firestore document with the same shape as CompleteBookingData (createBookingWithFirestore)
    // NOTE: This does NOT call Multipark; it is for testing UI behavior.
    const bookingDoc: any = Object.fromEntries(
      Object.entries({
        // Core
        licensePlate: plateNormalized,
        startDate: simStartDate,
        startTime: normalizeHHmm(simStartTime) ?? simStartTime,
        endDate,
        endTime: normalizeHHmm(simEndTime) ?? simEndTime,
        clientName: "",
        clientTitle: "",
        clientEmail: undefined,
        clientPhone: simPhone || undefined,
        numberOfPersons: parseInt(String(simPersons || "1"), 10) || 1,

        // LPR flags (so the booking is eligible for "Ieșiri" / carry-over late exits)
        // NOTE: wp-card-booking docs typically don't have LPR yet; we add this only for exit-simulation visibility.
        lpr: {
          isInside: true,
          arrivedAt: serverTimestamp(),
        },

        // Calculated
        durationMinutes,
        multiparkDurationMinutes: simType === "pay_on_site" ? undefined : computeMultiparkDurationMinutes(durationMinutes),
        days,
        amount: typeof amountFromTable === "number" ? amountFromTable : undefined,

        // Payment
        paymentIntentId: undefined,
        paymentStatus: simType === "online" ? "paid" : "pending",

        // Terms
        termsAccepted: true,
        termsAcceptedAt: serverTimestamp(),

        // API (not called here)
        apiBookingNumber: undefined,
        apiSuccess: false,
        apiErrorCode: undefined,
        apiMessage: "ADMIN_SIM_TEST (no Multipark call)",
        apiRequestPayload: "ADMIN_SIM_TEST",
        apiResponseRaw: "ADMIN_SIM_TEST",
        apiRequestTimestamp: serverTimestamp(),

        // Status/source
        status: simType === "pay_on_site" ? "confirmed_pay_on_site" : "confirmed_paid",
        source: simType === "pay_on_site" ? "pay_on_site" : "webhook",

        // Metadata
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      }).filter(([_, v]) => v !== undefined),
    )

    try {
      setSimWriting(true)
      const ref = await addDoc(collection(db, "bookings"), bookingDoc)
      toast({
        title: "Salvat în Firestore",
        description: `Creat bookings/${ref.id}. Dă refresh ca să apară din baza de date.`,
      })
      setSimDialogOpen(false)
      await loadData()
    } catch (e: any) {
      toast({
        title: "Eroare la salvare",
        description: e?.message ? String(e.message) : "Nu am putut salva rezervarea în Firestore.",
        variant: "destructive",
      })
    } finally {
      setSimWriting(false)
    }
  }

  const addSimulatedExit = () => {
    const startDt = parseDateTime(simStartDate, simStartTime)
    const endDt = parseDateTime(simEndDate, simEndTime)
    if (!startDt || !endDt || endDt.getTime() <= startDt.getTime()) {
      toast({
        title: "Date invalide",
        description: "Data/ora de ieșire trebuie să fie după data/ora de intrare.",
        variant: "destructive",
      })
      return
    }
    const row = buildSimulatedExit()
    setSimulatedExits((prev) => [row, ...prev])
    setSimDialogOpen(false)
  }

  const closeDebugDialog = () => {
    setDebugDialog({ open: false, kind: "entry", row: null, loading: false, docData: null, computed: null, deleting: false, deleteConfirm: "" })
  }

  const deleteDebugBooking = async () => {
    if (!DEBUG_ROW_DETAILS) return
    if (!isAdmin) return
    const id = debugDialog.row?.id
    if (!id) return

    const docData = debugDialog.docData || {}
    const plate = String(docData?.licensePlate || (debugDialog.row as any)?.licensePlate || "").trim().toUpperCase()
    const confirmRaw = String(debugDialog.deleteConfirm || "").trim().toUpperCase()
    const ok = confirmRaw === id.toUpperCase() || (plate && confirmRaw === plate)
    if (!ok) {
      toast({
        title: "Confirmare invalidă",
        description: `Tastează exact ID-ul rezervării sau numărul (${plate || "N/A"}) ca să permiți ștergerea.`,
        variant: "destructive",
      })
      return
    }

    try {
      setDebugDialog((s) => ({ ...s, deleting: true }))
      await deleteDoc(doc(db, "bookings", id))
      toast({
        title: "Șters",
        description: `Documentul bookings/${id} a fost șters din Firestore.`,
      })
      closeDebugDialog()
      await loadData()
    } catch (e: any) {
      toast({
        title: "Eroare la ștergere",
        description: e?.message ? String(e.message) : "Nu am putut șterge documentul.",
        variant: "destructive",
      })
      setDebugDialog((s) => ({ ...s, deleting: false }))
    }
  }

  const enrichedEntries = useMemo(() => entries.map((e) => enrichRow(e, "entry")), [entries])
  const enrichedExits = useMemo(() => [...exits, ...simulatedExits].map((e) => enrichRow(e, "exit")), [exits, simulatedExits])

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
    const rows = visibleEnrichedExits.filter((e) => {
      const isSimulated = Boolean((e as any).__simulated)
      if (isSimulated) {
        // For simulations, route based on lateness, regardless of endDate.
        return e.hasArrived === true && !e.isLate && !e.actualTime
      }
      return (e.endDate ?? selectedDate) === selectedDate && e.hasArrived === true && !e.isLate && !e.actualTime
    })
    return [...rows].sort(
      (a, b) => getScheduledSortKey(a, "exit", selectedDate) - getScheduledSortKey(b, "exit", selectedDate),
    )
  }, [visibleEnrichedExits, selectedDate])
  // "Intrări întârziate" should list only bookings that are late AND still not arrived (no LPR actualTime yet).
  // Once LPR confirms arrival, it should disappear from this list.
  const lateEntries = useMemo(() => {
    const rows = visibleEnrichedEntries.filter((e) => e.isLate && !e.actualTime)
    return [...rows].sort(
      (a, b) =>
        getScheduledSortKey(a, "entry", selectedDate) - getScheduledSortKey(b, "entry", selectedDate),
    )
  }, [visibleEnrichedEntries, selectedDate])
  // "Ieșiri întârziate" should list only bookings that are late AND still not departed (no LPR actualTime yet).
  // Once LPR confirms departure, it should disappear from this list.
  const lateExits = useMemo(() => {
    const rows = visibleEnrichedExits.filter((e) => e.hasArrived === true && e.isLate && !e.actualTime)
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

  // Debug: dump what we show in the UI (late entries/exits).
  useEffect(() => {
    if (!debugCarry) return
    try {
      const w = window as any
      w.__entriesExitsDebug = {
        selectedDate,
        includeFuture,
        lateEntries,
        lateExits,
      }

      const toRow = (r: EnrichedRow) => ({
        id: r.id,
        startDate: r.startDate,
        endDate: r.endDate,
        timeScheduled: r.time,
        actualTime: (r as any).actualTime,
        delayMinutes: r.delayMinutesComputed,
        isLate: r.isLate,
        licensePlate: r.licensePlate,
        phone: r.phone,
        source: (r as any).source,
        bookingStatus: (r as any).bookingStatus,
        paymentStatus: (r as any).paymentStatus,
        isOnlinePaid: r.isOnlinePaid,
        isPayOnSite: r.isPayOnSite,
      })

      console.log("[entries-exits][debugCarry] lateEntries dump", {
        selectedDate,
        count: lateEntries.length,
        note: "Rows are also available at window.__entriesExitsDebug.lateEntries",
      })
      console.table(lateEntries.map(toRow))

      console.log("[entries-exits][debugCarry] lateExits dump", {
        selectedDate,
        count: lateExits.length,
        note: "Rows are also available at window.__entriesExitsDebug.lateExits",
      })
      console.table(lateExits.map(toRow))
    } catch (e) {
      console.warn("[entries-exits][debugCarry] dump failed", e)
    }
  }, [debugCarry, includeFuture, lateEntries, lateExits, selectedDate])

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
              <tr
                key={row.id}
                className={`border-b border-gray-100 hover:bg-gray-50 ${DEBUG_ROW_DETAILS ? "cursor-pointer" : ""}`}
                onClick={() => {
                  if (DEBUG_ROW_DETAILS) openDebugDialog(row, kind)
                }}
              >
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
          <div
            key={row.id}
            className={`rounded-lg border p-3 shadow-sm ${cardBg} ${DEBUG_ROW_DETAILS ? "cursor-pointer" : ""}`}
            onClick={() => {
              if (DEBUG_ROW_DETAILS) openDebugDialog(row, kind)
            }}
          >
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
        <div className="flex items-center gap-2">
          {DEBUG_EXIT_SIM && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setSimDialogOpen(true)}>
                + Simulează ieșire întârziată
              </Button>
              {simulatedExits.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSimulatedExits([])}>
                  Șterge simulări
                </Button>
              )}
            </>
          )}
          <Button onClick={loadData} disabled={loading} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Se încarcă..." : "Actualizează"}
          </Button>
        </div>
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

      {/* Debug dialog (enabled by NEXT_PUBLIC_ADMIN_ROW_DEBUG=true) */}
      <Dialog
        open={debugDialog.open}
        onOpenChange={(open) => {
          if (!open) closeDebugDialog()
        }}
      >
        <DialogContent className="sm:max-w-[920px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Debug rezervare (click row)</DialogTitle>
            <DialogDescription>
              ID: <span className="font-semibold">{debugDialog.row?.id ?? "-"}</span> · Tip:{" "}
              <span className="font-semibold">{debugDialog.kind}</span>
            </DialogDescription>
          </DialogHeader>

          {debugDialog.loading ? (
            <div className="text-sm text-gray-600">Se încarcă detaliile din Firestore…</div>
          ) : debugDialog.error ? (
            <div className="text-sm text-red-700">Eroare: {debugDialog.error}</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-amber-50 border-amber-200 p-3 text-sm text-amber-900">
                <div className="font-semibold">Notă</div>
                <div>
                  Acest dialog este pentru debugging. Ștergerea elimină doar documentul din `bookings/`.
                  Nu șterge automat date din alte colecții (ex: `lpr_events`, `gateEvents`).
                </div>
              </div>

              <div className="rounded-md border bg-white p-3 text-sm">
                <div className="font-semibold mb-2">Rezumat (textual)</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <div><span className="font-semibold">Creată la:</span>{" "}
                      {debugDialog.docData?.createdAt && typeof debugDialog.docData.createdAt?.toDate === "function"
                        ? debugDialog.docData.createdAt.toDate().toLocaleString("ro-RO", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                        : "N/A"}
                    </div>
                    <div className="text-xs text-gray-600">
                      ISO:{" "}
                      {debugDialog.docData?.createdAt && typeof debugDialog.docData.createdAt?.toDate === "function"
                        ? debugDialog.docData.createdAt.toDate().toISOString()
                        : "N/A"}
                    </div>
                  </div>
                  <div>
                    <div>
                      <span className="font-semibold">Nr. înmatriculare:</span>{" "}
                      {String(debugDialog.docData?.licensePlate || debugDialog.row?.licensePlate || "N/A")}
                    </div>
                    <div>
                      <span className="font-semibold">Status:</span>{" "}
                      {String(debugDialog.docData?.status || (debugDialog.row as any)?.bookingStatus || "N/A")}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="font-semibold">Cum s-a calculat (pe scurt)</div>
                  <div className="text-xs text-gray-700 mt-1 space-y-1">
                    <div>
                      - <span className="font-semibold">Întârziere:</span>{" "}
                      se compară ora programată cu ora LPR (dacă există). Dacă nu există LPR, se compară cu timpul curent.
                      Rezultatul este `delayMinutesComputed`; dacă e &gt; 0 ⇒ `isLate=true`.
                    </div>
                    {debugDialog.kind === "exit" ? (
                      <>
                        <div>
                          - <span className="font-semibold">Dacă e Plată la parcare / neplătit:</span>{" "}
                          total zile = zile rezervate + zile extra (rotunjire în sus la orice întârziere). Prețul se ia din tabela de prețuri pentru totalul de zile.
                        </div>
                        <div>
                          - <span className="font-semibold">Dacă e Online achitat:</span>{" "}
                          se acordă 60 min grație; după aceea se taxează 30 lei/zi (rotunjit în sus).
                        </div>
                      </>
                    ) : (
                      <div>
                        - <span className="font-semibold">Intrări întârziate:</span>{" "}
                        apar dacă sunt întârziate și nu avem încă LPR intrare (se cumulează pe zilele următoare).
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="space-y-2">
                <div className="font-semibold">Calcule (în UI)</div>
                <pre className="text-xs whitespace-pre-wrap break-words rounded-md border bg-gray-50 p-3 max-h-[420px] overflow-auto">
{safeJsonStringify(debugDialog.computed)}
                </pre>
              </div>
              <div className="space-y-2">
                <div className="font-semibold">Document Firestore `bookings/{debugDialog.row?.id ?? ""}`</div>
                <pre className="text-xs whitespace-pre-wrap break-words rounded-md border bg-gray-50 p-3 max-h-[420px] overflow-auto">
{safeJsonStringify(debugDialog.docData)}
                </pre>
              </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {DEBUG_ROW_DETAILS && isAdmin && debugDialog.row?.id && !debugDialog.loading && (
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:justify-between sm:items-center">
                <div className="flex-1">
                  <Input
                    placeholder="Scrie ID-ul sau nr. înmatriculare pentru confirmare ștergere"
                    value={debugDialog.deleteConfirm || ""}
                    onChange={(e) => setDebugDialog((s) => ({ ...s, deleteConfirm: e.target.value }))}
                    disabled={debugDialog.deleting}
                  />
                  <div className="text-[11px] text-gray-600 mt-1">
                    Pentru a șterge: tastează ID-ul sau numărul{" "}
                    <span className="font-semibold">
                      {String(debugDialog.docData?.licensePlate || debugDialog.row?.licensePlate || "")}
                    </span>
                    .
                  </div>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={deleteDebugBooking}
                  disabled={debugDialog.deleting || !String(debugDialog.deleteConfirm || "").trim()}
                >
                  {debugDialog.deleting ? "Se șterge..." : "Șterge din Firestore"}
                </Button>
              </div>
            )}
            <Button type="button" variant="outline" onClick={closeDebugDialog}>
              Închide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Simulator for late exits (client-only) */}
      <Dialog open={simDialogOpen} onOpenChange={setSimDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Simulare ieșire întârziată (front-end only)</DialogTitle>
            <DialogDescription>
              Nu se salvează în Firebase. Apare doar în tabelul „Ieșiri întârziate”.
              {DEBUG_EXIT_SIM_WRITE && isAdmin ? " (Ai și opțiune de salvare test în Firebase.)" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Tip</Label>
                <select
                  className="w-full border rounded px-2 py-1"
                  value={simType}
                  onChange={(e) => setSimType(e.target.value as any)}
                >
                  <option value="pay_on_site">Plată la parcare</option>
                  <option value="online">Online (card)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Nr. înmatriculare</Label>
                <Input value={simPlate} onChange={(e) => setSimPlate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start (data)</Label>
                <Input type="date" value={simStartDate} onChange={(e) => setSimStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Start (ora)</Label>
                <Input type="time" value={simStartTime} onChange={(e) => setSimStartTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>End (data)</Label>
                <Input type="date" value={simEndDate} onChange={(e) => setSimEndDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>End (ora)</Label>
                <Input type="time" value={simEndTime} onChange={(e) => setSimEndTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Simulează „acum” (data)</Label>
                <Input type="date" value={simNowDate} onChange={(e) => setSimNowDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Simulează „acum” (ora)</Label>
                <Input type="time" value={simNowTime} onChange={(e) => setSimNowTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Telefon</Label>
                <Input value={simPhone} onChange={(e) => setSimPhone(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Nr persoane</Label>
                <Input value={simPersons} onChange={(e) => setSimPersons(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="rounded-md border bg-slate-50 border-slate-200 p-3 text-sm">
            <div className="font-semibold mb-1">Explicație calcul (preview)</div>
            {simPreview?.error ? (
              <div className="text-xs text-red-700">Nu se poate calcula preview: {simPreview.error}</div>
            ) : !simPreview?.computed?.exitBilling ? (
              <div className="text-xs text-gray-600">Preview indisponibil (date insuficiente).</div>
            ) : (
              <div className="text-xs text-slate-700 space-y-1">
                {simPreview.computed.exitBilling.mode === "pay_on_site_or_unpaid" ? (
                  <>
                    <div>
                      Tip: <span className="font-semibold">Plată la parcare / neplătit</span>
                    </div>
                    <div>
                      Zile rezervate: <span className="font-semibold">{simPreview.computed.exitBilling.bookedDays}</span>
                    </div>
                    <div>
                      Întârziere: <span className="font-semibold">{simPreview.computed.exitBilling.overdueMin ?? 0} min</span>
                    </div>
                    <div>
                      Zile extra: <span className="font-semibold">{simPreview.computed.exitBilling.extraDays}</span>
                    </div>
                    <div>
                      Total zile: <span className="font-semibold">{simPreview.computed.exitBilling.totalDays}</span>
                    </div>
                    <div>
                      Tarif din tabel:{" "}
                      <span className="font-semibold">
                        {simPreview.computed.exitBilling.priceFromTable
                          ? `${Number(simPreview.computed.exitBilling.priceFromTable).toFixed(2)} LEI`
                          : "N/A"}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      Tip: <span className="font-semibold">Online achitat</span>
                    </div>
                    <div>
                      Zile rezervate: <span className="font-semibold">{simPreview.computed.exitBilling.days}</span>
                    </div>
                    <div>
                      Grație: <span className="font-semibold">60 min</span>
                    </div>
                    <div>
                      Zile întârziere: <span className="font-semibold">{simPreview.computed.exitBilling.daysLate}</span>
                    </div>
                    <div>
                      Penalizare:{" "}
                      <span className="font-semibold">
                        {Number(simPreview.computed.exitBilling.fee || 0).toFixed(2)} LEI
                      </span>
                    </div>
                  </>
                )}
                <div className="pt-1">
                  Valoarea afișată în tabel:{" "}
                  <span className="font-semibold">
                    {simPreview.row.amountDueValue
                      ? `${Number(simPreview.row.amountDueValue).toFixed(2)} LEI`
                      : simPreview.row.amountDueText || "-"}
                  </span>
                </div>
              </div>
            )}
          </div>
       
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSimDialogOpen(false)}>
              Renunță
            </Button>
            {DEBUG_EXIT_SIM_WRITE && isAdmin && user && (
              <Button
                type="button"
                variant="secondary"
                onClick={writeSimulatedExitToFirestore}
                disabled={simWriting}
              >
                {simWriting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Se salvează...
                  </>
                ) : (
                  "Salvează în Firebase (test)"
                )}
              </Button>
            )}
            <Button type="button" onClick={addSimulatedExit}>
              Adaugă simulare
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

