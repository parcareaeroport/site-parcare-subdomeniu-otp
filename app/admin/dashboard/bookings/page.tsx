"use client"

import { AlertDescription } from "@/components/ui/alert"

import { AlertTitle } from "@/components/ui/alert"

import { Alert } from "@/components/ui/alert"

import { useState, useEffect, Suspense, useCallback } from "react"
import {
  collection,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  query,
  orderBy,
  type Timestamp, // Import Timestamp
  increment,
  serverTimestamp,
  setDoc,
  onSnapshot,
  where,
  limit,
} from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { DateRange } from "react-day-picker"
import { format as formatDateFn, parseISO, subDays, startOfDay, endOfDay, differenceInCalendarDays } from "date-fns" // Renamed to avoid conflict
import { ro } from "date-fns/locale"
import { CalendarIcon, MoreHorizontal, Search, Eye, Loader2, AlertCircle, RefreshCw, Mail, Info, Trash2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/components/ui/use-toast"
import { useAuth } from "@/context/auth-context"
import { cancelBooking as cancelParkingApiBooking, cleanupExpiredBookings, createManualBooking, sendManualBookingEmail } from "@/app/actions/booking-actions" // Acțiunea server pentru API parcare
import { recoverSpecificBooking } from "@/app/actions/booking-recovery" // Recovery pentru rezervări eșuate
import { TimePickerDemo } from "@/components/time-picker"
import { checkExistingReservationByLicensePlate } from "@/lib/booking-utils"
import { normalizeLicensePlate } from "@/lib/utils"
import { Clock, XCircle } from "lucide-react"
import { OccupancyCounter } from "@/components/admin/occupancy-counter"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface Booking {
  id: string // Firestore document ID
  licensePlate: string
  clientName?: string
  clientEmail?: string
  clientPhone?: string
  clientTitle?: string
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  endDate: string // YYYY-MM-DD
  endTime: string // HH:mm
  
  // Date calculate
  durationMinutes: number
  multiparkDurationMinutes?: number // Minutele rotunjite trimise la Multipark API
  days?: number
  amount?: number
  numberOfPersons?: number
  
  // Date pentru facturare (persoană juridică)
  company?: string
  companyVAT?: string // CUI/CIF
  companyReg?: string // Număr Registrul Comerțului
  companyAddress?: string
  needInvoice?: boolean
  orderNotes?: string
  
  // Date adresă personală
  address?: string
  city?: string
  county?: string
  postalCode?: string
  
  // Status și plată
  status: "confirmed_test" | "confirmed_paid" | "cancelled_by_admin" | "cancelled_by_api" | "api_error" | "expired" | string
  paymentStatus?: "paid" | "pending" | "refunded" | "n/a"
  manualPaymentStatus?: "not_paid" | "partial" | "paid" | "refunded" // Pentru rezervările manuale
  paymentIntentId?: string
  
  // Termeni și condiții
  termsAccepted?: boolean
  termsAcceptedAt?: Timestamp
  
  // Date API externe
  apiBookingNumber?: string // Numărul de la API-ul de parcare
  apiSuccess?: boolean
  apiErrorCode?: string
  apiMessage?: string
  apiRequestPayload?: string
  apiResponseRaw?: string
  apiRequestTimestamp?: Timestamp
  
  // Metadata sistem
  source?: "webhook" | "test_mode" | "manual" | "pay_on_site" | "lpr"
  createdAt: Timestamp // Firestore Timestamp
  lastUpdated?: Timestamp
  expiredAt?: Timestamp // Când a fost marcată ca expirată
  
  // Status email
  emailStatus?: "sent" | "failed"
  emailSentAt?: Timestamp
  lastManualEmailSent?: Timestamp
  manualEmailCount?: number
  lastEmailError?: string
  payOnSiteStatus?: "pending" | "paid" | "cancelled" // Adaugă status special pentru pay-on-site
}

type PriceEntry = {
  days: number
  standardPrice: number
  discountedPrice?: number
}

function parseDateTime(date?: string, time?: string) {
  if (!date || !time) return null
  const t = time.length === 5 ? `${time}:00` : time
  const asIso = `${date}T${t}`
  const d = new Date(asIso)
  return Number.isNaN(d.getTime()) ? null : d
}

function BookingsPageContent() {
  const { toast } = useToast()
  const { user, loading: authLoading, isAdmin } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [filteredBookings, setFilteredBookings] = useState<Booking[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [dateRange, setDateRange] = useState<DateRange>({ from: new Date(), to: new Date() })
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isRecovering, setIsRecovering] = useState(false)
  const [isCleaningUp, setIsCleaningUp] = useState(false)
  const [isSendingEmail, setIsSendingEmail] = useState(false)
  const [sendingEmailBookingId, setSendingEmailBookingId] = useState<string | null>(null)
  const [markingExitId, setMarkingExitId] = useState<string | null>(null)
  const [recalculatingOcc, setRecalculatingOcc] = useState(false)
  const [priceTable, setPriceTable] = useState<PriceEntry[]>([])
  const [pricesLoading, setPricesLoading] = useState(false)
  const [showCalcExplanation, setShowCalcExplanation] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [bookingToDelete, setBookingToDelete] = useState<Booking | null>(null)

  const formatInputDate = (d?: Date) => (d ? formatDateFn(d, "yyyy-MM-dd") : "")
  const handleDateInputChange = (key: "from" | "to") => (value: string) => {
    const parsed = value ? new Date(`${value}T00:00:00`) : undefined
    setDateRange((prev) => ({ ...prev, [key]: parsed }))
  }
  
  // State pentru actualizarea statusului de plată manual
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false)
  const [updatingPaymentBookingId, setUpdatingPaymentBookingId] = useState<string | null>(null)
  
  // State pentru anularea rezervărilor pay-on-site
  const [isCancellingPayOnSite, setIsCancellingPayOnSite] = useState(false)
  const [cancellingPayOnSiteBookingId, setCancellingPayOnSiteBookingId] = useState<string | null>(null)
  
  // State pentru adăugarea manuală de rezervări
  const [isManualDialogOpen, setIsManualDialogOpen] = useState(false)
  const [isCreatingManual, setIsCreatingManual] = useState(false)
  const [manualLicensePlate, setManualLicensePlate] = useState("")
  const [manualStartDate, setManualStartDate] = useState<Date | undefined>(new Date())
  const [manualStartTime, setManualStartTime] = useState("08:30")
  const [manualEndDate, setManualEndDate] = useState<Date | undefined>(new Date())
  const [manualEndTime, setManualEndTime] = useState("18:30")
  const [manualClientName, setManualClientName] = useState("")
  const [manualClientPhone, setManualClientPhone] = useState("")
  const [manualClientEmail, setManualClientEmail] = useState("")
  const [manualNumberOfPersons, setManualNumberOfPersons] = useState("1")
  const [manualDuplicateError, setManualDuplicateError] = useState<string | null>(null)
  
  // State pentru logul vizual al răspunsului API multipark
  const [apiLogData, setApiLogData] = useState<{
    isVisible: boolean
    request?: {
      url: string
      payload: string
      timestamp: string
    }
    response?: {
      status: number
      body: string
      success: boolean
      errorCode?: string
      message?: string
      timestamp: string
    }
  }>({ isVisible: false })

  // State pentru dialogul de email după rezervare manuală
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false)
  const [newBookingForEmail, setNewBookingForEmail] = useState<{
    bookingId: string
    apiBookingNumber: string
    clientEmail: string
    clientName: string
    licensePlate: string
  } | null>(null)

  // State pentru dialogul de recovery success
  const [isRecoverySuccessDialogOpen, setIsRecoverySuccessDialogOpen] = useState(false)
  const [recoverySuccessData, setRecoverySuccessData] = useState<{
    bookingNumber: string
    licensePlate: string
    clientName: string
    apiMessage: string
    originalErrorCode?: string
    originalError?: string
  } | null>(null)

  // State pentru completarea rezervărilor unmatched_lpr din LPR
  const [isLprCompleteDialogOpen, setIsLprCompleteDialogOpen] = useState(false)
  const [lprBookingToComplete, setLprBookingToComplete] = useState<Booking | null>(null)
  const [lprExitDate, setLprExitDate] = useState<Date | undefined>(new Date())
  const [lprExitTime, setLprExitTime] = useState("12:00")
  const [lprClientName, setLprClientName] = useState("")
  const [lprClientPhone, setLprClientPhone] = useState("")
  const [lprPersons, setLprPersons] = useState("1")

  // Paginare pentru tabelul de rezervări
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Prag anulare „Plată la Parcare” (minute) – din config/reservationSettings
  const [payOnSiteCancelMinutes, setPayOnSiteCancelMinutes] = useState<number>(180)

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "config", "reservationSettings"),
      (snap) => {
        const v = Number((snap.data() as any)?.payOnSiteAutoCancelMinutes ?? 180)
        setPayOnSiteCancelMinutes(Number.isFinite(v) && v > 0 ? v : 180)
      },
      (err) => console.error("Error listening to reservationSettings (payOnSiteAutoCancelMinutes)", err),
    )
    return () => unsub()
  }, [])

  // Helper pentru formatarea întârzierilor (X ore Y minute / doar minute)
  const formatDelay = (minutes: number) => {
    const abs = Math.abs(minutes)
    if (abs < 60) return `${abs} min`
    const h = Math.floor(abs / 60)
    const m = abs % 60
    if (m === 0) return `${h} h`
    return `${h} h ${m} min`
  }

  // Helper pentru afișarea orelor LPR.
  // Camera trimite ora locală, dar serverul (UTC) o salvează ca și cum ar fi UTC,
  // deci în UI afișăm în timezone UTC ca să vedem exact ora raportată de cameră.
  const formatLprDateTime = (value: any) => {
    if (!value) return "-"
    const d =
      typeof value?.toDate === "function"
        ? value.toDate()
        : typeof value === "string" || typeof value === "number"
          ? new Date(value)
          : new Date(String(value))
    if (Number.isNaN(d.getTime())) return "-"
    return d.toLocaleString("ro-RO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    })
  }

  const formatDateKey = (d: Date) => formatDateFn(d, "yyyy-MM-dd")
  const isoDayRange = (d: Date) => {
    const start = startOfDay(d).toISOString()
    const end = endOfDay(d).toISOString()
    return { start, end }
  }

  const loadPrices = useCallback(async () => {
    setPricesLoading(true)
    try {
      const q = query(collection(db, "prices"), orderBy("days"))
      const snap = await getDocs(q)
      const items: PriceEntry[] = snap.docs
        .map((d) => {
          const data: any = d.data()
          return {
            days: Number(data.days || 0),
            standardPrice: Number(data.standardPrice || 0),
            discountedPrice: data.discountedPrice ? Number(data.discountedPrice) : undefined,
          }
        })
        .filter((p) => p.days > 0 && p.standardPrice > 0)
      setPriceTable(items)
    } catch (e) {
      console.error("Error loading prices in bookings page", e)
      setPriceTable([])
    } finally {
      setPricesLoading(false)
    }
  }, [])

  const fetchBookings = useCallback(
    async (range?: DateRange) => {
      setIsLoading(true)
      try {
        const today = new Date()
        const defaultFrom = today
        const fromDate = range?.from ?? dateRange.from ?? defaultFrom
        const toDate = range?.to ?? dateRange.to ?? today
        const fromKey = formatDateKey(fromDate)
        const toKey = formatDateKey(toDate)

        const bookingsCollectionRef = collection(db, "bookings")

        // Query 1: după startDate în interval
        const qStart = query(
          bookingsCollectionRef,
          where("startDate", ">=", fromKey),
          where("startDate", "<=", toKey),
          orderBy("startDate", "desc"),
          limit(500),
        )

        // Query 2: după endDate în interval
        const qEnd = query(
          bookingsCollectionRef,
          where("endDate", ">=", fromKey),
          where("endDate", "<=", toKey),
          orderBy("endDate", "desc"),
          limit(500),
        )
        const now = new Date()
        const nowTs = now.getTime()

        // Combinăm doc-urile din toate sursele (startDate + endDate + LPR arrived + LPR departed)
        const [dataStart, dataEnd] = await Promise.all([getDocs(qStart), getDocs(qEnd)])
        const combinedDocsMap = new Map<string, any>()
        const pushDocSnap = (docSnap: any) => {
          if (!docSnap) return
          combinedDocsMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })
        }
        dataStart.docs.forEach(pushDocSnap)
        dataEnd.docs.forEach(pushDocSnap)

        const combined = Array.from(combinedDocsMap.values())

        const fetchedBookings: Booking[] = await Promise.all(
          combined.map(async (raw: any) => {
            // Completează start/end din LPR dacă lipsesc
            const lpr: any = raw.lpr || {}
            const normalizeDateKey = (val: any) => {
              if (!val) return undefined
              const d = typeof val?.toDate === "function" ? val.toDate() : new Date(val)
              return isNaN(d.getTime()) ? undefined : formatDateFn(d, "yyyy-MM-dd")
            }
            const arrivedKey = normalizeDateKey(lpr.arrivedAt)
            const departedKey = normalizeDateKey(lpr.departedAt)
            if (!raw.startDate && arrivedKey) raw.startDate = arrivedKey
            if (!raw.endDate && departedKey) raw.endDate = departedKey
            if (!raw.startDate && raw.endDate) raw.startDate = raw.endDate
            if (!raw.endDate && raw.startDate) raw.endDate = raw.startDate

            // Calculează și marchează depășirea pragului pentru pay_on_site (minute după START, dacă nu a intrat prin LPR)
            try {
              const isPayOnSite = raw.source === "pay_on_site" || raw.status === "confirmed_pay_on_site"
              const isInside = raw?.lpr?.isInside === true
              if (isPayOnSite && !isInside && raw.startDate && raw.startTime && !raw.payOnSiteOverdueLocked) {
                const plannedStart = new Date(`${raw.startDate}T${raw.startTime}:00`)
                const diffMinutes = Math.floor((nowTs - plannedStart.getTime()) / (1000 * 60))
                const overdueMoreThanThreshold = diffMinutes > payOnSiteCancelMinutes
                raw.payOnSiteOverdueMinutes = diffMinutes
                // Keep legacy field name for UI/back-compat, but it now means "over threshold"
                raw.payOnSiteOverdueMoreThan3h = overdueMoreThanThreshold

                // Persistăm în Firestore doar dacă este clar întârziată
                if (overdueMoreThanThreshold) {
                  try {
                    await updateDoc(doc(db, "bookings", raw.id), {
                      payOnSiteOverdueMinutes: diffMinutes,
                      payOnSiteOverdueMoreThan3h: true,
                      lastUpdated: serverTimestamp(),
                    })
                  } catch (e) {
                    console.error("Error updating pay_on_site overdue flag:", e)
                  }
                }
              }
            } catch (e) {
              console.error("Error computing overdue for pay_on_site booking:", e)
            }

            return raw as Booking
          }),
        )
        // Sortează după startDate (desc) apoi createdAt (desc)
        const sorted = [...fetchedBookings].sort((a, b) => {
          const aStart = a.startDate || ""
          const bStart = b.startDate || ""
          if (aStart !== bStart) return bStart.localeCompare(aStart)
          const aCreated = (a.createdAt as any)?.toMillis?.() ?? 0
          const bCreated = (b.createdAt as any)?.toMillis?.() ?? 0
          return bCreated - aCreated
        })
        setBookings(sorted)
        setFilteredBookings(sorted) // Inițial, afișează toate; filtrarea pe UI după interval
      } catch (error) {
        console.error("Error fetching bookings:", error)
        toast({ title: "Eroare", description: "Nu s-au putut încărca rezervările.", variant: "destructive" })
      } finally {
        setIsLoading(false)
      }
    },
    [dateRange.from, dateRange.to, toast, payOnSiteCancelMinutes],
  )

  useEffect(() => {
    if (!authLoading && user) {
      fetchBookings(dateRange)
      loadPrices()
    } else if (!authLoading && !user) {
      setIsLoading(false)
    }
  }, [user, authLoading, fetchBookings, loadPrices, dateRange])

  useEffect(() => {
    let filtered = bookings
    if (searchTerm) {
      filtered = filtered.filter(
        (b) =>
          b.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (b.licensePlate && b.licensePlate.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (b.clientName && b.clientName.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (b.clientEmail && b.clientEmail.toLowerCase().includes(searchTerm.toLowerCase())) ||
          (b.apiBookingNumber && b.apiBookingNumber.toLowerCase().includes(searchTerm.toLowerCase())),
      )
    }
    if (statusFilter !== "all") {
      if (statusFilter === "manual") {
        // Filtrare specială pentru rezervările manuale
        filtered = filtered.filter((b) => b.source === "manual")
      } else if (statusFilter === "pay_on_site") {
        // Filtrare specială pentru rezervările cu plată la parcare
        filtered = filtered.filter((b) => b.source === "pay_on_site")
      } else {
        filtered = filtered.filter((b) => b.status === statusFilter)
      }
    }
    if (dateRange.from || dateRange.to) {
      const from = dateRange.from
      const to = dateRange.to
      filtered = filtered.filter((b) => overlapsRange(b.startDate, b.endDate, from, to))
    }
    setFilteredBookings(filtered)
    // Resetăm pagina curentă când se schimbă filtrarea
    setCurrentPage(1)
  }, [bookings, searchTerm, statusFilter, dateRange])

  // Statistici rapide pentru bara de sus (în funcție de data selectată)
  const overlapsRange = (start?: string, end?: string, from?: Date, to?: Date) => {
    // Inclusiv pe zile întregi (start-of-day / end-of-day) ca să evităm probleme de fus orar
    if (!start) return false
    if (!from && !to) return true
    try {
      const bookingStart = startOfDay(parseISO(start))
      const bookingEnd = endOfDay(end ? parseISO(end) : parseISO(start))
      const rangeStart = from ? startOfDay(from) : bookingStart
      const rangeEnd = to ? endOfDay(to) : bookingEnd
      return bookingStart <= rangeEnd && bookingEnd >= rangeStart
    } catch {
      return false
    }
  }

  const computeDurationDays = (b: Booking): number => {
    const startDate = (b.startDate || "").trim()
    const endDate = (b.endDate || "").trim() || startDate
    const startTime = (b.startTime || "").trim()
    const endTime = (b.endTime || "").trim()

    // Prefer exact start/end time
    const startDt = startDate && startTime ? parseDateTime(startDate, startTime) : null
    const endDt = endDate && endTime ? parseDateTime(endDate, endTime) : null
    if (startDt && endDt && endDt.getTime() > startDt.getTime()) {
      return Math.max(1, Math.ceil((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000)))
    }

    // Fallback: days calendaristice inclusive
    try {
      const s = parseISO(startDate)
      const e = parseISO(endDate)
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
        return Math.max(1, differenceInCalendarDays(e, s) + 1)
      }
    } catch {}

    return 1
  }

  const computePriceForDays = (days: number): number => {
    if (!days || days <= 0) return 0
    if (priceTable.length === 0) return 0
    const sorted = [...priceTable].sort((a, b) => a.days - b.days)
    const match = sorted.find((p) => p.days >= days) || sorted[sorted.length - 1]
    if (!match) return 0
    const perDay = (match.discountedPrice ?? match.standardPrice) / match.days
    return perDay * days
  }

  const computePerDayFromPrices = (days: number): number => {
    if (!days || days <= 0) return 0
    if (priceTable.length === 0) return 0
    const sorted = [...priceTable].sort((a, b) => a.days - b.days)
    const match = sorted.find((p) => p.days >= days) || sorted[sorted.length - 1]
    if (!match) return 0
    return (match.discountedPrice ?? match.standardPrice) / match.days
  }

  const computeOverlapDays = (b: Booking, from?: Date, to?: Date): number => {
    if (!b.startDate) return 0
    try {
      const bookingStart = startOfDay(parseISO(b.startDate))
      const bookingEnd = endOfDay(parseISO(b.endDate || b.startDate))
      const rangeStart = from ? startOfDay(from) : bookingStart
      const rangeEnd = to ? endOfDay(to) : bookingEnd

      const startMs = Math.max(bookingStart.getTime(), rangeStart.getTime())
      const endMs = Math.min(bookingEnd.getTime(), rangeEnd.getTime())
      if (startMs > endMs) return 0
      return Math.max(1, differenceInCalendarDays(new Date(endMs), new Date(startMs)) + 1)
    } catch {
      return 0
    }
  }

  const computeBookingProRataValue = (b: Booking, from?: Date, to?: Date): number => {
    const totalDays = computeDurationDays(b)
    const overlapDays = computeOverlapDays(b, from, to)
    if (totalDays <= 0 || overlapDays <= 0) return 0

    // Prefer pricing table => per-day from prices
    const perDayFromPrices = computePerDayFromPrices(totalDays)
    if (perDayFromPrices > 0) return perDayFromPrices * overlapDays

    // Fallback => use stored amount prorated over totalDays
    const amount = Number(b.amount || 0) || 0
    if (amount > 0) return (amount / totalDays) * overlapDays

    return 0
  }

  // IMPORTANT: keep cards in sync with the table filters (tab + search + date range).
  // filteredBookings is exactly what the table uses (before pagination).
  const statsBookings = filteredBookings

  const totalCount = statsBookings.length

  const isLostBooking = (b: Booking) => {
    const s = String(b.status || "").toLowerCase()
    return s === "expired" || s.includes("cancelled") || s.includes("anulat") || s.includes("api_error_cancel")
  }

  const isPayOnSiteBooking = (b: Booking) =>
    b.source === "pay_on_site" || String(b.status || "") === "confirmed_pay_on_site"

  const isOnlineBooking = (b: Booking) => {
    // Match the table "ONLINE" badge meaning: non-manual, non-pay_on_site, non-LPR-without-reservation
    if (b.source === "manual") return false
    if (isPayOnSiteBooking(b)) return false
    if (isLprWithoutReservation(b)) return false
    return true
  }

  const isOnlinePaidBooking = (b: Booking) => {
    if (isPayOnSiteBooking(b)) return false
    return b.paymentStatus === "paid" || String(b.status || "") === "confirmed_paid"
  }

  const isManualPaidBooking = (b: Booking) => {
    if (b.source !== "manual") return false
    const m = String(b.manualPaymentStatus || "")
    return m === "paid" || b.paymentStatus === "paid"
  }

  const isLprWithoutReservation = (b: Booking) => b.status === "unmatched_lpr" || b.source === "lpr"

  // Pro-rata (pe zile) + split
  const onlineTotalCount = statsBookings.filter((b) => !isLostBooking(b) && isOnlineBooking(b)).length
  const onlineReceivedCount = statsBookings.filter((b) => !isLostBooking(b) && isOnlinePaidBooking(b)).length
  const onlineReceivedValue = statsBookings
    .filter((b) => !isLostBooking(b) && isOnlinePaidBooking(b))
    .reduce((s, b) => s + computeBookingProRataValue(b, dateRange.from, dateRange.to), 0)
  const onlineUnpaidCount = Math.max(0, onlineTotalCount - onlineReceivedCount)

  const payOnSiteEstimatedCount = statsBookings.filter((b) => !isLostBooking(b) && isPayOnSiteBooking(b)).length
  const payOnSiteEstimatedValue = statsBookings
    .filter((b) => !isLostBooking(b) && isPayOnSiteBooking(b))
    .reduce((s, b) => s + computeBookingProRataValue(b, dateRange.from, dateRange.to), 0)

  const manualPaidCount = statsBookings.filter((b) => !isLostBooking(b) && isManualPaidBooking(b)).length
  const manualPaidValue = statsBookings
    .filter((b) => !isLostBooking(b) && isManualPaidBooking(b))
    .reduce((s, b) => s + computeBookingProRataValue(b, dateRange.from, dateRange.to), 0)

  const lprNoReservationCount = statsBookings.filter((b) => isLprWithoutReservation(b)).length

  const totalProRataValue = onlineReceivedValue + payOnSiteEstimatedValue + manualPaidValue

  const handleViewBooking = (booking: Booking) => {
    setSelectedBooking(booking)
    setIsViewDialogOpen(true)
  }

  const handleCancelBooking = async (booking: Booking) => {
    if (!booking.apiBookingNumber) {
      toast({
        title: "Eroare",
        description: "Această rezervare nu are un număr de la API-ul de parcare și nu poate fi anulată automat.",
        variant: "destructive",
      })
      return
    }
    setIsCancelling(true)
    try {
      const result = await cancelParkingApiBooking(booking.apiBookingNumber)
      if (result.success) {
        const bookingDocRef = doc(db, "bookings", booking.id)
        await updateDoc(bookingDocRef, {
          status: "cancelled_by_admin", // Sau un status mai specific
          apiMessage: result.message, // Salvează mesajul de la API
        })
        // OPTIMIZARE: Decrementez contorul de rezervări active
        const statsDocRef = doc(db, "config", "reservationStats")
        await updateDoc(statsDocRef, { activeBookingsCount: increment(-1) })
        toast({
          title: "Rezervare Anulată",
          description: `Rezervarea ${booking.apiBookingNumber} a fost anulată cu succes la API și actualizată local.`,
        })
        fetchBookings() // Reîncarcă lista
        if (isViewDialogOpen) setIsViewDialogOpen(false)
      } else {
        toast({
          title: "Eroare Anulare API",
          description: result.message || "Nu s-a putut anula rezervarea la API-ul de parcare.",
          variant: "destructive",
        })
        // Opțional: actualizează statusul local pentru a reflecta eroarea API
        const bookingDocRef = doc(db, "bookings", booking.id)
        await updateDoc(bookingDocRef, { status: "api_error_cancel", apiMessage: result.message })
        fetchBookings()
      }
    } catch (error) {
      console.error("Error cancelling booking:", error)
      toast({
        title: "Eroare Sistem",
        description: "A apărut o eroare la procesul de anulare.",
        variant: "destructive",
      })
    } finally {
      setIsCancelling(false)
    }
  }

  const handleMarkOutside = async (booking: Booking) => {
    setMarkingExitId(booking.id)
    try {
      const bookingRef = doc(db, "bookings", booking.id)
      const snap = await getDoc(bookingRef)
      if (!snap.exists()) throw new Error("Booking not found")

      const data: any = snap.data()
      const wasInside = data?.lpr?.isInside === true
      const occupancyIncrementedFlag = data?.occupancyIncremented === true
      const occupancyDecrementedFlag = data?.occupancyDecremented === true
      const shouldDecrement = wasInside && occupancyIncrementedFlag && !occupancyDecrementedFlag

      await updateDoc(bookingRef, {
        "lpr.isInside": false,
        "lpr.departedAt": serverTimestamp(),
        "lpr.lastEventType": "exit",
        ...(shouldDecrement
          ? {
              occupancyDecremented: true,
              occupancyDecrementedAt: serverTimestamp(),
            }
          : {}),
        lastUpdated: serverTimestamp(),
      })

      // Manual -1 la contor (idempotent, doar dacă era inside și nu a fost deja decremented)
      if (shouldDecrement) {
        const occupancyDocRef = doc(db, "config", "parkingLive")
        await setDoc(occupancyDocRef, { lastUpdated: serverTimestamp() }, { merge: true })
        await updateDoc(occupancyDocRef, {
          occupiedCount: increment(-1),
          lastUpdated: serverTimestamp(),
          lastChange: {
            type: "exit_manual",
            bookingId: booking.id,
            plateNumber: data?.licensePlate || booking.licensePlate || "N/A",
            at: new Date().toISOString(),
          },
        })
      }
      toast({
        title: "Marcat ca ieșit",
        description: shouldDecrement
          ? `Booking ${booking.id} setat cu isInside=false și contorul a fost decrementat (-1).`
          : `Booking ${booking.id} setat cu isInside=false (contorul nu a fost modificat — deja decrementat / never incremented).`,
      })
      fetchBookings()
    } catch (e) {
      console.error("Mark outside failed", e)
      toast({
        title: "Eroare",
        description: "Nu am putut marca ieșirea.",
        variant: "destructive",
      })
    } finally {
      setMarkingExitId(null)
    }
  }

  const handleRecalculateOccupancy = async () => {
    setRecalculatingOcc(true)
    try {
      const res = await fetch("/api/admin/occupancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recalculate" }),
      })
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const json = await res.json().catch(() => null)
      toast({
        title: "Contor recalculat",
        description: `occupiedCount a fost setat la ${json?.occupiedCount ?? "valoarea corectă"} (din lpr.isInside=true).`,
      })
    } catch (e) {
      console.error("Recalculate occupancy failed", e)
      toast({
        title: "Eroare",
        description: "Nu am putut recalcula contorul.",
        variant: "destructive",
      })
    } finally {
      setRecalculatingOcc(false)
    }
  }

  const handleDeleteBooking = async () => {
    if (!bookingToDelete) return
    setIsDeleting(true)
    try {
      const res = await fetch("/api/admin/bookings/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: bookingToDelete.id }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      toast({
        title: "Rezervare ștearsă",
        description: json?.decremented
          ? "Rezervarea a fost ștearsă și contorul de ocupare a fost ajustat (-1)."
          : "Rezervarea a fost ștearsă.",
      })
      fetchBookings()
      if (isViewDialogOpen && selectedBooking?.id === bookingToDelete.id) {
        setIsViewDialogOpen(false)
      }
      setIsDeleteDialogOpen(false)
      setBookingToDelete(null)
    } catch (e) {
      console.error("Delete booking failed", e)
      toast({
        title: "Eroare",
        description: "Nu am putut șterge rezervarea.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCancelPayOnSiteBooking = async (booking: Booking) => {
    if (booking.source !== "pay_on_site") {
      toast({
        title: "Eroare",
        description: "Această funcție este doar pentru rezervările cu plată la parcare.",
        variant: "destructive",
      })
      return
    }
    
    setIsCancellingPayOnSite(true)
    setCancellingPayOnSiteBookingId(booking.id)
    
    try {
      // Anularea se face doar în Firebase, nu prin API Multipark
      const bookingDocRef = doc(db, "bookings", booking.id)
      await updateDoc(bookingDocRef, {
        status: "cancelled_by_admin",
        payOnSiteStatus: "cancelled", // Adaugă status special pentru pay-on-site
        cancelledAt: serverTimestamp(),
        cancelledBy: "admin",
        apiMessage: "Rezervare anulată de administrator (doar în sistemul local)",
      })
      
      // Decrementez contorul de rezervări active
      const statsDocRef = doc(db, "config", "reservationStats")
      await updateDoc(statsDocRef, { activeBookingsCount: increment(-1) })
      
      toast({
        title: "Rezervare Anulată",
        description: `Rezervarea cu numărul ${booking.licensePlate} a fost anulată cu succes în sistemul local.`,
      })
      
      fetchBookings() // Reîncarcă lista
      if (isViewDialogOpen) setIsViewDialogOpen(false)
      
    } catch (error) {
      console.error("Error cancelling pay-on-site booking:", error)
      toast({
        title: "Eroare Sistem",
        description: "A apărut o eroare la procesul de anulare.",
        variant: "destructive",
      })
    } finally {
      setIsCancellingPayOnSite(false)
      setCancellingPayOnSiteBookingId(null)
    }
  }

  const handleRecoverBooking = async (booking: Booking) => {
    if (booking.status !== "api_error" || booking.paymentStatus !== "paid") {
      toast({
        title: "Rezervarea nu poate fi recuperată",
        description: "Doar rezervările cu plata procesată și API eșuat pot fi recuperate.",
        variant: "destructive",
      })
      return
    }

    setIsRecovering(true)
    try {
      console.log(`🔄 Starting recovery for booking ${booking.id} (${booking.licensePlate})`)
      console.log(`🔄 Original error: ${booking.apiMessage}`)
      console.log(`🔄 Original error code: ${booking.apiErrorCode}`)
      
      const result = await recoverSpecificBooking(booking.id)
      
      if (result.success) {
        console.log(`✅ Recovery successful! New booking number: ${result.bookingNumber}`)
        
        // Pregătește datele pentru dialogul de success
        setRecoverySuccessData({
          bookingNumber: result.bookingNumber!,
          licensePlate: booking.licensePlate,
          clientName: booking.clientName || 'Client',
          apiMessage: "Rezervarea a fost creată cu succes în API multipark!",
          originalErrorCode: booking.apiErrorCode,
          originalError: booking.apiMessage
        })
        
        // Afișează dialogul de success
        setIsRecoverySuccessDialogOpen(true)
        
        // Reîncarcă lista
        fetchBookings()
        if (isViewDialogOpen) setIsViewDialogOpen(false)
        
      } else {
        console.error(`❌ Recovery failed: ${result.message}`)
        
        toast({
          title: "Recovery Eșuat",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Error recovering booking:", error)
      toast({
        title: "Eroare Recovery",
        description: "A apărut o eroare la procesul de recovery.",
        variant: "destructive",
      })
    } finally {
      setIsRecovering(false)
    }
  }

  const handleCleanupExpired = async () => {
    setIsCleaningUp(true)
    try {
      // Folosește funcția soft cleanup care e mai eficientă
      const { softCleanupExpiredBookings } = await import('@/lib/booking-utils')
      const expiredCount = await softCleanupExpiredBookings()
      
      if (expiredCount > 0) {
        toast({
          title: "Cleanup Finalizat",
          description: `Au fost marcate ${expiredCount} rezervări ca expirate și excluse din categoria activă.`,
        })
      } else {
        toast({
          title: "Cleanup Complet", 
          description: "Nu au fost găsite rezervări expirate de curățat.",
        })
      }
      
      // Reîncarcă lista
      fetchBookings()
      
    } catch (error) {
      console.error('Error during cleanup:', error)
      toast({
        title: "Eroare Cleanup",
        description: "A apărut o eroare la curățarea rezervărilor expirate.",
        variant: "destructive",
      })
    } finally {
      setIsCleaningUp(false)
    }
  }

  const handleCreateManualBooking = async (e: React.FormEvent) => {
    e.preventDefault()
    const uiProcessId = `UI_MANUAL_${Date.now()}`
    
    console.log(`🖥️ [${uiProcessId}] ===== MANUAL BOOKING UI PROCESS STARTED =====`)
    console.log(`🖥️ [${uiProcessId}] Timestamp: ${new Date().toISOString()}`)
    
    if (!user) {
      console.error(`❌ [${uiProcessId}] User not authenticated`)
      console.error(`❌ [${uiProcessId}] User object:`, user)
      
      toast({
        title: "Acces Neautorizat",
        description: "Trebuie să fiți autentificat pentru a adăuga rezervări.",
        variant: "destructive",
      })
      return
    }

    console.log(`✅ [${uiProcessId}] User authenticated:`)
    console.log(`✅ [${uiProcessId}]   User ID: ${user.uid}`)
    console.log(`✅ [${uiProcessId}]   User Email: ${user.email}`)
    console.log(`✅ [${uiProcessId}]   Is Admin: ${isAdmin}`)

    setIsCreatingManual(true)

    // VERIFICARE SUPRAPUNERE PERIOADA pentru același număr de înmatriculare
    try {
      console.log(`🔍 [${uiProcessId}] ===== CHECKING PERIOD OVERLAP =====`)
      console.log(`🔍 [${uiProcessId}] Form data to validate:`)
      console.log(`🔍 [${uiProcessId}]   License Plate: ${manualLicensePlate.toUpperCase()}`)
      console.log(`🔍 [${uiProcessId}]   Start Date: ${manualStartDate ? formatDateFn(manualStartDate, "yyyy-MM-dd") : 'NOT SET'}`)
      console.log(`🔍 [${uiProcessId}]   Start Time: ${manualStartTime}`)
      console.log(`🔍 [${uiProcessId}]   End Date: ${manualEndDate ? formatDateFn(manualEndDate, "yyyy-MM-dd") : 'NOT SET'}`)
      console.log(`🔍 [${uiProcessId}]   End Time: ${manualEndTime}`)
      console.log(`🔍 [${uiProcessId}]   Client Name: ${manualClientName || 'N/A'}`)
      console.log(`🔍 [${uiProcessId}]   Client Email: ${manualClientEmail || 'N/A'}`)
      console.log(`🔍 [${uiProcessId}]   Client Phone: ${manualClientPhone || 'N/A'}`)
      console.log(`🔍 [${uiProcessId}]   Number of Persons: ${manualNumberOfPersons}`)

      const overlapCheckStartTime = Date.now()

      const duplicateCheck = await checkExistingReservationByLicensePlate(
        manualLicensePlate,
        manualStartDate ? formatDateFn(manualStartDate, "yyyy-MM-dd") : '',
        manualEndDate ? formatDateFn(manualEndDate, "yyyy-MM-dd") : '',
        manualStartTime,
        manualEndTime
      )
      
      const overlapCheckDuration = Date.now() - overlapCheckStartTime
      console.log(`🔍 [${uiProcessId}] Overlap check completed in ${overlapCheckDuration}ms`)
      console.log(`🔍 [${uiProcessId}] Overlap result: ${duplicateCheck.exists ? 'CONFLICT FOUND' : 'NO CONFLICT'}`)
      
      if (duplicateCheck.exists && duplicateCheck.existingBooking) {
        const existing = duplicateCheck.existingBooking
        const existingPeriod = `${formatDateFn(new Date(existing.startDate), "d MMM yyyy", { locale: ro })} - ${formatDateFn(new Date(existing.endDate), "d MMM yyyy", { locale: ro })}`
        const newPeriod = `${manualStartDate ? formatDateFn(manualStartDate, "d MMM yyyy", { locale: ro }) : ''} - ${manualEndDate ? formatDateFn(manualEndDate, "d MMM yyyy", { locale: ro }) : ''}`
        
        console.log(`⚠️ [${uiProcessId}] ===== PERIOD OVERLAP DETECTED =====`)
        console.log(`⚠️ [${uiProcessId}] Existing booking details:`)
        console.log(`⚠️ [${uiProcessId}]   ID: ${existing.id}`)
        console.log(`⚠️ [${uiProcessId}]   Period: ${existing.startDate} ${existing.startTime} - ${existing.endDate} ${existing.endTime}`)
        console.log(`⚠️ [${uiProcessId}]   Status: ${existing.status}`)
        console.log(`⚠️ [${uiProcessId}]   Booking Number: ${existing.apiBookingNumber || 'N/A'}`)
        console.log(`⚠️ [${uiProcessId}] New booking period: ${manualStartDate ? formatDateFn(manualStartDate, "yyyy-MM-dd") : ''} ${manualStartTime} - ${manualEndDate ? formatDateFn(manualEndDate, "yyyy-MM-dd") : ''} ${manualEndTime}`)

        // Setează mesajul de eroare persistent pe formular
        const errorMessage = `Perioada ${newPeriod} se suprapune cu rezervarea existentă pentru ${manualLicensePlate.toUpperCase()} din ${existingPeriod}${existing.apiBookingNumber ? ` (Rezervare #${existing.apiBookingNumber})` : ''}`
        setManualDuplicateError(errorMessage)

        console.log(`🚨 [${uiProcessId}] Blocking manual booking due to overlap`)
        console.log(`🚨 [${uiProcessId}] Error message: ${errorMessage}`)

        toast({
          title: "Perioadă Suprapusă",
          description: "Perioada selectată se suprapune cu o rezervare existentă pentru acest număr de înmatriculare.",
          variant: "destructive",
          duration: 5000,
        })
        
        setIsCreatingManual(false)
        return
      } else {
        console.log(`✅ [${uiProcessId}] No period overlap found - can proceed`)
        // Golește mesajul de eroare dacă nu există suprapunere
        setManualDuplicateError(null)
      }
      
    } catch (error) {
      console.error(`❌ [${uiProcessId}] ===== OVERLAP CHECK ERROR =====`)
      console.error(`❌ [${uiProcessId}] Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`)
      console.error(`❌ [${uiProcessId}] Error Message: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`❌ [${uiProcessId}] Error Stack:`, error instanceof Error ? error.stack : 'N/A')
      
      // În caz de eroare, afișăm un warning dar permitem continuarea
      toast({
        title: "Avertisment",
        description: "Nu s-a putut verifica dacă există suprapuneri cu rezervări existente. Dacă aveți deja o rezervare în această perioadă, vă rugăm să nu continuați.",
        duration: 5000,
      })
    }

    try {
      console.log(`🏗️ [${uiProcessId}] ===== PREPARING FORM DATA =====`)
      
      const formData = new FormData()
      formData.append('licensePlate', manualLicensePlate)
      formData.append('startDate', manualStartDate ? formatDateFn(manualStartDate, "yyyy-MM-dd") : '')
      formData.append('startTime', manualStartTime)
      formData.append('endDate', manualEndDate ? formatDateFn(manualEndDate, "yyyy-MM-dd") : '')
      formData.append('endTime', manualEndTime)
      formData.append('clientName', manualClientName)
      formData.append('clientPhone', manualClientPhone)
      formData.append('clientEmail', manualClientEmail)
      formData.append('numberOfPersons', manualNumberOfPersons)

      console.log(`🏗️ [${uiProcessId}] FormData prepared with all fields`)
      console.log(`🏗️ [${uiProcessId}] Calling createManualBooking server action...`)
      
      // Afișează logul de început API
      setApiLogData({
        isVisible: true,
        request: undefined,
        response: undefined
      })
      
      const createStartTime = Date.now()
      const result = await createManualBooking(formData)
      const createDuration = Date.now() - createStartTime

      console.log(`🏗️ [${uiProcessId}] Server action completed in ${createDuration}ms`)
      console.log(`🏗️ [${uiProcessId}] Result success: ${result.success}`)
      console.log(`🏗️ [${uiProcessId}] Result message: ${result.message}`)

      // Actualizează logul cu detaliile API dacă sunt disponibile
      if ((result as any).apiDetails) {
        console.log(`📊 [${uiProcessId}] API Details available, updating visual log`)
        setApiLogData({
          isVisible: true,
          request: (result as any).apiDetails.request,
          response: (result as any).apiDetails.response
        })
      }

      if (result.success) {
        console.log(`✅ [${uiProcessId}] ===== MANUAL BOOKING CREATED SUCCESSFULLY =====`)
        console.log(`✅ [${uiProcessId}] Booking ID: ${(result as any).bookingId || 'N/A'}`)
        console.log(`✅ [${uiProcessId}] API Booking Number: ${(result as any).apiBookingNumber || 'N/A'}`)
        console.log(`✅ [${uiProcessId}] Success message: ${result.message}`)

        toast({
          title: "Rezervare Adăugată",
          description: result.message,
        })

        console.log(`🧹 [${uiProcessId}] Resetting form fields...`)

        // Închide dialogul manual
        setApiLogData({ isVisible: false })
        setIsManualDialogOpen(false)

        // Verifică dacă se poate trimite email
        const hasEmail = manualClientEmail && manualClientEmail.trim() !== ''
        const hasApiBookingNumber = (result as any).apiBookingNumber

        if (hasEmail && hasApiBookingNumber) {
          console.log(`📧 [${uiProcessId}] Email available, showing email dialog...`)
          
          // Pregătește datele pentru dialogul de email
          setNewBookingForEmail({
            bookingId: (result as any).bookingId,
            apiBookingNumber: (result as any).apiBookingNumber,
            clientEmail: manualClientEmail,
            clientName: manualClientName || 'Client',
            licensePlate: manualLicensePlate
          })
          
          // Afișează dialogul de email
          setIsEmailDialogOpen(true)
        } else {
          console.log(`📧 [${uiProcessId}] Email not available: hasEmail=${hasEmail}, hasApiBookingNumber=${hasApiBookingNumber}`)
        }

        // Resetează formularul
        setManualLicensePlate("")
        setManualStartDate(new Date())
        setManualStartTime("08:30")
        setManualEndDate(new Date())
        setManualEndTime("18:30")
        setManualClientName("")
        setManualClientPhone("")
        setManualClientEmail("")
        setManualNumberOfPersons("1")
        setManualDuplicateError(null)

        console.log(`🔄 [${uiProcessId}] Refreshing bookings list...`)

        // Reîncarcă lista
        await fetchBookings()
        
        console.log(`🎉 [${uiProcessId}] Manual booking process completed successfully`)
        console.log(`🎉 [${uiProcessId}] Total UI duration: ${Date.now() - (Date.now() - createDuration)}ms`)
      } else {
        console.error(`❌ [${uiProcessId}] ===== MANUAL BOOKING FAILED =====`)
        console.error(`❌ [${uiProcessId}] Error message: ${result.message}`)
        console.error(`❌ [${uiProcessId}] Server duration: ${createDuration}ms`)

        toast({
          title: "Eroare",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error(`❌ [${uiProcessId}] ===== UI CRITICAL ERROR =====`)
      console.error(`❌ [${uiProcessId}] Error Type: ${error instanceof Error ? error.constructor.name : typeof error}`)
      console.error(`❌ [${uiProcessId}] Error Message: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`❌ [${uiProcessId}] Error Stack:`, error instanceof Error ? error.stack : 'N/A')
      console.error(`❌ [${uiProcessId}] Form state:`, {
        licensePlate: manualLicensePlate,
        startDate: manualStartDate ? formatDateFn(manualStartDate, "yyyy-MM-dd") : null,
        startTime: manualStartTime,
        endDate: manualEndDate ? formatDateFn(manualEndDate, "yyyy-MM-dd") : null,
        endTime: manualEndTime,
        clientName: manualClientName,
        clientEmail: manualClientEmail
      })
      
      toast({
        title: "Eroare",
        description: "A apărut o eroare la crearea rezervării.",
        variant: "destructive",
      })
    } finally {
      console.log(`🏁 [${uiProcessId}] UI process ended, resetting loading state`)
      setIsCreatingManual(false)
    }
  }

  const handleSendEmailFromNewBooking = async () => {
    if (!newBookingForEmail) return

    setIsSendingEmail(true)
    setSendingEmailBookingId(newBookingForEmail.bookingId)
    
    try {
      console.log(`📧 Sending email for new manual booking: ${newBookingForEmail.bookingId}`)
      
      const result = await sendManualBookingEmail(newBookingForEmail.bookingId)
      
      if (result.success) {
        toast({
          title: "Email trimis",
          description: `Email-ul a fost trimis cu succes către ${newBookingForEmail.clientEmail}`,
          variant: "default",
        })
        
        console.log(`✅ Email sent successfully to ${newBookingForEmail.clientEmail}`)
      } else {
        toast({
          title: "Eroare la trimiterea email-ului",
          description: result.message,
          variant: "destructive",
        })
        
        console.error(`❌ Email failed: ${result.message}`)
      }
    } catch (error) {
      console.error("Send email error:", error)
      toast({ 
        title: "Eroare", 
        description: "Eroare la trimiterea email-ului. Încercați din nou.", 
        variant: "destructive" 
      })
    } finally {
      setIsSendingEmail(false)
      setSendingEmailBookingId(null)
      setIsEmailDialogOpen(false)
      setNewBookingForEmail(null)
      
      // Refresh lista pentru a vedea statusul email-ului actualizat
      await fetchBookings()
    }
  }

  const handleSendEmail = async (booking: Booking) => {
    if (!booking.clientEmail) {
      toast({
        title: "Eroare",
        description: "Această rezervare nu are email-ul clientului.",
        variant: "destructive",
      })
      return
    }

    if (!booking.apiBookingNumber) {
      toast({
        title: "Eroare", 
        description: "Această rezervare nu are număr de la API-ul de parcare și nu se poate genera QR code.",
        variant: "destructive",
      })
      return
    }

    setIsSendingEmail(true)
    setSendingEmailBookingId(booking.id)
    
    try {
      const result = await sendManualBookingEmail(booking.id)
      
      if (result.success) {
        toast({
          title: "Email trimis",
          description: result.message,
          variant: "default",
        })
        // Refresh lista pentru a vedea statusul email-ului actualizat
        await fetchBookings()
      } else {
        toast({
          title: "Eroare la trimiterea email-ului",
          description: result.message,
          variant: "destructive",
        })
      }
    } catch (error) {
      console.error("Send email error:", error)
      toast({ 
        title: "Eroare", 
        description: "Eroare la trimiterea email-ului. Încercați din nou.", 
        variant: "destructive" 
      })
    } finally {
      setIsSendingEmail(false)
      setSendingEmailBookingId(null)
    }
  }

  const handleUpdateManualPaymentStatus = async (booking: Booking, newStatus: string) => {
    setIsUpdatingPayment(true)
    setUpdatingPaymentBookingId(booking.id)
    
    try {
      const bookingRef = doc(db, 'bookings', booking.id)
      await updateDoc(bookingRef, {
        manualPaymentStatus: newStatus,
        lastUpdated: serverTimestamp()
      })
      
      const statusLabels = {
        'not_paid': 'Nu este plătită',
        'partial': 'Parțial plătită', 
        'paid': 'Plătită',
        'refunded': 'Rambursată'
      }
      
      toast({
        title: "Status actualizat",
        description: `Statusul plății a fost schimbat în "${statusLabels[newStatus as keyof typeof statusLabels]}"`,
        variant: "default",
      })
      
      // Refresh lista pentru a vedea statusul actualizat
      await fetchBookings()
    } catch (error) {
      console.error("Update payment status error:", error)
      toast({ 
        title: "Eroare", 
        description: "Eroare la actualizarea statusului plății. Încercați din nou.", 
        variant: "destructive" 
      })
    } finally {
      setIsUpdatingPayment(false)
      setUpdatingPaymentBookingId(null)
    }
  }

  const handleUpdatePayOnSiteStatus = async (booking: Booking, newStatus: string) => {
    setIsUpdatingPayment(true)
    setUpdatingPaymentBookingId(booking.id)
    
    try {
      const bookingRef = doc(db, 'bookings', booking.id)
      await updateDoc(bookingRef, {
        paymentStatus: newStatus,
        lastUpdated: serverTimestamp()
      })
      
      const statusLabels = {
        'pending': 'În așteptare',
        'paid': 'Plătit la parcare'
      }
      
      toast({
        title: "Status actualizat",
        description: `Statusul plății a fost schimbat în "${statusLabels[newStatus as keyof typeof statusLabels]}"`,
        variant: "default",
      })
      
      // Refresh lista pentru a vedea statusul actualizat
      await fetchBookings()
    } catch (error) {
      console.error("Update payment status error:", error)
      toast({ 
        title: "Eroare", 
        description: "Eroare la actualizarea statusului plății. Încercați din nou.", 
        variant: "destructive" 
      })
    } finally {
      setIsUpdatingPayment(false)
      setUpdatingPaymentBookingId(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "confirmed_paid":
        return <Badge className="bg-green-100 text-green-800">Confirmat</Badge>
      case "confirmed_test":
        return <Badge className="bg-blue-100 text-blue-800">Confirmat (Test)</Badge>
      case "confirmed_pay_on_site":
        return <Badge className="bg-orange-100 text-orange-800">Plată la parcare</Badge>
      case "cancelled_by_admin":
        return <Badge className="bg-red-100 text-red-800">Anulat (Admin)</Badge>
      case "cancelled_by_api":
        return <Badge className="bg-red-100 text-red-800">Anulat (API)</Badge>
      case "api_error":
        return <Badge className="bg-orange-100 text-orange-800">Eroare API</Badge>
      case "expired":
        return <Badge className="bg-gray-100 text-gray-800">Expirat</Badge>
      default:
        return <Badge className="bg-gray-100 text-gray-800">{status}</Badge>
    }
  }

  const getPaymentStatusBadge = (status?: string) => {
    // Doar două opțiuni vizibile în tabel: Achitat (verde) / Neplatit (roșu)
    const isPaid = status === "paid"
    return (
      <Badge className={isPaid ? "bg-green-500 text-white" : "bg-red-500 text-white"}>
        {isPaid ? "Achitat" : "Neplatit"}
      </Badge>
    )
  }

  const getManualPaymentStatusBadge = (booking: Booking) => {
    const status = booking.manualPaymentStatus || "not_paid"
    const isPaid = status === "paid"
    return (
      <Badge className={isPaid ? "bg-green-500 text-white" : "bg-red-500 text-white"}>
        {isPaid ? "Achitat" : "Neplatit"}
      </Badge>
    )
  }

  const getPayOnSiteStatusBadge = (booking: Booking) => {
    // Verifică dacă rezervarea a fost anulată
    if (booking.payOnSiteStatus === "cancelled" || booking.status === "cancelled_by_admin") {
      return <Badge className="bg-red-500 text-white">Neplatit</Badge>
    }
    const isPaid = booking.paymentStatus === "paid"
    return (
      <Badge className={isPaid ? "bg-green-500 text-white" : "bg-red-500 text-white"}>
        {isPaid ? "Achitat" : "Neplatit"}
      </Badge>
    )
  }

  const renderPaymentStatusCell = (booking: Booking) => {
    // Pentru rezervările manuale, afișăm dropdown-ul editabil
    if (booking.source === "manual") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-auto p-1 hover:bg-transparent"
              disabled={isUpdatingPayment && updatingPaymentBookingId === booking.id}
            >
              {isUpdatingPayment && updatingPaymentBookingId === booking.id ? (
                <div className="flex items-center">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  <span className="text-xs">Actualizare...</span>
                </div>
              ) : (
                getManualPaymentStatusBadge(booking)
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem 
              onClick={() => handleUpdateManualPaymentStatus(booking, "not_paid")}
              disabled={isUpdatingPayment}
            >
              <Badge className="bg-red-500 text-white mr-2 w-28 justify-center">Neplatit</Badge>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleUpdateManualPaymentStatus(booking, "paid")}
              disabled={isUpdatingPayment}
            >
              <Badge className="bg-green-500 text-white mr-2 w-28 justify-center">Achitat</Badge>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    
    // Pentru rezervările cu plată la parcare, afișăm dropdown-ul editabil
    if (booking.source === "pay_on_site") {
      // Dacă rezervarea este anulată, afișăm doar badge-ul fără dropdown
      if (booking.payOnSiteStatus === "cancelled" || booking.status === "cancelled_by_admin") {
        return getPayOnSiteStatusBadge(booking)
      }
      
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-auto p-1 hover:bg-transparent"
              disabled={isUpdatingPayment && updatingPaymentBookingId === booking.id}
            >
              {isUpdatingPayment && updatingPaymentBookingId === booking.id ? (
                <div className="flex items-center">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  <span className="text-xs">Actualizare...</span>
                </div>
              ) : (
                getPayOnSiteStatusBadge(booking)
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem 
              onClick={() => handleUpdatePayOnSiteStatus(booking, "pending")}
              disabled={isUpdatingPayment}
            >
              <Badge className="bg-red-500 text-white mr-2 w-24 justify-center">Neplatit</Badge>
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => handleUpdatePayOnSiteStatus(booking, "paid")}
              disabled={isUpdatingPayment}
            >
              <Badge className="bg-green-500 text-white mr-2 w-24 justify-center">Achitat</Badge>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
    
    // Pentru rezervările normale (webhook/test), afișăm badge-ul simplu.
    // IMPORTANT: keep consistent with header stats: confirmed_paid/paid implies Achitat even if paymentStatus is missing.
    const s = String(booking.status || "")
    const isPaid = booking.paymentStatus === "paid" || s === "confirmed_paid" || s === "paid"
    return getPaymentStatusBadge(isPaid ? "paid" : "not_paid")
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" /> <p className="ml-2">Se încarcă rezervările...</p>
      </div>
    )
  }
  if (!user) {
    return (
      <div className="text-center p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Acces Neautorizat</AlertTitle>
          <AlertDescription>
            Trebuie să fiți autentificat ca administrator pentru a accesa această pagină.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Gestionare Rezervări</h1>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={formatInputDate(dateRange.from)}
                  onChange={(e) => handleDateInputChange("from")(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">→</span>
                <Input
                  type="date"
                  value={formatInputDate(dateRange.to)}
                  onChange={(e) => handleDateInputChange("to")(e.target.value)}
                  className="w-full sm:w-44"
                />
              </div>
            </div>
            {(searchTerm || statusFilter !== "all" || dateRange.from || dateRange.to) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearchTerm("")
                  setStatusFilter("all")
                  setDateRange({ from: new Date(), to: new Date() })
                }}
                className="hover:text-white"
              >
                Resetează
              </Button>
            )}
            <div className="text-xs text-blue-700 font-mono">
              Interval:{" "}
              {dateRange.from
                ? dateRange.to
                  ? `${formatDateFn(dateRange.from, "dd.MM.yyyy")} - ${formatDateFn(dateRange.to, "dd.MM.yyyy")}`
                  : formatDateFn(dateRange.from, "dd.MM.yyyy")
                : "neselectat"}
            </div>
          </div>
     
        </div>
        <div className="flex gap-2">
          {user && (
            <Button 
              onClick={() => setIsManualDialogOpen(true)}
              variant="default"
              size="sm"
            >
              + Adaugă Manual
            </Button>
          )}
        
          <Button onClick={() => fetchBookings(dateRange)} disabled={isLoading} size="sm">
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Reîncarcă
          </Button>
        </div>
      </div>

      {/* Bara de statistici rapide */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              Total
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                      aria-label="Explicație calcul total"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm">
                    <div className="text-xs leading-relaxed">
                      <div className="font-semibold mb-1">Valoare totală =</div>
                      <div>
                        Online încasat ({onlineReceivedCount}) + Pay-on-site estimat ({payOnSiteEstimatedCount}) + Manual achitat ({manualPaidCount})
                      </div>
                      <div className="mt-1">
                        {onlineReceivedValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} +{" "}
                        {payOnSiteEstimatedValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} +{" "}
                        {manualPaidValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ={" "}
                        {totalProRataValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LEI
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        LPR fără rezervare nu intră în valoare (doar număr).
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </CardTitle>
            <CardDescription className="text-xs">Total rezervări în interval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount}</div>
            <p className="text-xs text-muted-foreground">
              Valoare totală:{" "}
              <span className="font-semibold">
                {totalProRataValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LEI
              </span>
              {pricesLoading && (
                <span className="ml-2 text-[10px] text-gray-500">(se calculează tarifele…)</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Online</CardTitle>
            <CardDescription className="text-xs">Total online + încasat (card)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{onlineReceivedCount}</div>
            <p className="text-xs text-muted-foreground">
              Încasat:{" "}
              <span className="font-semibold text-green-700">
                {onlineReceivedValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LEI
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Total online în tabel: <span className="font-semibold">{onlineTotalCount}</span>
              {onlineUnpaidCount > 0 && (
                <>
                  {" "}• Neplătite: <span className="font-semibold text-red-700">{onlineUnpaidCount}</span>
                </>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pay-on-site estimat</CardTitle>
            <CardDescription className="text-xs">De încasat la parcare</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-700">{payOnSiteEstimatedCount}</div>
            <p className="text-xs text-muted-foreground">
              Valoare totală:{" "}
              <span className="font-semibold text-orange-700">
                {payOnSiteEstimatedValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LEI
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Manual achitat</CardTitle>
            <CardDescription className="text-xs">Doar rezervări manuale achitate</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">{manualPaidCount}</div>
            <p className="text-xs text-muted-foreground">
              Valoare totală:{" "}
              <span className="font-semibold text-blue-700">
                {manualPaidValue.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} LEI
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">LPR fără rezervare</CardTitle>
            <CardDescription className="text-xs">Doar număr</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-700">{lprNoReservationCount}</div>
            <p className="text-xs text-muted-foreground">
              Valoare totală: <span className="font-semibold">—</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowCalcExplanation((v) => !v)}
        >
          {showCalcExplanation ? "Ascunde explicație calcule" : "Vezi explicație calcule"}
        </Button>
      </div>

      {showCalcExplanation && (
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="py-4 text-sm text-slate-700">
            Pentru intervalul selectat, sistemul ia toate rezervările care se suprapun cu perioada aleasă și calculează
            valoarea doar pentru zilele care cad în acel interval. Tariful pe zi este luat automat din pagina Prețuri.
            Apoi sumele sunt separate în: Online încasat (deja plătit), Pay-on-site estimat (de încasat la parcare) și
            Manual achitat. LPR fără rezervare este afișat separat ca număr.
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList>
          <TabsTrigger value="all" onClick={() => setStatusFilter("all")}>
            Toate
          </TabsTrigger>
       
          <TabsTrigger value="manual" onClick={() => setStatusFilter("manual")}>
                            <span className="text-orange-700">Manual</span>
          </TabsTrigger>
          <TabsTrigger value="pay_on_site" onClick={() => setStatusFilter("pay_on_site")}>
            <span className="text-orange-700">Plată la parcare</span>
          </TabsTrigger>
          <TabsTrigger value="cancelled_by_admin" onClick={() => setStatusFilter("cancelled_by_admin")}>
            Anulate
          </TabsTrigger>
      
          <TabsTrigger value="unmatched_lpr" onClick={() => setStatusFilter("unmatched_lpr")}>
            <span className="text-purple-700">Fără rezervare (LPR)</span>
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative w-full sm:w-auto flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
            <Input
              type="search"
              placeholder="Caută ID, Nr. Înmat., Client, API Nr..."
              className="pl-8"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                value={formatInputDate(dateRange.from)}
                onChange={(e) => handleDateInputChange("from")(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={formatInputDate(dateRange.to)}
                onChange={(e) => handleDateInputChange("to")(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            {(searchTerm || statusFilter !== "all" || dateRange.from || dateRange.to) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearchTerm("")
                  setStatusFilter("all")
                  setDateRange({ from: new Date(), to: new Date() })
                }}
                className="hover:text-white"
              >
                Resetează
              </Button>
            )}
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Lista Rezervărilor</CardTitle>
              <CardDescription>Vizualizează și gestionează rezervările.</CardDescription>
            </div>
            <div className="w-full sm:w-auto">
              <OccupancyCounter
                title="Ocupare"
                mode="active"
                range={{ from: dateRange.from, to: dateRange.to }}
                // IMPORTANT: keep in sync with table, but exclude bookings already exited per LPR.
                // If LPR says it exited (departedAt), it's NOT present.
                // If LPR says it's inside (isInside=true), it IS present.
                // If there is no LPR exit info yet (e.g. "-/-" in table), we consider it present for the selected interval.
                countOverride={filteredBookings.filter((b) => {
                  const lpr: any = (b as any)?.lpr || {}
                  if (lpr?.isInside === true) return true
                  if (lpr?.departedAt) return false
                  if (lpr?.arrivedAt && !lpr?.departedAt) return true
                  return true
                }).length}
                inline
                className="w-full sm:w-auto"
              />
            </div>
          </CardHeader>
          <CardContent>
            {/* Info paginare (deasupra tabelului) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-3 text-xs text-gray-600">
              <div>
                <span>
                  Afișezi{" "}
                  {filteredBookings.length === 0
                    ? 0
                    : (currentPage - 1) * pageSize + 1}{" "}
                  -{" "}
                  {Math.min(currentPage * pageSize, filteredBookings.length)}{" "}
                  din {filteredBookings.length} rezervări
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span>Pe pagină:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const newSize = Number(e.target.value) || 25
                    setPageSize(newSize)
                    setCurrentPage(1)
                  }}
                  className="border rounded px-2 py-1 text-xs bg-white"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nr. API</TableHead>
                  <TableHead>Nr. Înmatriculare</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Perioada</TableHead>
                  <TableHead className="w-64">LPR Intrare / Ieșire</TableHead>
                  <TableHead>Plată</TableHead>
                  <TableHead>T&C</TableHead>
                  <TableHead>Creată la</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                      Nu s-au găsit rezervări.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBookings
                    .slice(
                      (currentPage - 1) * pageSize,
                      (currentPage - 1) * pageSize + pageSize,
                    )
                    .map((booking) => (
                    <TableRow
                      key={booking.id}
                      className={
                        booking.source === "manual"
                          ? "bg-orange-50 hover:bg-orange-100 border-l-4 border-l-orange-400"
                          : booking.source === "pay_on_site"
                          ? "bg-orange-100 hover:bg-orange-200 border-l-4 border-l-orange-500"
                          : ""
                      }
                    >
                      {/* helper pentru afișarea simplă a orelor LPR (intrare / ieșire) */}
                      {(() => {
                        const lpr: any = (booking as any).lpr || {}
                        let lprTimesLabel: string | null = null

                        const entryStr = lpr.arrivedAt
                          ? formatLprDateTime(lpr.arrivedAt)
                          : "-"
                        const exitStr = lpr.departedAt
                          ? formatLprDateTime(lpr.departedAt)
                          : "-"

                        lprTimesLabel = `${entryStr} / ${exitStr}`

                        ;(booking as any)._lprTimesLabel = lprTimesLabel
                        return null
                      })()}
                        <TableCell className="font-medium">
                          {booking.source === "manual" && (
                            <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 mr-2 text-xs">
                              MANUAL
                            </Badge>
                          )}
                          {booking.source !== "manual" &&
                            booking.source !== "pay_on_site" &&
                            booking.source !== "lpr" &&
                            booking.status !== "unmatched_lpr" && (
                              <Badge variant="outline" className="text-green-700 border-green-400 bg-green-100 mr-2 text-xs">
                                ONLINE
                              </Badge>
                            )}
                          {booking.source === "pay_on_site" && (
                            <Badge
                              variant="outline"
                              className={`mr-2 text-xs ${
                                (booking as any).payOnSiteOverdueMoreThan3h
                                  ? "text-red-800 border-red-500 bg-red-100"
                                  : "text-orange-800 border-orange-500 bg-orange-200"
                              }`}
                            >
                              {(booking as any).payOnSiteOverdueMoreThan3h
                                ? `PLATĂ LA PARCARE (>${payOnSiteCancelMinutes} min)`
                                : "PLATĂ LA PARCARE"}
                            </Badge>
                          )}
                          {/* Pentru pay-on-site nu afișăm număr de rezervare (nu există în Multipark) */}
                          {booking.source !== "pay_on_site" && (booking.apiBookingNumber || booking.id.substring(0, 6))}
                        </TableCell>
                        <TableCell>{booking.licensePlate}</TableCell>
                        <TableCell>{booking.clientName || "N/A"}</TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            {booking.startDate && booking.endDate ? (
                              <>
                                {formatDateFn(parseISO(booking.startDate), "dd MMM", { locale: ro })}{" "}
                                {booking.startTime || "--:--"} -{" "}
                                {formatDateFn(parseISO(booking.endDate), "dd MMM", { locale: ro })}{" "}
                                {booking.endTime || "--:--"}
                              </>
                            ) : (
                              <span className="text-xs text-gray-400">Perioadă nesetată (LPR / manuală)</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col space-y-1">
                            {(booking as any)._lprTimesLabel ? (
                              <span className="text-xs text-gray-800">
                                {(booking as any)._lprTimesLabel}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{renderPaymentStatusCell(booking)}</TableCell>
                        <TableCell className="text-center">
                          {booking.termsAccepted ? (
                            <span className="text-green-600" title="Termeni acceptați">
                              ✅
                            </span>
                          ) : (
                            <span className="text-red-600" title="Termeni nu au fost acceptați">
                              ❌
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {booking.createdAt
                            ? formatDateFn(booking.createdAt.toDate(), "dd MMM yyyy, HH:mm", { locale: ro })
                            : "N/A"}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleViewBooking(booking)}
                                className="hover:text-white focus:text-white"
                              >
                                <Eye className="mr-2 h-4 w-4" /> Vizualizează
                              </DropdownMenuItem>

                              {/* Buton pentru trimiterea email-ului cu QR code */}
                              {booking.clientEmail && (booking.apiBookingNumber || booking.source === "pay_on_site") && (
                                <DropdownMenuItem
                                  onClick={() => handleSendEmail(booking)}
                                  disabled={isSendingEmail}
                                  className="text-blue-600 focus:text-white focus:bg-blue-600 hover:text-white hover:bg-blue-600"
                                >
                                  {isSendingEmail && sendingEmailBookingId === booking.id ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <Mail className="mr-2 h-4 w-4" />
                                  )}
                                  {booking.source === "pay_on_site" ? "Trimite Email (fără QR)" : "Trimite Email cu QR"}
                                </DropdownMenuItem>
                              )}

                              {/* Completează din LPR pentru rezervările unmatched_lpr */}
                              {booking.status === "unmatched_lpr" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setLprBookingToComplete(booking)
                                      setLprExitDate(new Date())
                                      setLprExitTime("12:00")
                                      setLprClientName(booking.clientName || "")
                                      setLprClientPhone(booking.clientPhone || "")
                                      setLprPersons(
                                        (booking.numberOfPersons || 1).toString(),
                                      )
                                      setIsLprCompleteDialogOpen(true)
                                    }}
                                    className="text-purple-700 hover:text-white hover:bg-purple-600 focus:text-white focus:bg-purple-600"
                                  >
                                    Completează din LPR
                                  </DropdownMenuItem>
                                </>
                              )}
                              {booking.status === "api_error" && booking.paymentStatus === "paid" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleRecoverBooking(booking)}
                                    className="text-blue-600 focus:text-white focus:bg-blue-600 hover:text-white hover:bg-blue-600"
                                    disabled={isRecovering}
                                  >
                                    {isRecovering && selectedBooking?.id === booking.id ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Recuperează Rezervarea
                                  </DropdownMenuItem>
                                </>
                              )}

                              {(booking as any).lpr?.isInside === true && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => handleMarkOutside(booking)}
                                    className="text-red-600 focus:text-white focus:bg-red-600 hover:text-white hover:bg-red-600"
                                    disabled={markingExitId === booking.id}
                                  >
                                    {markingExitId === booking.id ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Marchează ieșire
                                  </DropdownMenuItem>
                                </>
                              )}

                              {isAdmin &&
                                booking.status !== "cancelled_by_admin" &&
                                booking.status !== "cancelled_by_api" &&
                                booking.apiBookingNumber &&
                                booking.source !== "pay_on_site" && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleCancelBooking(booking)}
                                      disabled={isCancelling}
                                      className="text-red-600 hover:text-white hover:bg-red-600 focus:text-white focus:bg-red-600"
                                    >
                                      {isCancelling && selectedBooking?.id === booking.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : null}
                                      Anulează (API)
                                    </DropdownMenuItem>
                                  </>
                                )}

                              {/* Buton anulare pentru rezervările pay-on-site */}
                              {isAdmin &&
                                booking.source === "pay_on_site" &&
                                booking.status !== "cancelled_by_admin" &&
                                booking.status !== "cancelled_by_api" && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => handleCancelPayOnSiteBooking(booking)}
                                      disabled={isCancellingPayOnSite}
                                      className="text-red-600 hover:text-white hover:bg-red-600 focus:text-white focus:bg-red-600"
                                    >
                                      {isCancellingPayOnSite && cancellingPayOnSiteBookingId === booking.id ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : null}
                                      Anulează (Local)
                                    </DropdownMenuItem>
                                  </>
                                )}

                              {isAdmin && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setBookingToDelete(booking)
                                      setIsDeleteDialogOpen(true)
                                    }}
                                    disabled={isDeleting && bookingToDelete?.id === booking.id}
                                    className="text-red-700 hover:text-white hover:bg-red-700 focus:text-white focus:bg-red-700"
                                  >
                                    {isDeleting && bookingToDelete?.id === booking.id ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="mr-2 h-4 w-4" />
                                    )}
                                    Șterge (permanent)
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                )}
              </TableBody>
            </Table>

            {/* Controale paginare (sub tabel) */}
            {filteredBookings.length > 0 && (
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4">
                <div className="text-xs text-gray-600">
                  Pagina {currentPage} din{" "}
                  {Math.max(1, Math.ceil(filteredBookings.length / pageSize))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterioară
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCurrentPage((p) =>
                        Math.min(
                          Math.max(1, Math.ceil(filteredBookings.length / pageSize)),
                          p + 1,
                        ),
                      )
                    }
                    disabled={
                      currentPage >= Math.ceil(filteredBookings.length / pageSize)
                    }
                  >
                    Următoare
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </Tabs>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ștergi rezervarea?</AlertDialogTitle>
            <AlertDialogDescription>
              Această acțiune este permanentă. Înainte de ștergere, sistemul va marca ieșirea (dacă mașina este încă
              „înăuntru”) și va ajusta contorul de ocupare dacă este cazul.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="text-sm text-gray-700">
            <div>
              <strong>Nr. API / ID:</strong>{" "}
              {bookingToDelete?.apiBookingNumber || bookingToDelete?.id || "-"}
            </div>
            <div>
              <strong>Nr. înmatriculare:</strong> {bookingToDelete?.licensePlate || "-"}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setBookingToDelete(null)
              }}
            >
              Renunță
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteBooking} disabled={!bookingToDelete || isDeleting}>
              {isDeleting ? "Se șterge..." : "Șterge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalii Rezervare</DialogTitle>
          </DialogHeader>
          {selectedBooking && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
              <div>
                <h3 className="text-lg font-medium mb-2 text-gray-800">Informații Rezervare</h3>
                <div className="space-y-1 text-sm">
                  <p>
                    <strong>ID Firestore:</strong> {selectedBooking.id}
                  </p>
                  {/* Pentru pay-on-site nu afișăm numărul de rezervare API (nu există în Multipark) */}
                  {selectedBooking.source !== "pay_on_site" && (
                    <p>
                      <strong>Nr. Rez. API Parcare:</strong> {selectedBooking.apiBookingNumber || "N/A"}
                    </p>
                  )}
                  <p>
                    <strong>Status Intern:</strong> {getStatusBadge(selectedBooking.status)}
                  </p>
                  <p>
                    <strong>Nr. Înmatriculare:</strong> {selectedBooking.licensePlate}
                  </p>
                  <p>
                    <strong>Data Intrare:</strong>{" "}
                    {selectedBooking.startDate
                      ? `${formatDateFn(parseISO(selectedBooking.startDate), "dd MMM yyyy", { locale: ro })}, Ora: ${
                          selectedBooking.startTime || "--:--"
                        }`
                      : "Nesetată"}
                  </p>
                  <p>
                    <strong>Data Ieșire:</strong>{" "}
                    {selectedBooking.endDate
                      ? `${formatDateFn(parseISO(selectedBooking.endDate), "dd MMM yyyy", { locale: ro })}, Ora: ${
                          selectedBooking.endTime || "--:--"
                        }`
                      : "Nesetată"}
                  </p>
                  {(() => {
                    const lpr: any = (selectedBooking as any).lpr || {}
                    if (selectedBooking.startDate && selectedBooking.startTime && lpr.arrivedAt) {
                      const plannedStart = new Date(`${selectedBooking.startDate}T${selectedBooking.startTime}:00`)
                      const actualArr = new Date(lpr.arrivedAt)
                      const diffMin = Math.round((actualArr.getTime() - plannedStart.getTime()) / (1000 * 60))
                      if (!Number.isNaN(diffMin) && diffMin !== 0) {
                        if (diffMin < 0) {
                          return (
                            <p className="text-xs text-blue-700">
                              <strong>Intrare LPR:</strong> {formatLprDateTime(lpr.arrivedAt)} (intrat mai devreme cu{" "}
                              {formatDelay(diffMin)})
                            </p>
                          )
                        }
                        return (
                          <p className="text-xs text-red-700">
                            <strong>Intrare LPR:</strong> {formatLprDateTime(lpr.arrivedAt)} (întârziat la intrare cu{" "}
                            {formatDelay(diffMin)})
                          </p>
                        )
                      }
                    }
                    if (lpr.arrivedAt) {
                      return (
                        <p className="text-xs text-gray-600">
                          <strong>Intrare LPR:</strong> {formatLprDateTime(lpr.arrivedAt)}
                        </p>
                      )
                    }
                    return null
                  })()}
                  {(() => {
                    const lpr: any = (selectedBooking as any).lpr || {}
                    if (selectedBooking.endDate && selectedBooking.endTime && lpr.departedAt) {
                      const planned = new Date(`${selectedBooking.endDate}T${selectedBooking.endTime}:00`)
                      const actual = new Date(lpr.departedAt)
                      const diffMin = Math.round((actual.getTime() - planned.getTime()) / (1000 * 60))
                      if (!Number.isNaN(diffMin) && diffMin !== 0) {
                        if (diffMin < 0) {
                          return (
                            <p className="text-xs text-blue-700">
                              <strong>Ieșire LPR:</strong> {formatLprDateTime(lpr.departedAt)} (mai devreme cu{" "}
                              {formatDelay(diffMin)})
                            </p>
                          )
                        }
                        return (
                          <p className="text-xs text-red-700">
                            <strong>Ieșire LPR:</strong> {formatLprDateTime(lpr.departedAt)} (întârziat cu{" "}
                            {formatDelay(diffMin)})
                          </p>
                        )
                      }
                    }
                    if (lpr.departedAt) {
                      return (
                        <p className="text-xs text-gray-600">
                          <strong>Ieșire LPR:</strong> {formatLprDateTime(lpr.departedAt)}
                        </p>
                      )
                    }
                    return null
                  })()}
                  <p>
                    <strong>Creată la:</strong>{" "}
                    {selectedBooking.createdAt
                      ? formatDateFn(selectedBooking.createdAt.toDate(), "dd MMM yyyy, HH:mm:ss", { locale: ro })
                      : "N/A"}
                  </p>
                  {selectedBooking.apiMessage && (
                    <p>
                      <strong>Mesaj API:</strong> {selectedBooking.apiMessage}
                    </p>
                  )}
                  <p>
                    <strong>Durata reală:</strong> {selectedBooking.durationMinutes} minute ({(selectedBooking.durationMinutes / 60).toFixed(1)} ore)
                  </p>
                  {/* Pentru pay-on-site nu afișăm minutele API (nu se trimit la Multipark) */}
                  {selectedBooking.source !== "pay_on_site" && selectedBooking.multiparkDurationMinutes && (
                    <p>
                      <strong>Minute în API:</strong> {selectedBooking.multiparkDurationMinutes} minute ({(selectedBooking.multiparkDurationMinutes / 60)} ore)
                    </p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-medium mb-2 text-gray-800">Informații Client</h3>
                <div className="space-y-1 text-sm">
                  <p>
                    <strong>Nume:</strong> {selectedBooking.clientName || "N/A"}
                  </p>
                  <p>
                    <strong>Email:</strong> {selectedBooking.clientEmail || "N/A"}
                  </p>
                  <p>
                    <strong>Telefon:</strong> {selectedBooking.clientPhone || "N/A"}
                  </p>
                  <p>
                    <strong>Număr persoane:</strong> {selectedBooking.numberOfPersons || "N/A"}
                  </p>
                  {selectedBooking.address && (
                    <p>
                      <strong>Adresă:</strong> {selectedBooking.address}
                    </p>
                  )}
                  {(selectedBooking.city || selectedBooking.county || selectedBooking.postalCode) && (
                    <p>
                      <strong>Localitate:</strong> {[selectedBooking.city, selectedBooking.county, selectedBooking.postalCode].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>
                
                {selectedBooking.needInvoice && (
                  <>
                    <h3 className="text-lg font-medium mt-4 mb-2 text-gray-800">Date Facturare</h3>
                    <div className="space-y-1 text-sm">
                      {selectedBooking.company && (
                        <p>
                          <strong>Denumire firmă:</strong> {selectedBooking.company}
                        </p>
                      )}
                      {selectedBooking.companyVAT && (
                        <p>
                          <strong>CUI/CIF:</strong> {selectedBooking.companyVAT}
                        </p>
                      )}
                      {selectedBooking.companyReg && (
                        <p>
                          <strong>Nr. Reg. Comerțului:</strong> {selectedBooking.companyReg}
                        </p>
                      )}
                      {selectedBooking.companyAddress && (
                        <p>
                          <strong>Adresa firmei:</strong> {selectedBooking.companyAddress}
                        </p>
                      )}
                    </div>
                  </>
                )}
                
                <h3 className="text-lg font-medium mt-4 mb-2 text-gray-800">Informații Plată</h3>
                <div className="space-y-1 text-sm">
                  {selectedBooking.source === "manual" ? (
                    <>
                      <p>
                        <strong>Tip Rezervare:</strong> <Badge className="bg-orange-100 text-orange-700 border-orange-400">Manual</Badge>
                      </p>
                      <p>
                        <strong>Status Plată Manual:</strong> {getManualPaymentStatusBadge(selectedBooking)}
                      </p>
                      <p>
                        <strong>Sumă:</strong> {selectedBooking.amount ? `${selectedBooking.amount.toFixed(2)} RON` : "0.00 RON (Fără cost)"}
                      </p>
                      <p className="text-gray-600 text-xs italic">
                        * Pentru rezervările manuale, statusul plății se actualizează manual prin tab-ul principal.
                      </p>
                    </>
                  ) : selectedBooking.source === "pay_on_site" ? (
                    <>
                      {/* <p>
                        <strong>Tip Rezervare:</strong> <Badge className="bg-orange-100 text-orange-700 border-orange-400">Plată la Parcare</Badge>
                      </p> */}
                      <p>
                        <strong>Status Plată:</strong> <Badge className="bg-yellow-500 text-white">Nepaid (se plătește la parcare)</Badge>
                      </p>
                      <p>
                        <strong>Sumă:</strong> {selectedBooking.amount ? `${selectedBooking.amount.toFixed(2)} RON` : "0.00 RON"}
                      </p>
                      <p className="text-gray-600 text-xs italic">
                        * Plata se va efectua la sosirea în parcare.
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        <strong>Status Plată:</strong> {getPaymentStatusBadge(selectedBooking.paymentStatus)}
                      </p>
                      <p>
                        <strong>Sumă:</strong> {selectedBooking.amount ? `${selectedBooking.amount.toFixed(2)} RON` : "N/A"}
                      </p>
                      <p>
                        <strong>ID Tranzacție Stripe:</strong> {selectedBooking.paymentIntentId || "N/A"}
                      </p>
                    </>
                  )}
                  {selectedBooking.orderNotes && (
                    <p>
                      <strong>Observații:</strong> {selectedBooking.orderNotes}
                    </p>
                  )}
                </div>
                
                <h3 className="text-lg font-medium mt-4 mb-2 text-gray-800">Status Email & QR</h3>
                <div className="space-y-1 text-sm">
                  <p>
                    <strong>Email Client:</strong> {selectedBooking.clientEmail || "N/A"}
                  </p>
                  {/* Pentru pay-on-site nu afișăm informații despre QR (nu există în Multipark) */}
                  {selectedBooking.source !== "pay_on_site" && (
                    <>
                      <p>
                        <strong>QR Code Disponibil:</strong> {selectedBooking.apiBookingNumber ? "✅ Da" : "❌ Nu (lipsește nr. rezervare API)"}
                      </p>
                      {selectedBooking.apiBookingNumber && (
                        <p>
                          <strong>QR Code:</strong> MPK_RES={selectedBooking.apiBookingNumber.padStart(6, '0')}
                        </p>
                      )}
                    </>
                  )}
                  {selectedBooking.source === "pay_on_site" && (
                    <p>
                      <strong>QR Code:</strong> <span className="text-gray-500">Nu este disponibil (plată la parcare)</span>
                    </p>
                  )}
                  <p>
                    <strong>Status Email:</strong> {selectedBooking.emailStatus ? 
                      (selectedBooking.emailStatus === "sent" ? 
                        <span className="text-green-600">✅ Trimis</span> : 
                        <span className="text-red-600">❌ Eșuat</span>
                      ) : 
                      <span className="text-gray-500">-</span>
                    }
                  </p>
                  {selectedBooking.emailSentAt && (
                    <p>
                      <strong>Email trimis la:</strong> {formatDateFn(selectedBooking.emailSentAt.toDate(), "dd MMM yyyy, HH:mm", { locale: ro })}
                    </p>
                  )}
                  {selectedBooking.manualEmailCount && selectedBooking.manualEmailCount > 0 && (
                    <p>
                      <strong>Email-uri manuale trimise:</strong> {selectedBooking.manualEmailCount}
                    </p>
                  )}
                  {selectedBooking.lastEmailError && (
                    <p>
                      <strong>Ultima eroare email:</strong> <span className="text-red-600 text-xs">{selectedBooking.lastEmailError}</span>
                    </p>
                  )}
                </div>
                
                <h3 className="text-lg font-medium mt-4 mb-2 text-gray-800">Termeni și Condiții</h3>
                <div className="space-y-1 text-sm">
                  <p>
                    <strong>Acceptat Termenii:</strong> {selectedBooking.termsAccepted ? 
                      <span className="text-green-600">✅ Da</span> : 
                      <span className="text-red-600">❌ Nu</span>
                    }
                  </p>
                  {selectedBooking.termsAcceptedAt && (
                    <p>
                      <strong>Data acceptării:</strong> {formatDateFn(selectedBooking.termsAcceptedAt.toDate(), "dd MMM yyyy, HH:mm", { locale: ro })}
                    </p>
                  )}
                  {!selectedBooking.termsAccepted && (
                    <p className="text-amber-600 text-xs italic">
                      ⚠️ Clientul nu a acceptat termenii și condițiile
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            {/* Buton pentru trimiterea email-ului din dialog */}
            {selectedBooking && selectedBooking.clientEmail && (selectedBooking.apiBookingNumber || selectedBooking.source === "pay_on_site") && (
              <Button
                variant="outline"
                onClick={() => {
                  setIsViewDialogOpen(false)
                  handleSendEmail(selectedBooking)
                }}
                disabled={isSendingEmail}
                className="text-blue-600 border-blue-600 hover:bg-blue-50"
              >
                {isSendingEmail && sendingEmailBookingId === selectedBooking.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                {selectedBooking.source === "pay_on_site" ? "Trimite Email (fără QR)" : "Trimite Email cu QR"}
              </Button>
            )}
            
            {isAdmin &&
              selectedBooking &&
              selectedBooking.status !== "cancelled_by_admin" &&
              selectedBooking.status !== "cancelled_by_api" &&
              selectedBooking.apiBookingNumber &&
              selectedBooking.source !== "pay_on_site" && (
                <Button
                  variant="destructive"
                  onClick={() => handleCancelBooking(selectedBooking!)}
                  disabled={isCancelling}
                >
                  {isCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Anulează Rezervarea (API)
                </Button>
              )}
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Închide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog pentru completarea rezervărilor unmatched_lpr din LPR */}
      <Dialog
        open={isLprCompleteDialogOpen}
        onOpenChange={(open) => {
          setIsLprCompleteDialogOpen(open)
          if (!open) {
            setLprBookingToComplete(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Completează rezervare din LPR</DialogTitle>
          </DialogHeader>
          {lprBookingToComplete && (
            <form
              className="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!lprExitDate || !lprExitTime) {
                  toast({
                    title: "Câmpuri lipsă",
                    description: "Data și ora de ieșire sunt obligatorii.",
                    variant: "destructive",
                  })
                  return
                }
                const exitDateStr = formatDateFn(lprExitDate, "yyyy-MM-dd")
                const exitTimeStr = lprExitTime
                const persons = parseInt(lprPersons || "1", 10) || 1
                try {
                  const startDate = lprBookingToComplete.startDate
                  const startTime = lprBookingToComplete.startTime
                  let durationMinutes = lprBookingToComplete.durationMinutes || 0
                  if (startDate && startTime) {
                    const startTs = new Date(`${startDate}T${startTime}:00`).getTime()
                    const endTs = new Date(`${exitDateStr}T${exitTimeStr}:00`).getTime()
                    if (!Number.isNaN(startTs) && endTs > startTs) {
                      durationMinutes = Math.floor((endTs - startTs) / (1000 * 60))
                    }
                  }

                  const bookingRef = doc(db, "bookings", lprBookingToComplete.id)
                  await updateDoc(bookingRef, {
                    endDate: exitDateStr,
                    endTime: exitTimeStr,
                    durationMinutes,
                    clientName: lprClientName || lprBookingToComplete.clientName || "",
                    clientPhone: lprClientPhone || lprBookingToComplete.clientPhone || "",
                    numberOfPersons: persons,
                    source: "pay_on_site",
                    status: "confirmed_pay_on_site",
                    paymentStatus: "pending",
                    lastUpdated: serverTimestamp(),
                  })

                  toast({
                    title: "Rezervare completată",
                    description: `Rezervarea pentru ${lprBookingToComplete.licensePlate} a fost completată cu succes.`,
                  })
                  setIsLprCompleteDialogOpen(false)
                  setLprBookingToComplete(null)
                  await fetchBookings()
                } catch (error) {
                  console.error("Error completing LPR booking:", error)
                  toast({
                    title: "Eroare",
                    description: "Nu s-a putut completa rezervarea din LPR.",
                    variant: "destructive",
                  })
                }
              }}
            >
              <div className="space-y-2 text-sm">
                <p>
                  <strong>Nr. înmatriculare:</strong> {lprBookingToComplete.licensePlate}
                </p>
                <p>
                  <strong>Intrare (din LPR):</strong>{" "}
                  {lprBookingToComplete.startDate && lprBookingToComplete.startTime
                    ? `${formatDateFn(
                        parseISO(lprBookingToComplete.startDate),
                        "dd.MM.yyyy",
                        { locale: ro },
                      )} ${lprBookingToComplete.startTime}`
                    : "N/A"}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 mt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Data ieșire *</label>
                  <Input
                    type="date"
                    value={lprExitDate ? formatDateFn(lprExitDate, "yyyy-MM-dd") : ""}
                    onChange={(e) =>
                      setLprExitDate(e.target.value ? new Date(e.target.value) : undefined)
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Ora ieșire *</label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full justify-start text-left font-normal h-10 border border-gray-200 bg-transparent hover:border-[#ff0066] focus:border-[#ff0066] focus:ring-2 focus:ring-[#ff0066]/20 hover:bg-transparent focus:bg-transparent text-gray-900 hover:text-gray-900"
                        type="button"
                      >
                        <Clock className="mr-2 h-4 w-4 text-gray-500" />
                        {lprExitTime}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-4" align="start">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Oră ieșire</label>
                        <TimePickerDemo
                          value={lprExitTime}
                          onChange={(t) => setLprExitTime(t === "00:00" ? "00:05" : t)}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nume client</label>
                  <Input
                    value={lprClientName}
                    onChange={(e) => setLprClientName(e.target.value)}
                    placeholder="Ex: Ion Popescu"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Telefon *</label>
                  <Input
                    value={lprClientPhone}
                    onChange={(e) => setLprClientPhone(e.target.value)}
                    placeholder="Ex: 0722123456"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Număr persoane *</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={lprPersons}
                    onChange={(e) => setLprPersons(e.target.value)}
                    required
                  />
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsLprCompleteDialogOpen(false)
                    setLprBookingToComplete(null)
                  }}
                >
                  Anulează
                </Button>
                <Button type="submit">Salvează</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal pentru adăugarea manuală de rezervări */}
      <Dialog open={isManualDialogOpen} onOpenChange={(open) => {
        if (!open) setApiLogData({ isVisible: false })
        setIsManualDialogOpen(open)
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adaugă Rezervare Manual</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateManualBooking} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Număr Înmatriculare *</label>
                <Input
                  value={manualLicensePlate}
                  onChange={(e) => {
                    setManualLicensePlate(normalizeLicensePlate(e.target.value))
                    // Golește eroarea când utilizatorul schimbă numărul
                    setManualDuplicateError(null)
                  }}
                  placeholder="Ex: DB99SDF"
                  className={manualDuplicateError ? "border-red-500" : ""}
                  required
                />
                {manualDuplicateError && (
                  <div className="text-red-500 text-sm font-semibold mt-1 flex items-center">
                    <XCircle className="mr-1 h-4 w-4" />
                    {manualDuplicateError}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Număr Persoane</label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={manualNumberOfPersons}
                  onChange={(e) => setManualNumberOfPersons(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Data Intrare *</label>
                <div className="relative">
                  <Input
                    type="date"
                    value={manualStartDate ? formatDateFn(manualStartDate, "yyyy-MM-dd") : ''}
                    onChange={(e) => setManualStartDate(e.target.value ? new Date(e.target.value) : undefined)}
                    className="date-input-dd-mm-yyyy"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Ora Intrare *</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start text-left font-normal h-10 border border-gray-200 bg-transparent hover:border-[#ff0066] focus:border-[#ff0066] focus:ring-2 focus:ring-[#ff0066]/20 hover:bg-transparent focus:bg-transparent text-gray-900 hover:text-gray-900" 
                      type="button"
                    >
                      <Clock className="mr-2 h-4 w-4 text-gray-500" />
                      {manualStartTime}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Oră intrare</label>
                      <TimePickerDemo
                        value={manualStartTime}
                        onChange={(t) => setManualStartTime(t === "00:00" ? "00:05" : t)}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Data Ieșire *</label>
                <div className="relative">
                  <Input
                    type="date"
                    value={manualEndDate ? formatDateFn(manualEndDate, "yyyy-MM-dd") : ''}
                    onChange={(e) => setManualEndDate(e.target.value ? new Date(e.target.value) : undefined)}
                    className="date-input-dd-mm-yyyy"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Ora Ieșire *</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start text-left font-normal h-10 border border-gray-200 bg-transparent hover:border-[#ff0066] focus:border-[#ff0066] focus:ring-2 focus:ring-[#ff0066]/20 hover:bg-transparent focus:bg-transparent text-gray-900 hover:text-gray-900" 
                      type="button"
                    >
                      <Clock className="mr-2 h-4 w-4 text-gray-500" />
                      {manualEndTime}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Oră ieșire</label>
                      <TimePickerDemo
                        value={manualEndTime}
                        onChange={(t) => setManualEndTime(t === "00:00" ? "00:05" : t)}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Nume Client</label>
                <Input
                  value={manualClientName}
                  onChange={(e) => setManualClientName(e.target.value)}
                  placeholder="Ex: Ion Popescu"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Telefon Client</label>
                <Input
                  value={manualClientPhone}
                  onChange={(e) => setManualClientPhone(e.target.value)}
                  placeholder="Ex: 0721123456"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">Email Client</label>
                <Input
                  type="email"
                  value={manualClientEmail}
                  onChange={(e) => setManualClientEmail(e.target.value)}
                  placeholder="Ex: client@email.com"
                />
              </div>
            </div>

            {/* Secțiunea pentru logul vizual al API-ului multipark */}
            {apiLogData.isVisible && (
              <div className="mt-6 border-t pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
                  <h3 className="text-lg font-semibold text-gray-800">
                    Log API Multipark
                  </h3>
                </div>
                
                <div className="space-y-4 max-h-80 overflow-y-auto">
                  {/* Request Section */}
                  {apiLogData.request && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        <h4 className="font-medium text-blue-800">
                          📤 Request către {apiLogData.request.url}
                        </h4>
                      </div>
                      <div className="text-xs text-blue-600 mb-2">
                        ⏰ {apiLogData.request.timestamp}
                      </div>
                      <div className="bg-white border border-blue-200 rounded p-2">
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                          {apiLogData.request.payload}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Response Section */}
                  {apiLogData.response && (
                    <div className={`border rounded-lg p-3 ${
                      apiLogData.response.success 
                        ? 'bg-green-50 border-green-200' 
                        : 'bg-red-50 border-red-200'
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full ${
                          apiLogData.response.success ? 'bg-green-500' : 'bg-red-500'
                        }`}></div>
                        <h4 className={`font-medium ${
                          apiLogData.response.success ? 'text-green-800' : 'text-red-800'
                        }`}>
                          📥 Response - Status {apiLogData.response.status} {
                            apiLogData.response.success ? '✅' : '❌'
                          }
                        </h4>
                      </div>
                      <div className={`text-xs mb-2 ${
                        apiLogData.response.success ? 'text-green-600' : 'text-red-600'
                      }`}>
                        ⏰ {apiLogData.response.timestamp}
                      </div>
                      
                      {/* Success/Error Summary */}
                      <div className={`mb-2 p-2 rounded text-sm ${
                        apiLogData.response.success 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        <strong>
                          {apiLogData.response.success ? '🎉 Success: ' : '⚠️ Error: '}
                        </strong>
                        {apiLogData.response.message}
                        {apiLogData.response.errorCode && (
                          <span className="ml-2 text-xs">
                            (Code: {apiLogData.response.errorCode})
                          </span>
                        )}
                      </div>

                      {/* Raw Response */}
                      <div className="bg-white border rounded p-2">
                        <div className="text-xs font-medium text-gray-600 mb-1">
                          Raw Response:
                        </div>
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {apiLogData.response.body}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Loading state când avem doar request */}
                  {apiLogData.request && !apiLogData.response && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-yellow-800 font-medium">
                          Se așteaptă răspunsul de la serverul multipark...
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" className="hover:text-white" onClick={() => {
                setApiLogData({ isVisible: false })
                setIsManualDialogOpen(false)
              }}>
                Anulează
              </Button>
              <Button type="submit" disabled={isCreatingManual}>
                {isCreatingManual ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Se procesează...
                  </>
                ) : (
                  'Creează Rezervarea'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog pentru trimiterea email-ului după rezervare manuală */}
      <Dialog open={isEmailDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsEmailDialogOpen(false)
          setNewBookingForEmail(null)
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" />
              Trimite Email de Confirmare?
            </DialogTitle>
          </DialogHeader>
          
          {newBookingForEmail && (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="font-medium text-green-800">
                    Rezervarea a fost creată cu succes!
                  </span>
                </div>
                <div className="text-sm text-green-700 space-y-1">
                  <p><strong>Număr rezervare:</strong> {newBookingForEmail.apiBookingNumber}</p>
                  <p><strong>Auto:</strong> {newBookingForEmail.licensePlate}</p>
                  <p><strong>Client:</strong> {newBookingForEmail.clientName}</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Mail className="h-4 w-4 text-blue-600" />
                  <span className="font-medium text-blue-800">
                    Email disponibil
                  </span>
                </div>
                <p className="text-sm text-blue-700">
                  <strong>Destinatar:</strong> {newBookingForEmail.clientEmail}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Email-ul va conține QR code-ul pentru intrarea în parcare.
                </p>
              </div>

              <div className="text-sm text-gray-600">
                Doriți să trimiteți email-ul de confirmare acum?
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => {
                setIsEmailDialogOpen(false)
                setNewBookingForEmail(null)
              }}
              disabled={isSendingEmail}
            >
              Nu trimite
            </Button>
            <Button 
              type="button" 
              onClick={handleSendEmailFromNewBooking}
              disabled={isSendingEmail}
              className="bg-waze-blue hover:bg-waze-blue/80"
            >
              {isSendingEmail ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Se trimite...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Trimite Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog pentru confirmarea succesului recovery-ului */}
      <Dialog open={isRecoverySuccessDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsRecoverySuccessDialogOpen(false)
          setRecoverySuccessData(null)
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              </div>
              Recovery Multipark Reușit!
            </DialogTitle>
          </DialogHeader>
          
          {recoverySuccessData && (
            <div className="space-y-4">
              {/* Success Summary */}
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="font-semibold text-green-800">
                    ✅ Rezervarea a fost trimisă cu succes la API Multipark
                  </span>
                </div>
                <div className="text-sm text-green-700 space-y-1">
                  <p><strong>Număr rezervare nou:</strong> {recoverySuccessData.bookingNumber}</p>
                  <p><strong>Auto:</strong> {recoverySuccessData.licensePlate}</p>
                  <p><strong>Client:</strong> {recoverySuccessData.clientName}</p>
                </div>
              </div>

             

              {/* What happens next */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-4 h-4 bg-gray-500 rounded-full flex items-center justify-center">
                    <span className="text-white text-xs">i</span>
                  </div>
                  <span className="font-medium text-gray-800">
                    Ce urmează
                  </span>
                </div>
                <div className="text-sm text-gray-700 space-y-1">
                  <p>✅ Rezervarea este acum activă în sistemul multipark</p>
                  <p>✅ QR code-ul este disponibil pentru trimiterea email-ului</p>
                  <p>✅ Statusul rezervării a fost actualizat la "Confirmat"</p>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button 
              type="button" 
              onClick={() => {
                setIsRecoverySuccessDialogOpen(false)
                setRecoverySuccessData(null)
              }}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              Perfect! Închide
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function BookingsPage() {
  return (
    // Suspense este util dacă ai operațiuni asincrone la nivel superior sau parametri de căutare
    // Pentru moment, logica de încărcare este în BookingsPageContent
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" /> <p className="ml-2">Se încarcă pagina...</p>
        </div>
      }
    >
      <BookingsPageContent />
    </Suspense>
  )
}
