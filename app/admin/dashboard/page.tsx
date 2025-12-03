"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { Calendar, Car, CreditCard, Users, RefreshCw } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReservationLimitManager } from "@/components/admin/reservation-limit-manager"
import {
  getDashboardStats,
  getMonthlyRevenueData,
  getMonthlyBookingsData,
  getBookingStatusData,
  getOccupancyData,
  getRecentBookings,
  type DashboardStats,
  type MonthlyStats,
  type BookingStatusStats,
  type OccupancyStats,
  type RecentBooking,
  getPresentVehicles
} from "@/lib/admin-stats"
import { Button } from "@/components/ui/button"

const COLORS = ["#22c55e", "#e5e7eb"]
const STATUS_COLORS = ["#22c55e", "#f59e0b", "#ef4444"]

export default function DashboardPage() {
  const [isClient, setIsClient] = useState(false)
  const [loading, setLoading] = useState(true)
  
  // State pentru toate datele
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalRevenue: 0,
    totalBookings: 0,
    totalClients: 0,
    currentOccupancy: 0,
    revenueGrowth: '0%',
    bookingsGrowth: '0%',
    clientsGrowth: '0%'
  })
  
  const [revenueData, setRevenueData] = useState<MonthlyStats[]>([])
  const [bookingsData, setBookingsData] = useState<MonthlyStats[]>([])
  const [bookingStatusData, setBookingStatusData] = useState<BookingStatusStats[]>([])
  const [occupancyData, setOccupancyData] = useState<OccupancyStats[]>([])
  const [recentBookings, setRecentBookings] = useState<RecentBooking[]>([])
  const [presentVehicles, setPresentVehicles] = useState<any[]>([])
  const [presentCount, setPresentCount] = useState(0)
  const [delayedCount, setDelayedCount] = useState(0)

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (isClient) {
      loadAllData()
    }
  }, [isClient])

  const loadAllData = async () => {
    try {
      setLoading(true)
      
      // Încarcă toate datele în paralel
      const [
        stats,
        monthlyRevenue,
        monthlyBookings,
        statusData,
        occupancy,
        recent,
        present
      ] = await Promise.all([
        getDashboardStats(),
        getMonthlyRevenueData(),
        getMonthlyBookingsData(),
        getBookingStatusData(),
        getOccupancyData(),
        getRecentBookings(),
        getPresentVehicles()
      ])

      setDashboardStats(stats)
      setRevenueData(monthlyRevenue)
      setBookingsData(monthlyBookings)
      setBookingStatusData(statusData)
      setOccupancyData(occupancy)
      setRecentBookings(recent)
      setPresentVehicles(present.items)
      setPresentCount(present.presentCount)
      setDelayedCount(present.delayedCount)
      
    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }



  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency: 'RON',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount)
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A'
    const date = new Date(dateStr)
    return date.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'confirmed':
      case 'paid':
        return 'Confirmată'
      case 'cancelled':
        return 'Anulată'
      default:
        return 'În așteptare'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed':
      case 'paid':
        return 'text-green-600'
      case 'cancelled':
        return 'text-red-600'
      default:
        return 'text-yellow-600'
    }
  }

  if (!isClient) {
    return null
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
                <div className="h-4 w-4 bg-gray-200 rounded animate-pulse"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-24 bg-gray-200 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <Button 
          onClick={loadAllData} 
          disabled={loading}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Se încarcă...' : 'Actualizează'}
        </Button>
      </div>

      <ReservationLimitManager />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Venit Total</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboardStats.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">
              {dashboardStats.revenueGrowth.startsWith('-') ? '' : '+'}
              {dashboardStats.revenueGrowth} față de anul trecut
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rezervări</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats.totalBookings.toLocaleString('ro-RO')}</div>
            <p className="text-xs text-muted-foreground">
              {dashboardStats.bookingsGrowth.startsWith('-') ? '' : '+'}
              {dashboardStats.bookingsGrowth} față de anul trecut
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Clienți</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats.totalClients.toLocaleString('ro-RO')}</div>
            <p className="text-xs text-muted-foreground">
              {dashboardStats.clientsGrowth.startsWith('-') ? '' : '+'}
              {dashboardStats.clientsGrowth} față de anul trecut
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ocupare Curentă</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats.currentOccupancy}%</div>
            <p className="text-xs text-muted-foreground">{dashboardStats.currentOccupancy} din 100 locuri ocupate</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prezenți (LPR)</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{presentCount}</div>
            <p className="text-xs text-muted-foreground">
              Întârziați: {delayedCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Venituri</TabsTrigger>
          <TabsTrigger value="bookings">Rezervări</TabsTrigger>
          <TabsTrigger value="occupancy">Ocupare</TabsTrigger>
          <TabsTrigger value="presence">Prezenți (LPR)</TabsTrigger>
        </TabsList>
        <TabsContent value="revenue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Venituri Lunare</CardTitle>
              <CardDescription>Veniturile totale pe fiecare lună din anul curent</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${formatCurrency(Number(value))}`, "Venit"]} />
                    <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="bookings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Rezervări Lunare</CardTitle>
              <CardDescription>Numărul de rezervări pe fiecare lună din anul curent</CardDescription>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bookingsData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${value}`, "Rezervări"]} />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Status Rezervări</CardTitle>
                <CardDescription>Distribuția rezervărilor după status</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={bookingStatusData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {bookingStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value}%`, ""]} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Rezervări Recente</CardTitle>
                <CardDescription>Ultimele {recentBookings.length} rezervări efectuate</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentBookings.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nu există rezervări recente.</p>
                  ) : (
                    recentBookings.map((booking) => (
                      <div key={booking.id} className="flex justify-between items-center">
                        <div>
                          <p className="text-sm font-medium">{booking.licensePlate}</p>
                          <p className="text-xs text-muted-foreground">{booking.clientName}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm">
                            {formatDate(booking.startDate)} - {formatDate(booking.endDate)}
                          </p>
                          <p className={`text-xs ${getStatusColor(booking.status)}`}>
                            {getStatusLabel(booking.status)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="occupancy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Ocupare Curentă</CardTitle>
              <CardDescription>Distribuția locurilor de parcare la momentul actual</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={occupancyData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {occupancyData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value}%`, ""]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="presence" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Prezenți în parcare</CardTitle>
                <CardDescription>Lista vehiculelor detectate ca fiind în incintă</CardDescription>
              </div>
              <div className="flex gap-2 mt-2 md:mt-0">
                <Button variant="outline" size="sm" onClick={() => window.print()}>
                  Printează listă
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const header = ['Număr', 'Sursă', 'Status', 'Sosit', 'Interval planificat', 'Întârziat', 'Tip']
                    const rows = presentVehicles.map((v) => {
                      const interval = v.startDate && v.startTime && v.endDate && v.endTime
                        ? `${v.startDate} ${v.startTime} - ${v.endDate} ${v.endTime}`
                        : ''
                      return [
                        v.licensePlate,
                        v.source,
                        v.status,
                        v.arrivedAt || '',
                        interval,
                        v.isDelayed ? 'DA' : 'NU',
                        v.isUnmatched ? 'NEPROGRAMAT' : 'REZERVARE'
                      ]
                    })
                    const csv = [header, ...rows].map(r => r.map(x => `"${(x ?? '').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = `prezenti_lpr_${new Date().toISOString().slice(0,10)}.csv`
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-2 pr-4">Număr</th>
                      <th className="py-2 pr-4">Sursă</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Sosit</th>
                      <th className="py-2 pr-4">Interval planificat</th>
                      <th className="py-2 pr-4">Întârziat</th>
                      <th className="py-2 pr-4">Tip</th>
                    </tr>
                  </thead>
                  <tbody>
                    {presentVehicles.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-muted-foreground">
                          Nicio mașină prezentă în acest moment.
                        </td>
                      </tr>
                    ) : (
                      presentVehicles.map((v, idx) => {
                        const interval = v.startDate && v.startTime && v.endDate && v.endTime
                          ? `${v.startDate} ${v.startTime} → ${v.endDate} ${v.endTime}`
                          : '-'
                        return (
                          <tr key={v.id || idx} className="border-t">
                            <td className="py-2 pr-4 font-medium">{v.licensePlate}</td>
                            <td className="py-2 pr-4">{v.source}</td>
                            <td className="py-2 pr-4">{v.status}</td>
                            <td className="py-2 pr-4">{v.arrivedAt ? new Date(v.arrivedAt).toLocaleString('ro-RO') : '-'}</td>
                            <td className="py-2 pr-4">{interval}</td>
                            <td className={`py-2 pr-4 ${v.isDelayed ? 'text-red-600 font-semibold' : ''}`}>{v.isDelayed ? 'DA' : 'NU'}</td>
                            <td className="py-2 pr-4">{v.isUnmatched ? 'NEPROGRAMAT' : 'REZERVARE'}</td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
