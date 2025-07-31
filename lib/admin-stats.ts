import { db } from './firebase'
import { collection, query, where, getDocs, orderBy, limit, Timestamp, doc, updateDoc, increment, serverTimestamp, getDoc } from 'firebase/firestore'

// Interfețe pentru tipurile de date
export interface MonthlyStats {
  name: string
  value: number
}

export interface BookingStatusStats {
  name: string
  value: number
}

export interface OccupancyStats {
  name: string
  value: number
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
  time: string
  licensePlate: string
  phone: string
  numberOfPersons: number | string // Poate fi număr sau "N/A" pentru rezervări mai vechi
  source?: string // Pentru a identifica rezervările manuale
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
  currentOccupancy: number
  revenueGrowth: string
  bookingsGrowth: string
  clientsGrowth: string
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

    // Calculează ocuparea curentă (rezervări active)
    const today = new Date()
    const activeBookingsQuery = query(
      bookingsRef,
      where('startDate', '<=', today.toISOString().split('T')[0]),
      where('endDate', '>=', today.toISOString().split('T')[0]),
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed_pay_on_site'])
    )

    console.log('🔍 Dashboard occupancy check for date:', today.toISOString().split('T')[0])

    const activeBookingsSnap = await getDocs(activeBookingsQuery)
    console.log('📊 Dashboard active bookings found:', activeBookingsSnap.size)
    
    // Obține limita reală de rezervări pentru calcul corect
    const maxReservations = await getMaxTotalReservations()
    const currentOccupancy = Math.min((activeBookingsSnap.size / maxReservations) * 100, 100)

    return {
      totalRevenue,
      totalBookings,
      totalClients: uniqueClients.size,
      currentOccupancy: Math.round(currentOccupancy),
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
    // Obține limita maximă reală din configurație
    const totalSpots = await getMaxTotalReservations()
    
    // Folosește query-ul inteligent pentru ocuparea curentă
    const { getCurrentParkingOccupancy } = await import('./booking-utils')
    const currentOccupancy = await getCurrentParkingOccupancy()
    
    // Opțional: cleanup soft dacă e necesar
    const { softCleanupExpiredBookings } = await import('./booking-utils')
    const expiredCount = await softCleanupExpiredBookings()
    if (expiredCount > 0) {
      console.log(`🔄 Soft cleanup: marked ${expiredCount} expired bookings`)
    }
    
    const bookingsRef = collection(db, 'bookings')
    const now = new Date()
    const currentDateStr = now.toISOString().split('T')[0]
    const currentTimeStr = now.toTimeString().slice(0, 5)

    console.log('🔍 Checking occupancy for date:', currentDateStr, 'time:', currentTimeStr)

    // Query pentru rezervările REALMENTE active în acest moment
    const activeBookingsQuery = query(
      bookingsRef,
      where('startDate', '<=', currentDateStr),
      where('endDate', '>=', currentDateStr),
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site'])
    )

    const snapshot = await getDocs(activeBookingsQuery)
    
    // Filtrează rezervările care sunt REALMENTE active acum (incluzând ora)
    let reallyActiveBookings = 0
    const now_timestamp = now.getTime()
    
    snapshot.forEach(doc => {
      const booking = doc.data()
      const startDateTime = new Date(`${booking.startDate}T${booking.startTime}:00`)
      const endDateTime = new Date(`${booking.endDate}T${booking.endTime}:00`)
      
      // Verifică dacă rezervarea este activă chiar acum
      if (startDateTime.getTime() <= now_timestamp && endDateTime.getTime() > now_timestamp) {
        reallyActiveBookings++
        console.log('📋 Active booking now:', {
          id: doc.id,
          licensePlate: booking.licensePlate,
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
          status: booking.status
        })
      } else {
        console.log('⏰ Booking not currently active:', {
          id: doc.id,
          licensePlate: booking.licensePlate,
          start: startDateTime.toISOString(),
          end: endDateTime.toISOString(),
          status: booking.status,
          reason: startDateTime.getTime() > now_timestamp ? 'Not started yet' : 'Already ended'
        })
      }
    })

    const occupiedPercentage = Math.round((reallyActiveBookings / totalSpots) * 100)
    const freePercentage = 100 - occupiedPercentage

    console.log('📈 Real-time occupancy calculation:', {
      reallyActiveBookings,
      totalSpots,
      occupiedPercentage,
      freePercentage,
      currentDateTime: now.toISOString()
    })

    return [
      { name: 'Ocupat', value: occupiedPercentage },
      { name: 'Liber', value: freePercentage }
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

/**
 * Obține intrările (rezervările care încep) pentru o dată specifică
 */
export async function getDailyEntries(selectedDate: string): Promise<DailyEntryExit[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    
    // Query pentru rezervările care încep în data selectată
    const q = query(
      bookingsRef,
      where('startDate', '==', selectedDate),
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']),
      orderBy('startTime', 'asc')
    )

    const snapshot = await getDocs(q)
    const entries: DailyEntryExit[] = []

    snapshot.forEach(doc => {
      const booking = doc.data()
      // Determină sursa rezervării
      let source = booking.source || 'webhook'
      if (booking.status === 'confirmed_pay_on_site') {
        source = 'pay_on_site'
      }
      
      entries.push({
        id: doc.id,
        time: booking.startTime || 'N/A',
        licensePlate: booking.licensePlate || 'N/A',
        phone: booking.clientPhone || 'N/A',
        numberOfPersons: booking.numberOfPersons ? booking.numberOfPersons : 'N/A',
        source: source
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
export async function getDailyExits(selectedDate: string): Promise<DailyEntryExit[]> {
  try {
    const bookingsRef = collection(db, 'bookings')
    
    // Query pentru rezervările care se termină în data selectată
    const q = query(
      bookingsRef,
      where('endDate', '==', selectedDate),
      where('status', 'in', ['confirmed_paid', 'confirmed_test', 'confirmed', 'paid', 'confirmed_pay_on_site']),
      orderBy('endTime', 'asc')
    )

    const snapshot = await getDocs(q)
    const exits: DailyEntryExit[] = []

    snapshot.forEach(doc => {
      const booking = doc.data()
      // Determină sursa rezervării
      let source = booking.source || 'webhook'
      if (booking.status === 'confirmed_pay_on_site') {
        source = 'pay_on_site'
      }
      
      exits.push({
        id: doc.id,
        time: booking.endTime || 'N/A',
        licensePlate: booking.licensePlate || 'N/A',
        phone: booking.clientPhone || 'N/A',
        numberOfPersons: booking.numberOfPersons ? booking.numberOfPersons : 'N/A',
        source: source
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