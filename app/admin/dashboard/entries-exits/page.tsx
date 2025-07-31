"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { RefreshCw, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  getDailyEntries,
  getDailyExits,
  type DailyEntryExit
} from "@/lib/admin-stats"

export default function EntriesExitsPage() {
  const [isClient, setIsClient] = useState(false)
  
  // State pentru intrări/ieșiri
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date()
    return today.toISOString().split('T')[0] // YYYY-MM-DD format
  })
  const [dailyEntries, setDailyEntries] = useState<DailyEntryExit[]>([])
  const [dailyExits, setDailyExits] = useState<DailyEntryExit[]>([])
  const [loadingDailyStats, setLoadingDailyStats] = useState(false)
  
  // State pentru filtrarea pe client
  const [hidePastTimes, setHidePastTimes] = useState(true)
  const [currentTime, setCurrentTime] = useState("")

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (isClient && selectedDate) {
      loadDailyStats(selectedDate)
    }
  }, [isClient, selectedDate])

  // Actualizează ora curentă la fiecare minut
  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date()
      setCurrentTime(now.toTimeString().slice(0, 5)) // HH:mm
    }

    updateCurrentTime() // Setează ora inițială
    const interval = setInterval(updateCurrentTime, 60000) // Actualizează la fiecare minut

    return () => clearInterval(interval)
  }, [])

  const loadDailyStats = async (date: string) => {
    try {
      setLoadingDailyStats(true)
      
      // Încarcă intrările și ieșirile în paralel
      const [entries, exits] = await Promise.all([
        getDailyEntries(date),
        getDailyExits(date)
      ])

      setDailyEntries(entries)
      setDailyExits(exits)
      
    } catch (error) {
      console.error('Error loading daily stats:', error)
      setDailyEntries([])
      setDailyExits([])
    } finally {
      setLoadingDailyStats(false)
    }
  }

  // Funcție pentru filtrarea intrărilor pe baza orei curente
  const getFilteredEntries = () => {
    if (!hidePastTimes) return dailyEntries
    
    const today = new Date().toISOString().split('T')[0]
    if (selectedDate !== today) return dailyEntries // Doar pentru ziua curentă
    
    return dailyEntries.filter(entry => {
      if (entry.time === 'N/A') return true
      return entry.time >= currentTime
    })
  }

  // Funcție pentru filtrarea ieșirilor pe baza orei curente
  const getFilteredExits = () => {
    if (!hidePastTimes) return dailyExits
    
    const today = new Date().toISOString().split('T')[0]
    if (selectedDate !== today) return dailyExits // Doar pentru ziua curentă
    
    return dailyExits.filter(exit => {
      if (exit.time === 'N/A') return true
      return exit.time >= currentTime
    })
  }

  const filteredEntries = getFilteredEntries()
  const filteredExits = getFilteredExits()

  if (!isClient) {
    return null
  }

  const isToday = selectedDate === new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Intrări/Ieșiri</h1>
          <p className="text-muted-foreground">
            Statistici detaliate pentru intrările și ieșirile pe data selectată
          </p>
        </div>
        <Button 
          onClick={() => loadDailyStats(selectedDate)} 
          disabled={loadingDailyStats}
          variant="outline"
          size="sm"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loadingDailyStats ? 'animate-spin' : ''}`} />
          {loadingDailyStats ? 'Se încarcă...' : 'Actualizează'}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div>
            <label htmlFor="date-select" className="block text-sm font-medium text-gray-700 mb-2">
              Selectează data:
            </label>
            <input
              id="date-select"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary date-input-dd-mm-yyyy"
            />
          </div>
          
          {/* Toggle pentru ascunderea trecutelor */}
          {isToday && (
            <div className="flex items-center space-x-3 bg-blue-50 p-3 rounded-lg border border-blue-200">
              <Clock className="h-4 w-4 text-blue-600" />
              <div className="flex items-center space-x-2">
                <Switch
                  id="hide-past-times"
                  checked={hidePastTimes}
                  onCheckedChange={setHidePastTimes}
                />
                <Label htmlFor="hide-past-times" className="text-sm font-medium text-blue-700">
                  Ascunde orele trecute
                </Label>
              </div>
              <div className="text-xs text-blue-600 font-mono">
                Ora curentă: {currentTime}
              </div>
            </div>
          )}
          
          {loadingDailyStats && (
            <div className="text-sm text-gray-500">Se încarcă...</div>
          )}
        </div>
        
        {/* Afișează numărul de rezervări filtrate */}
        {isToday && hidePastTimes && (dailyEntries.length !== filteredEntries.length || dailyExits.length !== filteredExits.length) && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-yellow-700 font-medium">
                Filtrare activă: Se afișează doar orele viitoare
              </span>
            </div>
            <div className="text-xs text-yellow-600 mt-1">
              Intrări: {filteredEntries.length}/{dailyEntries.length} • 
              Ieșiri: {filteredExits.length}/{dailyExits.length}
            </div>
          </div>
        )}
        
        {/* Desktop Layout - Side by Side */}
        <div className="hidden lg:grid gap-6 lg:grid-cols-2">
          {/* Tabelul pentru intrări */}
          <Card>
            <CardHeader>
              <CardTitle className="text-green-600">
                INTRĂRI {isToday && hidePastTimes && `(${filteredEntries.length}/${dailyEntries.length})`}
              </CardTitle>
              <CardDescription>
                Rezervări care încep în data de {new Date(selectedDate).toLocaleDateString('ro-RO')}
                {isToday && hidePastTimes && " - doar orele viitoare"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredEntries.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  {isToday && hidePastTimes && dailyEntries.length > 0 
                    ? "Nu există intrări pentru orele viitoare." 
                    : "Nu există intrări pentru această dată."
                  }
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-medium text-gray-700">ORA</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-700">NR ÎNMATRICULARE</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-700">TEL</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-700">NR PERSOANE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((entry) => (
                        <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-2 font-medium">
                            <span className={isToday && entry.time < currentTime ? "text-gray-400 line-through" : ""}>
                              {entry.time}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              {entry.source === "manual" && (
                                <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                                  MANUAL
                                </Badge>
                              )}
                              {entry.source === "pay_on_site" && (
                                <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                                  PLATĂ LA PARCARE
                                </Badge>
                              )}
                              {entry.licensePlate}
                            </div>
                          </td>
                          <td className="py-3 px-2">{entry.phone}</td>
                          <td className="py-3 px-2 text-center">{entry.numberOfPersons}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tabelul pentru ieșiri */}
          <Card>
            <CardHeader>
              <CardTitle className="text-red-600">
                IEȘIRI {isToday && hidePastTimes && `(${filteredExits.length}/${dailyExits.length})`}
              </CardTitle>
              <CardDescription>
                Rezervări care se termină în data de {new Date(selectedDate).toLocaleDateString('ro-RO')}
                {isToday && hidePastTimes && " - doar orele viitoare"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredExits.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  {isToday && hidePastTimes && dailyExits.length > 0 
                    ? "Nu există ieșiri pentru orele viitoare." 
                    : "Nu există ieșiri pentru această dată."
                  }
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-2 px-2 font-medium text-gray-700">ORA</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-700">NR ÎNMATRICULARE</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-700">TEL</th>
                        <th className="text-left py-2 px-2 font-medium text-gray-700">NR PERSOANE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredExits.map((exit) => (
                        <tr key={exit.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-3 px-2 font-medium">
                            <span className={isToday && exit.time < currentTime ? "text-gray-400 line-through" : ""}>
                              {exit.time}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2">
                              {exit.source === "manual" && (
                                <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                                  MANUAL
                                </Badge>
                              )}
                              {exit.source === "pay_on_site" && (
                                <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                                  PLATĂ LA PARCARE
                                </Badge>
                              )}
                              {exit.licensePlate}
                            </div>
                          </td>
                          <td className="py-3 px-2">{exit.phone}</td>
                          <td className="py-3 px-2 text-center">{exit.numberOfPersons}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Mobile & Tablet Layout - Tabs */}
        <div className="lg:hidden">
          <Tabs defaultValue="entries" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="entries" className="text-green-700 data-[state=active]:bg-green-100 data-[state=active]:text-green-800">
                INTRĂRI ({filteredEntries.length})
              </TabsTrigger>
              <TabsTrigger value="exits" className="text-red-700 data-[state=active]:bg-red-100 data-[state=active]:text-red-800">
                IEȘIRI ({filteredExits.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="entries" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-green-600">
                    INTRĂRI {isToday && hidePastTimes && `(${filteredEntries.length}/${dailyEntries.length})`}
                  </CardTitle>
                  <CardDescription>
                    Rezervări care încep în data de {new Date(selectedDate).toLocaleDateString('ro-RO')}
                    {isToday && hidePastTimes && " - doar orele viitoare"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {filteredEntries.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                      {isToday && hidePastTimes && dailyEntries.length > 0 
                        ? "Nu există intrări pentru orele viitoare." 
                        : "Nu există intrări pentru această dată."
                      }
                    </p>
                  ) : (
                    <>
                      {/* Tablet Table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-2 font-medium text-gray-700">ORA</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-700">NR ÎNMATRICULARE</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-700">TEL</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-700">NR PERSOANE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredEntries.map((entry) => (
                              <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="py-3 px-2 font-medium">
                                  <span className={isToday && entry.time < currentTime ? "text-gray-400 line-through" : ""}>
                                    {entry.time}
                                  </span>
                                </td>
                                <td className="py-3 px-2">
                                  <div className="flex items-center gap-2">
                                    {entry.source === "manual" && (
                                      <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                                        MANUAL
                                      </Badge>
                                    )}
                                    {entry.source === "pay_on_site" && (
                                      <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                                        PLATĂ LA PARCARE
                                      </Badge>
                                    )}
                                    {entry.licensePlate}
                                  </div>
                                </td>
                                <td className="py-3 px-2">{entry.phone}</td>
                                <td className="py-3 px-2 text-center">{entry.numberOfPersons}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-3">
                        {filteredEntries.map((entry) => (
                          <div key={entry.id} className="bg-green-50 border border-green-200 rounded-lg p-4 hover:bg-green-100 transition-colors">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center space-x-2">
                                <span className={`text-2xl font-bold text-green-700 ${isToday && entry.time < currentTime ? "text-gray-400 line-through" : ""}`}>
                                  {entry.time}
                                </span>
                                <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                              </div>
                              <span className="bg-green-600 text-white text-xs font-medium px-2 py-1 rounded-full">
                                {entry.numberOfPersons} pers.
                              </span>
                            </div>
                            <div className="space-y-2">
                              {/* Badge-uri pe rând separat */}
                              {(entry.source === "manual" || entry.source === "pay_on_site") && (
                                <div className="flex justify-end">
                                  {entry.source === "manual" && (
                                    <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                                      MANUAL
                                    </Badge>
                                  )}
                                  {entry.source === "pay_on_site" && (
                                    <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                                      PLATĂ LA PARCARE
                                    </Badge>
                                  )}
                                </div>
                              )}
                              {/* Număr auto pe rând separat */}
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-green-600 font-medium uppercase tracking-wide">Număr auto</span>
                                <span className="font-semibold text-gray-900">{entry.licensePlate}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-green-600 font-medium uppercase tracking-wide">Telefon</span>
                                <span className="text-gray-700">{entry.phone}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="exits" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-red-600">
                    IEȘIRI {isToday && hidePastTimes && `(${filteredExits.length}/${dailyExits.length})`}
                  </CardTitle>
                  <CardDescription>
                    Rezervări care se termină în data de {new Date(selectedDate).toLocaleDateString('ro-RO')}
                    {isToday && hidePastTimes && " - doar orele viitoare"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {filteredExits.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">
                      {isToday && hidePastTimes && dailyExits.length > 0 
                        ? "Nu există ieșiri pentru orele viitoare." 
                        : "Nu există ieșiri pentru această dată."
                      }
                    </p>
                  ) : (
                    <>
                      {/* Tablet Table */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-200">
                              <th className="text-left py-2 px-2 font-medium text-gray-700">ORA</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-700">NR ÎNMATRICULARE</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-700">TEL</th>
                              <th className="text-left py-2 px-2 font-medium text-gray-700">NR PERSOANE</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredExits.map((exit) => (
                              <tr key={exit.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="py-3 px-2 font-medium">
                                  <span className={isToday && exit.time < currentTime ? "text-gray-400 line-through" : ""}>
                                    {exit.time}
                                  </span>
                                </td>
                                <td className="py-3 px-2">
                                  <div className="flex items-center gap-2">
                                    {exit.source === "manual" && (
                                      <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                                        MANUAL
                                      </Badge>
                                    )}
                                    {exit.source === "pay_on_site" && (
                                      <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                                        PLATĂ LA PARCARE
                                      </Badge>
                                    )}
                                    {exit.licensePlate}
                                  </div>
                                </td>
                                <td className="py-3 px-2">{exit.phone}</td>
                                <td className="py-3 px-2 text-center">{exit.numberOfPersons}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards */}
                      <div className="md:hidden space-y-3">
                        {filteredExits.map((exit) => (
                          <div key={exit.id} className="bg-red-50 border border-red-200 rounded-lg p-4 hover:bg-red-100 transition-colors">
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center space-x-2">
                                <span className={`text-2xl font-bold text-red-700 ${isToday && exit.time < currentTime ? "text-gray-400 line-through" : ""}`}>
                                  {exit.time}
                                </span>
                                <div className="h-2 w-2 bg-red-500 rounded-full"></div>
                              </div>
                              <span className="bg-red-600 text-white text-xs font-medium px-2 py-1 rounded-full">
                                {exit.numberOfPersons} pers.
                              </span>
                            </div>
                            <div className="space-y-2">
                              {/* Badge-uri pe rând separat */}
                              {(exit.source === "manual" || exit.source === "pay_on_site") && (
                                <div className="flex justify-end">
                                  {exit.source === "manual" && (
                                    <Badge variant="outline" className="text-pink-700 border-pink-400 bg-pink-100 text-xs">
                                      MANUAL
                                    </Badge>
                                  )}
                                  {exit.source === "pay_on_site" && (
                                    <Badge variant="outline" className="text-orange-700 border-orange-400 bg-orange-100 text-xs">
                                      PLATĂ LA PARCARE
                                    </Badge>
                                  )}
                                </div>
                              )}
                              {/* Număr auto pe rând separat */}
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-red-600 font-medium uppercase tracking-wide">Număr auto</span>
                                <span className="font-semibold text-gray-900">{exit.licensePlate}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-red-600 font-medium uppercase tracking-wide">Telefon</span>
                                <span className="text-gray-700">{exit.phone}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
} 