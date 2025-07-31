"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  testCreateBooking,
  testCancelBooking,
  testApiConnectivity,
  testUpdateBooking,
} from "@/app/actions/test-api-actions"
import { normalizeLicensePlate } from "@/lib/utils"
import { CalendarIcon, Clock, AlertCircle, CheckCircle2, XCircle, Wifi, WifiOff } from "lucide-react"
import { format } from "date-fns"
import { ro } from "date-fns/locale"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { TimePickerDemo } from "@/components/time-picker"

export default function ApiTestPage() {
  // State pentru formularul de creare rezervare
  const [licensePlate, setLicensePlate] = useState("")
  const [startDate, setStartDate] = useState<Date>(new Date())
  const [startTime, setStartTime] = useState("08:30")
  const [durationMinutes, setDurationMinutes] = useState("120")
  const [clientName, setClientName] = useState("")
  const [clientTitle, setClientTitle] = useState("")

  // State pentru formularul de anulare rezervare
  const [bookingNumber, setBookingNumber] = useState("")

  // State pentru formularul de actualizare rezervare
  const [updateBookingNumber, setUpdateBookingNumber] = useState("")
  const [updateLicensePlate, setUpdateLicensePlate] = useState("")
  const [updateStartDate, setUpdateStartDate] = useState<Date>(new Date())
  const [updateStartTime, setUpdateStartTime] = useState("08:30")
  const [updateDurationMinutes, setUpdateDurationMinutes] = useState("120")
  const [updateClientName, setUpdateClientName] = useState("")
  const [updateClientTitle, setUpdateClientTitle] = useState("")

  // State pentru rezultate
  const [createResult, setCreateResult] = useState<any>(null)
  const [cancelResult, setCancelResult] = useState<any>(null)
  const [connectivityResult, setConnectivityResult] = useState<any>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  // State pentru rezultate
  const [updateResult, setUpdateResult] = useState<any>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  // Handler pentru testarea conectivității API
  const handleTestConnectivity = async () => {
    setIsTesting(true)
    setConnectivityResult(null)

    try {
      const result = await testApiConnectivity()
      setConnectivityResult(result)
    } catch (error) {
      console.error("Error testing API connectivity:", error)
      setConnectivityResult({
        success: false,
        message: error instanceof Error ? error.message : "Eroare necunoscută",
      })
    } finally {
      setIsTesting(false)
    }
  }

  // Handler pentru testarea creării unei rezervări
  const handleTestCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCreating(true)
    setCreateResult(null)

    try {
      const formData = new FormData()
      formData.append("licensePlate", licensePlate)
      // Asigură-te că data este formatată corect și nu este niciodată goală
      formData.append("startDate", startDate ? format(startDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"))
      formData.append("startTime", startTime)
      formData.append("durationMinutes", durationMinutes)
      formData.append("clientName", clientName)
      formData.append("clientTitle", clientTitle)

      const result = await testCreateBooking(formData)
      setCreateResult(result)

      // Dacă rezervarea a fost creată cu succes, completăm automat numărul de rezervare pentru anulare
      if (result.success && result.bookingNumber) {
        setBookingNumber(result.bookingNumber)
      }
    } catch (error) {
      console.error("Error testing create booking:", error)
      setCreateResult({
        success: false,
        message: error instanceof Error ? error.message : "Eroare necunoscută",
      })
    } finally {
      setIsCreating(false)
    }
  }

  // Handler pentru testarea anulării unei rezervări
  const handleTestCancel = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsCanceling(true)
    setCancelResult(null)

    try {
      const formData = new FormData()
      formData.append("bookingNumber", bookingNumber)

      const result = await testCancelBooking(formData)
      setCancelResult(result)
    } catch (error) {
      console.error("Error testing cancel booking:", error)
      setCancelResult({
        success: false,
        message: error instanceof Error ? error.message : "Eroare necunoscută",
      })
    } finally {
      setIsCanceling(false)
    }
  }

  // Handler pentru testarea actualizării unei rezervări
  const handleTestUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdating(true)
    setUpdateResult(null)

    try {
      const formData = new FormData()
      formData.append("bookingNumber", updateBookingNumber)
      formData.append("licensePlate", updateLicensePlate)
      formData.append(
        "startDate",
        updateStartDate ? format(updateStartDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
      )
      formData.append("startTime", updateStartTime)
      formData.append("durationMinutes", updateDurationMinutes)
      formData.append("clientName", updateClientName)
      formData.append("clientTitle", updateClientTitle)

      const result = await testUpdateBooking(formData)
      setUpdateResult(result)
    } catch (error) {
      console.error("Error testing update booking:", error)
      setUpdateResult({
        success: false,
        message: error instanceof Error ? error.message : "Eroare necunoscută",
      })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold tracking-tight">Test API Parcare</h1>
        <Button onClick={handleTestConnectivity} disabled={isTesting} variant="outline">
          {isTesting ? (
            <>Testare conectivitate...</>
          ) : (
            <>
              <Wifi className="mr-2 h-4 w-4" />
              Testează Conectivitatea API
            </>
          )}
        </Button>
      </div>

      {connectivityResult && (
        <Alert className={connectivityResult.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}>
          {connectivityResult.success ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-600" />
          )}
          <AlertTitle>
            {connectivityResult.success ? "Conectare reușită la API" : "Eroare de conectare la API"}
          </AlertTitle>
          <AlertDescription>
            {connectivityResult.message}
            {connectivityResult.details && (
              <div className="mt-2 text-sm">
                <strong>Detalii:</strong> {connectivityResult.details}
              </div>
            )}
            {connectivityResult.rawResponse && (
              <div className="mt-2">
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-gray-700">Vezi răspunsul complet</summary>
                  <pre className="mt-2 bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                    {connectivityResult.rawResponse}
                  </pre>
                </details>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="create" className="space-y-4">
        <TabsList>
          <TabsTrigger value="create">Testare Creare Rezervare</TabsTrigger>
          <TabsTrigger value="cancel">Testare Anulare Rezervare</TabsTrigger>
          <TabsTrigger value="update">Testare Actualizare Rezervare</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test Creare Rezervare</CardTitle>
              <CardDescription>Completează formularul pentru a testa crearea unei rezervări prin API.</CardDescription>
            </CardHeader>
            <CardContent>
              <form id="createForm" onSubmit={handleTestCreate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="licensePlate">Număr Înmatriculare*</Label>
                    <Input
                      id="licensePlate"
                      value={licensePlate}
                      onChange={(e) => setLicensePlate(normalizeLicensePlate(e.target.value))}
                      placeholder="Ex: B-123-ABC"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="durationMinutes">Durata (minute)*</Label>
                    <Input
                      id="durationMinutes"
                      type="number"
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(e.target.value)}
                      placeholder="Ex: 120"
                      min="1"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Data Intrare*</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal" type="button">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {startDate ? format(startDate, "PPP", { locale: ro }) : "Selectează data"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={startDate || new Date()}
                          onSelect={(date) => setStartDate(date || new Date())}
                          autoFocus
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label>Oră intrare*</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal" type="button">
                          <Clock className="mr-2 h-4 w-4" />
                          {startTime}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-4" align="start">
                        <div className="space-y-2">
                          <Label>Oră intrare</Label>
                          <TimePickerDemo value={startTime} onChange={setStartTime} />
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="clientTitle">Titlu Client (opțional)</Label>
                    <Input
                      id="clientTitle"
                      value={clientTitle}
                      onChange={(e) => setClientTitle(e.target.value)}
                      placeholder="Ex: Dl., Dna."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="clientName">Nume Client (opțional)</Label>
                    <Input
                      id="clientName"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="Ex: Ion Popescu"
                    />
                  </div>
                </div>
              </form>
            </CardContent>
            <CardFooter>
              <Button type="submit" form="createForm" disabled={isCreating}>
                {isCreating ? "Se procesează..." : "Testează Creare Rezervare"}
              </Button>
            </CardFooter>
          </Card>

          {createResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  {createResult.success ? (
                    <>
                      <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
                      Rezervare Creată cu Succes
                    </>
                  ) : (
                    <>
                      <XCircle className="mr-2 h-5 w-5 text-red-500" />
                      Eroare la Crearea Rezervării
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-medium mb-2">Detalii Răspuns</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Status:</span>
                        <span
                          className={createResult.success ? "text-green-600 font-medium" : "text-red-600 font-medium"}
                        >
                          {createResult.success ? "Succes" : "Eroare"}
                        </span>
                      </div>
                      {createResult.statusCode && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cod HTTP:</span>
                          <span>{createResult.statusCode}</span>
                        </div>
                      )}
                      {createResult.errorCode && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cod Eroare API:</span>
                          <span>{createResult.errorCode}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Mesaj:</span>
                        <span className="text-right">{createResult.message}</span>
                      </div>
                      {createResult.details && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Detalii:</span>
                          <span className="text-right">{createResult.details}</span>
                        </div>
                      )}
                      {createResult.bookingNumber && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Număr Rezervare:</span>
                          <span className="font-bold">{createResult.bookingNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {createResult.requestPayload && (
                    <div>
                      <h3 className="font-medium mb-2">Request XML</h3>
                      <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                        {createResult.requestPayload}
                      </pre>
                    </div>
                  )}
                </div>

                {createResult.rawResponse && (
                  <div>
                    <h3 className="font-medium mb-2">Răspuns Complet</h3>
                    <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                      {createResult.rawResponse}
                    </pre>
                  </div>
                )}

                {createResult.success && createResult.bookingNumber && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                    <AlertTitle>Rezervare creată cu succes!</AlertTitle>
                    <AlertDescription>
                      Numărul de rezervare <strong>{createResult.bookingNumber}</strong> a fost completat automat în
                      tab-ul de anulare pentru testare.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="cancel" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test Anulare Rezervare</CardTitle>
              <CardDescription>Completează formularul pentru a testa anularea unei rezervări prin API.</CardDescription>
            </CardHeader>
            <CardContent>
              <form id="cancelForm" onSubmit={handleTestCancel} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bookingNumber">Număr Rezervare*</Label>
                  <Input
                    id="bookingNumber"
                    value={bookingNumber}
                    onChange={(e) => setBookingNumber(e.target.value)}
                    placeholder="Ex: 123456"
                    required
                  />
                </div>
              </form>
            </CardContent>
            <CardFooter>
              <Button type="submit" form="cancelForm" disabled={isCanceling}>
                {isCanceling ? "Se procesează..." : "Testează Anulare Rezervare"}
              </Button>
            </CardFooter>
          </Card>

          {cancelResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  {cancelResult.success ? (
                    <>
                      <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
                      Rezervare Anulată cu Succes
                    </>
                  ) : (
                    <>
                      <XCircle className="mr-2 h-5 w-5 text-red-500" />
                      Eroare la Anularea Rezervării
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-medium mb-2">Detalii Răspuns</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Status:</span>
                        <span
                          className={cancelResult.success ? "text-green-600 font-medium" : "text-red-600 font-medium"}
                        >
                          {cancelResult.success ? "Succes" : "Eroare"}
                        </span>
                      </div>
                      {cancelResult.statusCode && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cod HTTP:</span>
                          <span>{cancelResult.statusCode}</span>
                        </div>
                      )}
                      {cancelResult.errorCode && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cod Eroare API:</span>
                          <span>{cancelResult.errorCode}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Mesaj:</span>
                        <span className="text-right">{cancelResult.message}</span>
                      </div>
                      {cancelResult.details && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Detalii:</span>
                          <span className="text-right">{cancelResult.details}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {cancelResult.requestPayload && (
                    <div>
                      <h3 className="font-medium mb-2">Request XML</h3>
                      <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                        {cancelResult.requestPayload}
                      </pre>
                    </div>
                  )}
                </div>

                {cancelResult.rawResponse && (
                  <div>
                    <h3 className="font-medium mb-2">Răspuns Complet</h3>
                    <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                      {cancelResult.rawResponse}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="update" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test Actualizare Rezervare</CardTitle>
              <CardDescription>
                Completează formularul pentru a testa actualizarea unei rezervări existente prin API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form id="updateForm" onSubmit={handleTestUpdate} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="updateBookingNumber">Număr Rezervare*</Label>
                    <Input
                      id="updateBookingNumber"
                      value={updateBookingNumber}
                      onChange={(e) => setUpdateBookingNumber(e.target.value)}
                      placeholder="Ex: 123456"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="updateLicensePlate">Număr Înmatriculare</Label>
                    <Input
                      id="updateLicensePlate"
                      value={updateLicensePlate}
                      onChange={(e) => setUpdateLicensePlate(normalizeLicensePlate(e.target.value))}
                      placeholder="Ex: B-123-ABC"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Data Intrare*</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal" type="button">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {updateStartDate ? format(updateStartDate, "PPP", { locale: ro }) : "Selectează data"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={updateStartDate || new Date()}
                          onSelect={(date) => setUpdateStartDate(date || new Date())}
                          autoFocus
                          disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label>Oră intrare*</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal" type="button">
                          <Clock className="mr-2 h-4 w-4" />
                          {updateStartTime}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-4" align="start">
                        <div className="space-y-2">
                          <Label>Oră intrare</Label>
                          <TimePickerDemo value={updateStartTime} onChange={setUpdateStartTime} />
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="updateDurationMinutes">Durata (minute)*</Label>
                    <Input
                      id="updateDurationMinutes"
                      type="number"
                      value={updateDurationMinutes}
                      onChange={(e) => setUpdateDurationMinutes(e.target.value)}
                      placeholder="Ex: 120"
                      min="1"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="updateClientTitle">Titlu Client (opțional)</Label>
                    <Input
                      id="updateClientTitle"
                      value={updateClientTitle}
                      onChange={(e) => setUpdateClientTitle(e.target.value)}
                      placeholder="Ex: Dl., Dna."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="updateClientName">Nume Client (opțional)</Label>
                    <Input
                      id="updateClientName"
                      value={updateClientName}
                      onChange={(e) => setUpdateClientName(e.target.value)}
                      placeholder="Ex: Ion Popescu"
                    />
                  </div>
                </div>
              </form>
            </CardContent>
            <CardFooter>
              <Button type="submit" form="updateForm" disabled={isUpdating}>
                {isUpdating ? "Se procesează..." : "Testează Actualizare Rezervare"}
              </Button>
            </CardFooter>
          </Card>

          {updateResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  {updateResult.success ? (
                    <>
                      <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
                      Rezervare Actualizată cu Succes
                    </>
                  ) : (
                    <>
                      <XCircle className="mr-2 h-5 w-5 text-red-500" />
                      Eroare la Actualizarea Rezervării
                    </>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-medium mb-2">Detalii Răspuns</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Status:</span>
                        <span
                          className={updateResult.success ? "text-green-600 font-medium" : "text-red-600 font-medium"}
                        >
                          {updateResult.success ? "Succes" : "Eroare"}
                        </span>
                      </div>
                      {updateResult.statusCode && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cod HTTP:</span>
                          <span>{updateResult.statusCode}</span>
                        </div>
                      )}
                      {updateResult.errorCode && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Cod Eroare API:</span>
                          <span>{updateResult.errorCode}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Mesaj:</span>
                        <span className="text-right">{updateResult.message}</span>
                      </div>
                      {updateResult.details && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Detalii:</span>
                          <span className="text-right">{updateResult.details}</span>
                        </div>
                      )}
                      {updateResult.bookingNumber && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Număr Rezervare:</span>
                          <span className="font-bold">{updateResult.bookingNumber}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {updateResult.requestPayload && (
                    <div>
                      <h3 className="font-medium mb-2">Request XML</h3>
                      <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                        {updateResult.requestPayload}
                      </pre>
                    </div>
                  )}
                </div>

                {updateResult.rawResponse && (
                  <div>
                    <h3 className="font-medium mb-2">Răspuns Complet</h3>
                    <pre className="bg-gray-100 p-2 rounded-md text-xs overflow-auto max-h-40">
                      {updateResult.rawResponse}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Informații Diagnosticare</CardTitle>
          <CardDescription>Informații utile pentru diagnosticarea problemelor de conectare la API.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium mb-2">Configurare API</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">URL API:</span>
                  <span className="text-right font-mono text-sm">
                    {process.env.NEXT_PUBLIC_PARKING_API_URL ||
                      "http://89.45.23.61:7001/MultiparkWeb_eServices/booking_submit"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Multipark ID:</span>
                  <span className="text-right font-mono text-sm">
                    {process.env.NEXT_PUBLIC_PARKING_MULTIPARK_ID || "001#002"}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Probleme Comune</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>Serverul API nu este disponibil sau nu răspunde</li>
                <li>Portul 7001 nu este deschis sau este blocat</li>
                <li>Există restricții de firewall pe serverul API</li>
                <li>Adresa IP sau portul sunt incorecte</li>
                <li>Rezervarea nu există pentru actualizare</li>
              </ul>
            </div>
          </div>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertTitle>Sugestie</AlertTitle>
            <AlertDescription>
              Contactează furnizorul API-ului pentru a verifica dacă serverul este funcțional și dacă adresa IP și
              portul sunt corecte. De asemenea, solicită-i să verifice dacă există restricții de firewall care ar putea
              bloca conexiunile de la Vercel.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}
