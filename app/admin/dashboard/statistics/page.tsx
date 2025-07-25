"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { 
  Calendar, 
  Car, 
  Users, 
  ArrowRight, 
  ArrowLeft, 
  Clock, 
  AlertTriangle, 
  RefreshCw,
  MapPin,
  TrendingUp
} from "lucide-react"
import { 
  getDailyStatistics, 
  getExpiredReservations, 
  getDailyEntries, 
  getDailyExits,
  getMaxTotalReservations,
  type DailyStatistics,
  type ExpiredReservation,
  type DailyEntryExit 
} from "@/lib/admin-stats"

const COLORS = ["#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"]

export default function StatisticsPage() {
  const [isClient, setIsClient] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState('')
  
  // State pentru datele statisticilor
  const [dailyStats, setDailyStats] = useState<DailyStatistics>({
    date: '',
    availableSpots: 0,
    scheduledEntries: 0,
    actualEntries: 0,
    remainingEntries: 0,
    scheduledExits: 0,
    actualExits: 0,
    expiredReservations: 0
  })
  
  const [expiredReservations, setExpiredReservations] = useState<ExpiredReservation[]>([])
  const [scheduledEntries, setScheduledEntries] = useState<DailyEntryExit[]>([])
  const [scheduledExits, setScheduledExits] = useState<DailyEntryExit[]>([])
  const [maxTotalReservations, setMaxTotalReservations] = useState<number>(100)

  useEffect(() => {
    setIsClient(true)
    const today = new Date().toISOString().split('T')[0]
    setSelectedDate(today)
    
    // Încarcă limita maximă de rezervări
    getMaxTotalReservations().then(setMaxTotalReservations)
  }, [])

  useEffect(() => {
    if (isClient && selectedDate) {
      loadStatistics()
    }
  }, [isClient, selectedDate])

  const loadStatistics = async () => {
    try {
      setLoading(true)
      
      const [maxReservations, stats, expired, entries, exits] = await Promise.all([
        getMaxTotalReservations(),
        getDailyStatistics(selectedDate),
        getExpiredReservations(),
        getDailyEntries(selectedDate),
        getDailyExits(selectedDate)
      ])

      setMaxTotalReservations(maxReservations)
      setDailyStats(stats)
      setExpiredReservations(expired)
      setScheduledEntries(entries)
      setScheduledExits(exits)
      
    } catch (error) {
      console.error('Error loading statistics:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A'
    const date = new Date(dateStr)
    return date.toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    })
  }

  const getStatusBadge = (daysOverdue: number) => {
    if (daysOverdue >= 7) return 'bg-red-100 text-red-800'
    if (daysOverdue >= 3) return 'bg-orange-100 text-orange-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  const chartData = [
    { name: 'Intrări Programate', value: dailyStats.scheduledEntries },
    { name: 'Intrări Efectuate', value: dailyStats.actualEntries },
    { name: 'Intrări Rămase', value: dailyStats.remainingEntries },
  ]

  const occupancyChartData = [
    { name: 'Locuri Ocupate', value: 100 - dailyStats.availableSpots },
    { name: 'Locuri Disponibile', value: dailyStats.availableSpots },
  ]

  if (!isClient) {
    return null
  }

  if (loading && !selectedDate) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-tight">Statistici Detaliate</h1>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
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
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">Statistici Detaliate</h1>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="date">Selectează data:</Label>
            <Input
              id="date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-auto"
            />
          </div>
          <Button 
            onClick={loadStatistics} 
            disabled={loading}
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
          >
            <RefreshCw className={loading ? 'h-4 w-4 mr-2 animate-spin' : 'h-4 w-4 mr-2'} />
            {loading ? 'Se încarcă...' : 'Actualizează'}
          </Button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800">
          <Calendar className="inline h-4 w-4 mr-1" />
          Statistici pentru: <span className="font-medium">{formatDate(selectedDate)}</span>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6 md:mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Locuri Disponibile</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{dailyStats.availableSpots}</div>
            <p className="text-xs text-muted-foreground">din {maxTotalReservations} locuri total</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Intrări Programate</CardTitle>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{dailyStats.scheduledEntries}</div>
            <p className="text-xs text-muted-foreground">rezervări + manual</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Intrări Efectuate</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{dailyStats.actualEntries}</div>
            <p className="text-xs text-muted-foreground">din server + manual</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Intrări Rămase</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{dailyStats.remainingEntries}</div>
            <p className="text-xs text-muted-foreground">programate - efectuate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ieșiri Programate</CardTitle>
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{dailyStats.scheduledExits}</div>
            <p className="text-xs text-muted-foreground">din rezervări + manual</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ieșiri Efectuate</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-cyan-600">{dailyStats.actualExits}</div>
            <p className="text-xs text-muted-foreground">din server + manual</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rezervări Expirate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{dailyStats.expiredReservations}</div>
            <p className="text-xs text-muted-foreground">depășit termenul</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rata de Intrare</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-indigo-600">
              {dailyStats.scheduledEntries > 0 
                ? Math.round((dailyStats.actualEntries / dailyStats.scheduledEntries) * 100) 
                : 0}%
            </div>
            <p className="text-xs text-muted-foreground">efectuate din programate</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="charts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 mb-6 md:mb-4">
          <TabsTrigger value="charts">Grafice</TabsTrigger>
          <TabsTrigger value="entries">Intrări Detaliate</TabsTrigger>
          <TabsTrigger value="exits">Ieșiri Detaliate</TabsTrigger>
          <TabsTrigger value="expired">Rezervări Expirate</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="space-y-4 mt-6 md:mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Intrări - Programate vs Efectuate</CardTitle>
                <CardDescription>Comparația între intrările planificate și cele realizate</CardDescription>
              </CardHeader>
              <CardContent className="pl-2">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ocuparea Parcării</CardTitle>
                <CardDescription>Distribuția locurilor de parcare</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={occupancyChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={80}
                        dataKey="value"
                      >
                        {occupancyChartData.map((entry, index) => (
                          <Cell key={index} fill={index === 0 ? '#ef4444' : '#22c55e'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="entries" className="space-y-4 mt-6 md:mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Intrări Programate pentru {formatDate(selectedDate)}</CardTitle>
              <CardDescription>Lista completă a intrărilor programate din rezervări și manual</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {scheduledEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nu există intrări programate pentru această dată.</p>
                ) : (
                  scheduledEntries.map((entry) => (
                    <div key={entry.id} className="flex justify-between items-center p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium">{entry.licensePlate}</p>
                          {entry.source === 'manual' && (
                            <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-xs">
                              MANUAL
                            </Badge>
                          )}
                          {entry.source === 'pay_on_site' && (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">
                              PLATĂ LA PARCARE
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">Tel: {entry.phone}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{entry.time}</p>
                        <p className="text-xs text-muted-foreground">
                          {entry.source === 'manual' 
                            ? 'Intrare manuală' 
                            : entry.source === 'pay_on_site'
                            ? 'Plată la parcare'
                            : 'Din rezervare'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="exits" className="space-y-4 mt-6 md:mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Ieșiri Programate pentru {formatDate(selectedDate)}</CardTitle>
              <CardDescription>Lista completă a ieșirilor programate din rezervări și manual</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {scheduledExits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nu există ieșiri programate pentru această dată.</p>
                ) : (
                  scheduledExits.map((exit) => (
                    <div key={exit.id} className="flex justify-between items-center p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium">{exit.licensePlate}</p>
                          {exit.source === 'manual' && (
                            <Badge variant="secondary" className="bg-orange-100 text-orange-800 text-xs">
                              MANUAL
                            </Badge>
                          )}
                          {exit.source === 'pay_on_site' && (
                            <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">
                              PLATĂ LA PARCARE
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">Tel: {exit.phone}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{exit.time}</p>
                        <p className="text-xs text-muted-foreground">
                          {exit.source === 'manual' 
                            ? 'Ieșire manuală' 
                            : exit.source === 'pay_on_site'
                            ? 'Plată la parcare'
                            : 'Din rezervare'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expired" className="space-y-4 mt-6 md:mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Rezervări care au Depășit Termenul</CardTitle>
              <CardDescription>Rezervări care ar fi trebuit să se termine dar încă sunt active</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {expiredReservations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nu există rezervări expirate în acest moment.</p>
                ) : (
                  expiredReservations.map((reservation) => (
                    <div key={reservation.id} className="flex justify-between items-center p-3 border rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{reservation.licensePlate}</p>
                        <p className="text-xs text-muted-foreground">
                          {reservation.clientName} - {reservation.clientPhone}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm">
                          Sfârșit planificat: {formatDate(reservation.plannedEndDate)} {reservation.plannedEndTime}
                        </p>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(reservation.daysOverdue)}`}>
                          {reservation.daysOverdue} {reservation.daysOverdue === 1 ? 'zi' : 'zile'} întârziere
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
} 