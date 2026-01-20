import { db } from './firebase'
import { collection, query, where, getDocs, orderBy, limit, Timestamp, doc, updateDoc, increment, serverTimestamp, getDoc } from 'firebase/firestore'

// Interfețe pentru tipurile de date
export interface MonthlyStats {
  name: string
  value: number
  // Index signature pentru compatibilitate cu tipurile de date Recharts (ChartDataInput)
  [key: string]: string | number
}

export interface BookingStatusStats {
  name: string
  value: number
  // Index signature pentru compatibilitate cu tipurile de date Recharts (ChartDataInput)
  [key: string]: string | number
}

export interface OccupancyStats {
  name: string
  value: number
  // Index signature pentru compatibilitate cu tipurile de date Recharts (ChartDataInput)
  [key: string]: string | number
}

export interface RecentBooking {
  id: string
  licensePlate: string
  clientName: string
  startDate: string
  endDate: string
  status: string
  amount: number
}

export interface DailyEntryExit {
  id: string
  time: string // ora programată (startTime/endTime)
  // Keep raw times available so admin pages can correctly compute durations (e.g. for LPR/pay-on-site billing).
  startTime?: string
  endTime?: string
  licensePlate: string
  phone: string
  numberOfPersons: number | string // Poate fi număr sau "N/A" pentru rezervări mai vechi
  source?: string // Pentru a identifica rezervările manuale
  // Optional raw booking fields used by admin calculations
  status?: string
  paymentStatus?: string
  actualTime?: string // Ora efectivă din LPR (HH:mm)
  delayMinutes?: number // Diferența (efectiv - programat) în minute
  amount?: number // Valoarea de plată (acolo unde este disponibilă)
  startDate?: string
  endDate?: string
  bookingStatus?: string
  // For exits list: whether the car actually entered the parking (LPR arrivedAt or isInside)
  hasArrived?: boolean
}

// Noi interfețe pentru statisticile suplimentare
export interface DailyStatistics {
  date: string
  availableSpots: number
  scheduledEntries: number
  actualEntries: number
  remainingEntries: number
  scheduledExits: number
  actualExits: number
  expiredReservations: number
}

export interface ActualEntryExit {
  id: string
  time: string
  licensePlate: string
  phone: string
  actualDateTime: string
  bookingId?: string
  source: 'manual' | 'automatic' | 'system'
}

export interface ExpiredReservation {
  id: string
  licensePlate: string
  clientName: string
  clientPhone: string
  plannedEndDate: string
  plannedEndTime: string
  actualEndDateTime?: string
  daysOverdue: number
  status: string
}

export interface DashboardStats {
  totalRevenue: number
  totalBookings: number
  totalClients: number
  currentOccupancy: number // procent
  currentOccupancyCount: number // număr mașini (LPR isInside)
  maxLimit: number // limită setată
  revenueGrowth: string
  bookingsGrowth: string
  clientsGrowth: string
}

export interface PresentVehicle {
  id: string
  licensePlate: string
  source: string
  status: string
  arrivedAt?: string
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
  isDelayed: boolean
  isUnmatched: boolean
}

function coerceMoney(value: any): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "string") {
    const s = value.trim()
    if (!s) return undefined
    // Accept "269", "269.00", "269,00"
    const n = Number(s.replace(",", "."))
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Obține statisticile principale pentru dashboard
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    const bookingsRef = collection(db, 'bookings')
    const currentYear = new Date().getFullYear()
    const lastYear = currentYear - 1
    
    // Calculează începutul și sfârșitul anului curent
    const currentYearStart = new Date(currentYear, 0, 1)
    const currentYearEnd = new Date(currentYear, 11, 31, 23, 59, 59)
    const lastYearStart = new Date(lastYear, 0, 1)
    const lastYearEnd = new Date(lastYear, 11, 31, 23, 59, 59)

    // Query pentru rezervările din anul curent
    const currentYearQuery = query(
      bookingsRef,
      where('createdAt', '>=', Timestamp.fromDate(currentYearStart)),
      where('createdAt', '<=', Timestamp.fromDate(currentYearEnd))
    )

    // Query pentru rezervările din anul trecut
    const lastYearQuery = query(
      bookingsRef,
      where('createdAt', '>=', Timestamp.fromDate(lastYearStart)),
      where('createdAt', '<=', Timestamp.fromDate(lastYearEnd))
    )

    const [currentYearSnap, lastYearSnap] = await Promise.all([
      getDocs(currentYearQuery),
      getDocs(lastYearQuery)
    ])

    // Calculează statisticile pentru anul curent
    let totalRevenue = 0
    let totalBookings = 0
    const uniqueClients = new Set<string>()
    let confirmedBookings = 0

    currentYearSnap.forEach(doc => {
      const booking = doc.data()
      totalRevenue += booking.amount || 0
      totalBookings++
      if (booking.clientEmail) {
        uniqueClients.add(booking.clientEmail)
      }
      if (booking.status === 'confirmed_paid' || booking.status === 'confirmed_test' || booking.status === 'confirmed_pay_on_site') {
        confirmedBookings++
      }
    })

    // Calculează statisticile pentru anul trecut
    let lastYearRevenue = 0
    let lastYearBookings = 0
    const lastYearClients = new Set<string>()

    lastYearSnap.forEach(doc => {
      const booking = doc.data()
      lastYearRevenue += booking.amount || 0
      lastYearBookings++
      if (booking.clientEmail) {
        lastYearClients.add(booking.clientEmail)
      }
    })

    // Calculează procentajele de creștere
    const revenueGrowth = lastYearRevenue > 0 
      ? `${(((totalRevenue - lastYearRevenue) / lastYearRevenue) * 100).toFixed(1)}%`
      : '0%'
    
    const bookingsGrowth = lastYearBookings > 0 
      ? `${(((totalBookings - lastYearBookings) / lastYearBookings) * 100).toFixed(1)}%`
      : '0%'

    const clientsGrowth = lastYearClients.size > 0 
      ? `${(((uniqueClients.size - lastYearClients.size) / lastYearClients.size) * 100).toFixed(1)}%`
      : '0%'

    // Ocupare curentă bazată pe LPR isInside și limită din reservationSettings
    const settingsSnap = await getDoc(doc(db, 'config', 'reservationSettings'))
    const maxLimit = settingsSnap.exists() ? Number(settingsSnap.data()?.maxTotalReservations || 0) : 0

    // Preferă contorul live din parkingLive; fallback la numărarea isInside
    let presentCount = 0
    const liveSnap = await getDoc(doc(db, 'config', 'parkingLive'))
    if (liveSnap.exists()) {
      presentCount = Math.max(0, Number(liveSnap.data()?.occupiedCount || 0))
    }
    if (!presentCount) {
      const todayIso = new Date().toISOString().split('T')[0]
      const lprInsideQuery = query(
      bookingsRef,
        where('lpr.isInside', '==', true),
        where('endDate', '>=', todayIso)
    )
      const lprInsideSnap = await getDocs(lprInsideQuery)
      presentCount = lprInsideSnap.size
    }

    const currentOccupancy = maxLimit > 0
      ? Math.min(Math.round((presentCount / maxLimit) * 100), 100)
      : 0

    return {
      totalRevenue,
      totalBookings,
      totalClients: uniqueClients.size,
      currentOccupancy: Math.round(currentOccupancy),
      currentOccupancyCount: presentCount,
      maxLimit,
      revenueGrowth,
      bookingsGrowth,
      clientsGrowth
    }

  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    // Returnează valori default în caz de eroare
    return {
      totalRevenue: 0,
      totalBookings: 0,
      totalClients: 0,
      currentOccupancy: 0,
      currentOccupancyCount: 0,
      maxLimit: 0,
      revenueGrowth: '0%',
      bookingsGrowth: '0%',
      clientsGrowth: '0%'
    }
  }
}

/**
 * Obține datele pentru graficul de venituri lunare
 */
export async function getMonthlyRevenueData(): Promise<MonthlyStats[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    const currentYear = new Date().getFullYear()
    
    const startOfYear = new Date(currentYear, 0, 1)
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59)

    const q = query(
      bookingsRef,
      where('createdAt', '>=', Timestamp.fromDate(startOfYear)),
      where('createdAt', '<=', Timestamp.fromDate(endOfYear)),
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed_pay_on_site'])
    )

    const snapshot = await getDocs(q)
    
    console.log(`📊 Monthly revenue query found ${snapshot.size} bookings with confirmed status for year ${currentYear}`)
    
    // Inițializează array-ul cu toate lunile
    const monthNames = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthlyData: MonthlyStats[] = monthNames.map(name => ({ name, value: 0 }))

    // Agregă veniturile pe luni
    let totalRevenue = 0
    snapshot.forEach(doc => {
      const booking = doc.data()
      const date = booking.createdAt.toDate()
      const monthIndex = date.getMonth()
      const amount = booking.amount || 0
      monthlyData[monthIndex].value += amount
      totalRevenue += amount
    })

    console.log(`📈 Total revenue for ${currentYear}: ${totalRevenue} RON from ${snapshot.size} bookings`)
    return monthlyData

  } catch (error) {
    console.error('Error fetching monthly revenue data:', error)
    return []
  }
}

/**
 * Obține lista de vehicule prezente în parcare (LPR)
 */
export async function getPresentVehicles(): Promise<{
  items: PresentVehicle[]
  presentCount: number
  delayedCount: number
}> {
  try {
    const now = Date.now()
    const bookingsRef = collection(db, 'bookings')
    // Doar cele cu lpr.isInside == true
    const q = query(bookingsRef, where('lpr.isInside', '==', true))
    const snap = await getDocs(q)
    const items: PresentVehicle[] = []
    let delayedCount = 0
    snap.forEach(docSnap => {
      const b: any = docSnap.data()
      const endTs = b.endDate && b.endTime ? new Date(`${b.endDate}T${b.endTime}:00`).getTime() : NaN
      const delayed = Number.isFinite(endTs) && endTs < now
      if (delayed) delayedCount++
      items.push({
        id: docSnap.id,
        licensePlate: b.licensePlate || 'N/A',
        source: b.source || 'unknown',
        status: b.status || 'unknown',
        arrivedAt: b?.lpr?.arrivedAt,
        startDate: b.startDate,
        startTime: b.startTime,
        endDate: b.endDate,
        endTime: b.endTime,
        isDelayed: delayed,
        isUnmatched: b.status === 'unmatched_lpr'
      })
    })
    // Sortează: întârziate primele, apoi după arrivedAt
    items.sort((a, b) => {
      if (a.isDelayed !== b.isDelayed) return a.isDelayed ? -1 : 1
      const atA = a.arrivedAt ? new Date(a.arrivedAt).getTime() : 0
      const atB = b.arrivedAt ? new Date(b.arrivedAt).getTime() : 0
      return atA - atB
    })
    return { items, presentCount: items.length, delayedCount }
  } catch (e) {
    console.error('Error fetching present vehicles:', e)
    return { items: [], presentCount: 0, delayedCount: 0 }
  }
}

/**
 * Obține datele pentru graficul de rezervări lunare
 */
export async function getMonthlyBookingsData(): Promise<MonthlyStats[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    const currentYear = new Date().getFullYear()
    
    const startOfYear = new Date(currentYear, 0, 1)
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59)

    const q = query(
      bookingsRef,
      where('createdAt', '>=', Timestamp.fromDate(startOfYear)),
      where('createdAt', '<=', Timestamp.fromDate(endOfYear))
    )

    const snapshot = await getDocs(q)
    
    // Inițializează array-ul cu toate lunile
    const monthNames = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthlyData: MonthlyStats[] = monthNames.map(name => ({ name, value: 0 }))

    // Contorizează rezervările pe luni
    snapshot.forEach(doc => {
      const booking = doc.data()
      const date = booking.createdAt.toDate()
      const monthIndex = date.getMonth()
      monthlyData[monthIndex].value += 1
    })

    return monthlyData

  } catch (error) {
    console.error('Error fetching monthly bookings data:', error)
    return []
  }
}

/**
 * Obține datele pentru graficul de status al rezervărilor
 */
export async function getBookingStatusData(): Promise<BookingStatusStats[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    const snapshot = await getDocs(bookingsRef)
    
    const statusCounts = {
      confirmed: 0,
      pending: 0,
      cancelled: 0
    }

    snapshot.forEach(doc => {
      const booking = doc.data()
      const status = booking.status || 'pending'
      
      if (status === 'confirmed_paid' || status === 'confirmed_test' || status === 'confirmed' || status === 'paid' || status === 'confirmed_pay_on_site') {
        statusCounts.confirmed++
      } else if (status === 'cancelled_by_admin' || status === 'cancelled_by_api' || status === 'cancelled') {
        statusCounts.cancelled++
      } else {
        statusCounts.pending++
      }
    })

    const total = statusCounts.confirmed + statusCounts.pending + statusCounts.cancelled
    
    if (total === 0) {
      return [
        { name: 'Confirmate', value: 0 },
        { name: 'În așteptare', value: 0 },
        { name: 'Anulate', value: 0 }
      ]
    }

    return [
      { name: 'Confirmate', value: Math.round((statusCounts.confirmed / total) * 100) },
      { name: 'În așteptare', value: Math.round((statusCounts.pending / total) * 100) },
      { name: 'Anulate', value: Math.round((statusCounts.cancelled / total) * 100) }
    ]

  } catch (error) {
    console.error('Error fetching booking status data:', error)
    return [
      { name: 'Confirmate', value: 0 },
      { name: 'În așteptare', value: 0 },
      { name: 'Anulate', value: 0 }
    ]
  }
}

/**
 * Marchează rezervările expirate ca fiind inactive
 */
async function markExpiredBookingsAsInactive() {
  try {
    const now = new Date()
    const currentDateStr = now.toISOString().split('T')[0] // YYYY-MM-DD
    const currentTimeStr = now.toTimeString().slice(0, 5) // HH:mm
    
    console.log('🕒 Checking for expired bookings at:', { currentDateStr, currentTimeStr })
    
    const bookingsRef = collection(db, 'bookings')
    
    // Query pentru rezervările care ar trebui să fie active dar poate au expirat
    const potentiallyExpiredQuery = query(
      bookingsRef,
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']),
      where('endDate', '<=', currentDateStr) // Toate rezervările care se termină astăzi sau în trecut
    )
    
    const snapshot = await getDocs(potentiallyExpiredQuery)
    const expiredBookings = []
    
    for (const doc of snapshot.docs) {
      const booking = doc.data()
      const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
      
      if (endDateTime <= now) {
        expiredBookings.push({
          id: doc.id,
          ...booking,
          endDateTime: endDateTime.toISOString()
        })
        
        // Marchează rezervarea ca expirată
        await updateDoc(doc.ref, {
          status: 'expired',
          expiredAt: serverTimestamp(),
          lastUpdated: serverTimestamp()
        })
        
        console.log('⏰ Marked booking as expired:', {
          id: doc.id,
          licensePlate: booking.licensePlate,
          endDate: booking.endDate,
          endTime: booking.endTime,
          endDateTime: endDateTime.toISOString()
        })
      }
    }
    
    if (expiredBookings.length > 0) {
      console.log(`✅ Marked ${expiredBookings.length} bookings as expired`)
      
      // Actualizează statisticile - scade numărul de rezervări active
      const statsDocRef = doc(db, "config", "reservationStats")
      await updateDoc(statsDocRef, {
        activeBookingsCount: increment(-expiredBookings.length),
        lastUpdated: serverTimestamp()
      })
    }
    
    return expiredBookings.length
    
  } catch (error) {
    console.error('❌ Error marking expired bookings:', error)
    return 0
  }
}

/**
 * Obține datele pentru graficul de ocupare
 */
export async function getOccupancyData(): Promise<OccupancyStats[]> {
  try {
    // Preferă contorul LIVE din Firestore (LPR), cu fallback pe calculul clasic din rezervări
    const totalSpots = await getMaxTotalReservations()
    const liveDoc = await getDoc(doc(db, 'config', 'parkingLive'))
    if (liveDoc.exists()) {
      const occupiedCount = Math.max(0, Number(liveDoc.data().occupiedCount || 0))
      const occupiedPercentage = Math.min(100, Math.round((occupiedCount / totalSpots) * 100))
      const freePercentage = 100 - occupiedPercentage
      
      console.log('🚗 Using LIVE LPR occupancy:', {
        occupiedCount,
        totalSpots,
        occupiedPercentage
      })
      
      return [
        { name: 'Ocupat', value: occupiedPercentage },
        { name: 'Liber', value: freePercentage }
      ]
    }
    
    // Fallback: calculează din rezervări (backward-compatible)
    const bookingsRef = collection(db, 'bookings')
    const now = new Date()
    const currentDateStr = now.toISOString().split('T')[0]
    const now_timestamp = now.getTime()
    const activeBookingsQuery = query(
      bookingsRef,
      where('startDate', '<=', currentDateStr),
      where('endDate', '>=', currentDateStr),
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site'])
    )
    const snapshot = await getDocs(activeBookingsQuery)
    let reallyActiveBookings = 0
    snapshot.forEach(docSnap => {
      const booking = docSnap.data()
      const startDateTime = new Date(`${booking.startDate}T${booking.startTime}:00`)
      const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
      if (startDateTime.getTime() <= now_timestamp && endDateTime.getTime() > now_timestamp) {
        reallyActiveBookings++
      }
    })
    const occupiedPercentage = Math.round((reallyActiveBookings / totalSpots) * 100)
    return [
      { name: 'Ocupat', value: occupiedPercentage },
      { name: 'Liber', value: 100 - occupiedPercentage }
    ]

  } catch (error) {
    console.error('Error fetching occupancy data:', error)
    return [
      { name: 'Ocupat', value: 0 },
      { name: 'Liber', value: 100 }
    ]
  }
}

/**
 * Obține rezervările recente
 */
export async function getRecentBookings(): Promise<RecentBooking[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    const q = query(
      bookingsRef,
      orderBy('createdAt', 'desc'),
      limit(5)
    )

    const snapshot = await getDocs(q)
    const recentBookings: RecentBooking[] = []

    snapshot.forEach(doc => {
      const booking = doc.data()
      recentBookings.push({
        id: doc.id,
        licensePlate: booking.licensePlate || 'N/A',
        clientName: booking.clientName || 'N/A',
        startDate: booking.startDate || '',
        endDate: booking.endDate || '',
        status: booking.status || 'pending',
        amount: booking.amount || 0
      })
    })

    return recentBookings

  } catch (error) {
    console.error('Error fetching recent bookings:', error)
    return []
  }
}

function parseFirestoreDate(value: any): Date | null {
  if (!value) return null
  try {
    // Firestore Timestamp instance
    if (typeof value?.toDate === "function") {
      const d = value.toDate()
      return Number.isNaN(d.getTime()) ? null : d
    }
    // Firestore Timestamp-like plain objects (can appear in nested maps)
    const seconds =
      typeof value?.seconds === "number"
        ? value.seconds
        : typeof value?._seconds === "number"
          ? value._seconds
          : null
    if (typeof seconds === "number" && !Number.isNaN(seconds)) {
      const d = new Date(seconds * 1000)
      return Number.isNaN(d.getTime()) ? null : d
    }

    // ISO string / epoch millis / Date
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

/**
 * Obține intrările (rezervările care încep) pentru o dată specifică
 */
export async function getDailyEntries(selectedDate: string, includeFuture = false): Promise<DailyEntryExit[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    
    // Query pentru rezervările care încep în data selectată sau viitoare (dacă includeFuture=true)
    const constraints: any[] = []
    if (includeFuture) {
      constraints.push(where('startDate', '>=', selectedDate))
      constraints.push(orderBy('startDate', 'asc'))
      constraints.push(orderBy('startTime', 'asc'))
    } else {
      constraints.push(where('startDate', '==', selectedDate))
      constraints.push(orderBy('startTime', 'asc'))
    }
    const q = query(bookingsRef, ...constraints)

    const snapshot = await getDocs(q)
    const entries: DailyEntryExit[] = []

    snapshot.forEach(doc => {
      const booking = doc.data() as any
      // Determină sursa rezervării
      const bookingSource = booking.source
      let source = bookingSource || 'webhook'
      // IMPORTANT:
      // `confirmed_pay_on_site` is a STATUS, not always a "pay_on_site" SOURCE.
      // LPR-completed bookings can have confirmed_pay_on_site but must remain source="lpr" for correct badges in admin UI.
      if (booking.status === 'confirmed_pay_on_site') {
        source = bookingSource === 'lpr' ? 'lpr' : 'pay_on_site'
      }
      const lpr = booking.lpr || {}
      const scheduledTimeStr: string = booking.startTime || 'N/A'
      let actualTime: string | undefined
      let delayMinutes: number | undefined
      if (lpr.arrivedAt) {
        const actual = parseFirestoreDate(lpr.arrivedAt)
        if (actual) {
          // Show camera time (UTC clock) consistently across the admin UI
          actualTime = actual.toISOString().slice(11, 16)
          if (booking.startDate && booking.startTime) {
            // IMPORTANT:
            // LPR times are stored as ISO (UTC) but represent the camera's local clock.
            // To compare apples-to-apples, we also parse the scheduled time as UTC (add "Z").
            const scheduled = new Date(`${booking.startDate}T${booking.startTime}:00Z`)
            const diffMin = Math.round((actual.getTime() - scheduled.getTime()) / (1000 * 60))
            if (!Number.isNaN(diffMin)) delayMinutes = diffMin
          }
        }
      }
      
      entries.push({
        id: doc.id,
        startDate: booking.startDate || selectedDate,
        endDate: booking.endDate || undefined,
        time: scheduledTimeStr,
        startTime: booking.startTime || undefined,
        endTime: booking.endTime || undefined,
        licensePlate: booking.licensePlate || 'N/A',
        phone: booking.clientPhone || 'N/A',
        numberOfPersons: booking.numberOfPersons ? booking.numberOfPersons : 'N/A',
        source,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.status,
        actualTime,
        delayMinutes,
        amount: coerceMoney(booking.amount),
      })
    })

    return entries

  } catch (error) {
    console.error('Error fetching daily entries:', error)
    return []
  }
}

/**
 * Obține ieșirile (rezervările care se termină) pentru o dată specifică
 */
export async function getDailyExits(selectedDate: string, includeFuture = false): Promise<DailyEntryExit[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    
    // Query pentru rezervările care se termină în data selectată sau viitoare (dacă includeFuture=true)
    const constraints: any[] = []
    if (includeFuture) {
      constraints.push(where('endDate', '>=', selectedDate))
      constraints.push(orderBy('endDate', 'asc'))
      constraints.push(orderBy('endTime', 'asc'))
    } else {
      constraints.push(where('endDate', '==', selectedDate))
      constraints.push(orderBy('endTime', 'asc'))
    }
    const q = query(bookingsRef, ...constraints)

    const snapshot = await getDocs(q)
    const exits: DailyEntryExit[] = []

    snapshot.forEach(doc => {
      const booking = doc.data() as any
      // Determină sursa rezervării
      const bookingSource = booking.source
      let source = bookingSource || 'webhook'
      // Keep the same rule as entries: do not overwrite LPR source.
      if (booking.status === 'confirmed_pay_on_site') {
        source = bookingSource === 'lpr' ? 'lpr' : 'pay_on_site'
      }
      const lpr = booking.lpr || {}
      const scheduledTimeStr: string = booking.endTime || 'N/A'
      let actualTime: string | undefined
      let delayMinutes: number | undefined
      if (lpr.departedAt) {
        const actual = parseFirestoreDate(lpr.departedAt)
        if (actual) {
          actualTime = actual.toISOString().slice(11, 16)
          if (booking.endDate && booking.endTime) {
            // See note above: parse scheduled as UTC for consistent comparison
            const scheduled = new Date(`${booking.endDate}T${booking.endTime}:00Z`)
            const diffMin = Math.round((actual.getTime() - scheduled.getTime()) / (1000 * 60))
            if (!Number.isNaN(diffMin)) delayMinutes = diffMin
          }
        }
      }
      
      exits.push({
        id: doc.id,
        startDate: booking.startDate || undefined,
        endDate: booking.endDate || selectedDate,
        time: scheduledTimeStr,
        startTime: booking.startTime || undefined,
        endTime: booking.endTime || undefined,
        licensePlate: booking.licensePlate || 'N/A',
        phone: booking.clientPhone || 'N/A',
        numberOfPersons: booking.numberOfPersons ? booking.numberOfPersons : 'N/A',
        source,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        bookingStatus: booking.status,
        hasArrived: Boolean(lpr.arrivedAt) || lpr.isInside === true,
        actualTime,
        delayMinutes,
        amount: coerceMoney(booking.amount),
      })
    })

    return exits

  } catch (error) {
    console.error('Error fetching daily exits:', error)
    return []
  }
}

/**
 * Obține intrările efectuate pentru o dată specifică (din server + manuale)
 */
export async function getActualEntries(selectedDate: string): Promise<ActualEntryExit[]> {
  try {
    // Pentru moment, simulez datele - în implementarea reală, acestea ar veni din sisteme de tracking/server
    // Pot fi integrate cu sistemele de intrări automate, camere, senzori, etc.
    const entries: ActualEntryExit[] = []
    
    // În implementarea reală, aici ar fi query-uri către:
    // 1. Tabelul de intrări efective din server
    // 2. Intrările marcate manual de admin
    // 3. Datele de la sistemele de tracking
    
    console.log(`📍 Fetching actual entries for date: ${selectedDate}`)
    
    // Placeholder - în implementarea reală va fi înlocuit cu query-uri reale
    // const actualEntriesRef = collection(db, 'actualEntries')
    // const q = query(
    //   actualEntriesRef,
    //   where('date', '==', selectedDate),
    //   orderBy('actualDateTime', 'asc')
    // )
    
    return entries

  } catch (error) {
    console.error('Error fetching actual entries:', error)
    return []
  }
}

/**
 * Obține ieșirile efectuate pentru o dată specifică (din server + manuale)
 */
export async function getActualExits(selectedDate: string): Promise<ActualEntryExit[]> {
  try {
    // Pentru moment, simulez datele - în implementarea reală, acestea ar veni din sisteme de tracking/server
    const exits: ActualEntryExit[] = []
    
    console.log(`📍 Fetching actual exits for date: ${selectedDate}`)
    
    // În implementarea reală, aici ar fi query-uri către:
    // 1. Tabelul de ieșiri efective din server
    // 2. Ieșirile marcate manual de admin
    // 3. Datele de la sistemele de tracking
    
    return exits

  } catch (error) {
    console.error('Error fetching actual exits:', error)
    return []
  }
}

/**
 * Obține rezervările care au depășit termenul de ședere
 */
export async function getExpiredReservations(): Promise<ExpiredReservation[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    const now = new Date()
    const currentDateStr = now.toISOString().split('T')[0]
    
    // Query pentru rezervările care ar fi trebuit să se termine până acum
    const expiredQuery = query(
      bookingsRef,
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']),
      where('endDate', '<', currentDateStr)
    )

    const snapshot = await getDocs(expiredQuery)
    const expiredReservations: ExpiredReservation[] = []

    snapshot.forEach(doc => {
      const booking = doc.data()
      const plannedEndDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
      const daysDiff = Math.floor((now.getTime() - plannedEndDateTime.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysDiff > 0) { // Doar dacă a trecut cu adevărat termenul
        expiredReservations.push({
          id: doc.id,
          licensePlate: booking.licensePlate || 'N/A',
          clientName: booking.clientName || 'N/A',
          clientPhone: booking.clientPhone || 'N/A',
          plannedEndDate: booking.endDate || '',
          plannedEndTime: booking.endTime || '',
          daysOverdue: daysDiff,
          status: booking.status || 'unknown'
        })
      }
    })

    // Sortează după numărul de zile întârziate (mai multe zile = mai urgent)
    expiredReservations.sort((a, b) => b.daysOverdue - a.daysOverdue)

    console.log(`⚠️ Found ${expiredReservations.length} expired reservations`)
    return expiredReservations

  } catch (error) {
    console.error('Error fetching expired reservations:', error)
    return []
  }
}

/**
 * Obține statisticile complete pentru o dată specifică
 */
export async function getDailyStatistics(selectedDate: string): Promise<DailyStatistics> {
  try {
    console.log(`📊 Computing daily statistics for date: ${selectedDate}`)

    // Obține toate datele în paralel pentru eficiență
    const [
      totalSpots,
      occupancyData,
      scheduledEntries,
      actualEntries,
      scheduledExits,
      actualExits,
      expiredReservations
    ] = await Promise.all([
      getMaxTotalReservations(),
      getOccupancyData(),
      getDailyEntries(selectedDate),
      getActualEntries(selectedDate),
      getDailyExits(selectedDate),
      getActualExits(selectedDate),
      getExpiredReservations()
    ])

    // Calculează locurile disponibile
    const occupiedPercentage = occupancyData.find(item => item.name === 'Ocupat')?.value || 0
    const occupiedSpots = Math.round((occupiedPercentage / 100) * totalSpots)
    const availableSpots = totalSpots - occupiedSpots

    // Calculează statisticile
    const scheduledEntriesCount = scheduledEntries.length
    const actualEntriesCount = actualEntries.length
    const remainingEntries = Math.max(0, scheduledEntriesCount - actualEntriesCount)
    const scheduledExitsCount = scheduledExits.length
    const actualExitsCount = actualExits.length
    const expiredReservationsCount = expiredReservations.length

    const statistics: DailyStatistics = {
      date: selectedDate,
      availableSpots,
      scheduledEntries: scheduledEntriesCount,
      actualEntries: actualEntriesCount,
      remainingEntries,
      scheduledExits: scheduledExitsCount,
      actualExits: actualExitsCount,
      expiredReservations: expiredReservationsCount
    }

    console.log('📈 Daily statistics calculated:', statistics)
    return statistics

  } catch (error) {
    console.error('Error computing daily statistics:', error)
    return {
      date: selectedDate,
      availableSpots: 0,
      scheduledEntries: 0,
      actualEntries: 0,
      remainingEntries: 0,
      scheduledExits: 0,
      actualExits: 0,
      expiredReservations: 0
    }
  }
}

/**
 * Obține limita maximă de rezervări din configurația Firebase
 */
export async function getMaxTotalReservations(): Promise<number> {
  try {
    const settingsDoc = await getDoc(doc(db, 'config', 'reservationSettings'))
    const data = settingsDoc.data()
    const maxReservations = data?.maxTotalReservations ?? 100 // Fallback la 100 dacă nu e setat
    
    console.log('📋 Retrieved max total reservations:', maxReservations)
    return maxReservations
  } catch (error) {
    console.error('Error fetching max reservations:', error)
    return 100 // Fallback în caz de eroare
  }
} 