"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Info, Loader2, RefreshCw } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import type { ForecastResult, OccupancyForecastInput, OccupancyForecastResponse } from "@/lib/occupancy-forecast-contract"
import { OccupancyForecastDetails, forecastIntervalLabel } from "./occupancy-forecast-details"

function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function initialForecastInput(): OccupancyForecastInput {
  const today = new Date()
  const start = new Date(today); start.setDate(start.getDate() + 1); start.setSeconds(0, 0)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  const last = new Date(today); last.setDate(last.getDate() + 31)
  const time = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  return { from: localDate(start), to: localDate(last), simulator: {
    startDate: localDate(start), startTime: time(start), endDate: localDate(end), endTime: time(end),
  } }
}

export function OccupancyForecast() {
  const { user } = useAuth()
  const [initialInput] = useState(initialForecastInput)
  const [input, setInput] = useState(initialInput)
  const [response, setResponse] = useState<OccupancyForecastResponse | null>(null)
  const [selected, setSelected] = useState<ForecastResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const reload = useCallback(async (submitted: OccupancyForecastInput) => {
    const id = ++requestId.current
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setSelected(null); setResponse(null); setLoading(true); setError(null)
    try {
      const res = await adminAuthorizedFetch("/api/admin/occupancy-forecast", user, {
        method: "POST", body: JSON.stringify(submitted), cache: "no-store", signal: abort.signal,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || "Calcul indisponibil")
      if (id === requestId.current) setResponse(body)
    } catch (e) {
      if (id === requestId.current && !abort.signal.aborted) {
        setResponse(null)
        const message = e instanceof Error ? e.message : "Încearcă din nou."
        setError(message === "Calcul indisponibil" ? message : `Calcul indisponibil. ${message}`)
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [user])
  useEffect(() => {
    if (user) void reload(initialInput)
    else { setResponse(null); setSelected(null) }
    return () => { ++requestId.current; controller.current?.abort() }
  }, [user, reload, initialInput])
  const dirty = response !== null && JSON.stringify(input) !== JSON.stringify(response.input)
  const displayDate = (date: string) => date.split("-").reverse().join(".")
  const intervalText = (result: ForecastResult) => `${displayDate(result.interval.startDate)} ${result.interval.startTime} → ${displayDate(result.interval.endDate)} ${result.interval.endTime}`
  const occupied = (result: ForecastResult) => result.conflictingBookings + result.delayedCount + result.unmatchedInsideCount
  const remaining = (result: ForecastResult) => Math.max(0, result.totalSpots - result.conflictingBookings)
  const renderResult = (result: ForecastResult, daily: boolean) => <TableRow key={forecastIntervalLabel(result)}>
    <TableCell className="whitespace-nowrap">
      {daily ? <><div>{displayDate(result.interval.startDate)}</div><div className="text-xs text-muted-foreground">00:00 → 00:00 a doua zi</div></> : intervalText(result)}
    </TableCell>
    <TableCell>{occupied(result)} din {response?.capacity}</TableCell>
    <TableCell>{remaining(result)}</TableCell>
    <TableCell><div className="flex items-center gap-2">
      <span className={result.available ? "text-green-800 dark:text-green-300" : "text-red-700 dark:text-red-300"}>{result.available ? "Da" : "Nu"}</span>
      <Button size="icon" variant="outline" aria-label={`Explicație ${forecastIntervalLabel(result)}`} onClick={() => setSelected(result)}><Info className="h-4 w-4" /></Button>
    </div></TableCell>
  </TableRow>
  const resultTable = (results: ForecastResult[], daily: boolean) => <div className="overflow-x-auto"><Table>
    <TableHeader><TableRow>
      <TableHead>Perioada</TableHead><TableHead>Locuri calculate ca ocupate</TableHead>
      <TableHead>Locuri rămase conform calculului</TableHead><TableHead>Se poate rezerva?</TableHead>
    </TableRow></TableHeader><TableBody>{results.map(result => renderResult(result, daily))}</TableBody>
  </Table></div>
  return <div className="space-y-4 min-w-0">
    <Card><CardHeader><CardTitle>Ocupare pe zile (forecast)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={e => { e.preventDefault(); void reload(input) }} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="forecast-from">Prima zi</Label><Input required id="forecast-from" type="date" value={input.from} onChange={e => setInput(prev => ({ ...prev, from: e.target.value }))} /></div>
            <div className="space-y-1"><Label htmlFor="forecast-to">Ultima zi</Label><Input required id="forecast-to" type="date" value={input.to} onChange={e => setInput(prev => ({ ...prev, to: e.target.value }))} /></div>
          </div>
          <h3 className="font-semibold">Simulator de interval</h3>
          <p className="text-sm text-muted-foreground">Alege perioada clientului și verifică dacă sistemul permite încă o rezervare. Rezultatul verifică locurile disponibile; restricțiile pentru un anumit client sau număr se verifică separat în aplicație.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {([ ["startDate", "Data intrării", "date"], ["startTime", "Ora intrării", "time"], ["endDate", "Data ieșirii", "date"], ["endTime", "Ora ieșirii", "time"] ] as const).map(([key, label, type]) =>
              <div key={key} className="space-y-1"><Label htmlFor={`forecast-${key}`}>{label}</Label><Input required id={`forecast-${key}`} type={type} value={input.simulator[key]} onChange={e => setInput(prev => ({ ...prev, simulator: { ...prev.simulator, [key]: e.target.value } }))} /></div>)}
          </div>
          <Button type="submit" disabled={loading || !user}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Recalculează</Button>
        </form>
        {loading && <p role="status">Se calculează...</p>}
        {error && <p role="alert" className="text-red-700 dark:text-red-300">{error}</p>}
        {dirty && <p role="status" className="text-amber-800 dark:text-amber-300">Formular modificat — necesită recalculare. Rezultatele de mai jos corespund intervalelor afișate.</p>}
        {response && <>
          <p className="text-sm text-muted-foreground">Actualizat la {new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }).format(new Date(response.calculatedAt))} (ora României).</p>
          <h3 className="font-semibold">Rezultatul simulatorului</h3>
          <p className="rounded-md bg-muted p-3" role="status">
            Pentru {intervalText(response.simulator)}, sistemul calculează <strong>{occupied(response.simulator)} de locuri ocupate din {response.capacity}</strong>.
            {occupied(response.simulator) > response.capacity
              ? ` Limita este depășită cu ${occupied(response.simulator) - response.capacity} locuri.`
              : ` Rămân ${remaining(response.simulator)} locuri.`}
            <strong>{response.simulator.available ? " O rezervare nouă este permisă." : " O rezervare nouă este blocată."}</strong>
          </p>
          <p className="text-sm text-muted-foreground">Aceste valori reproduc calculul aplicației mobile, nu o numărătoare fizică a mașinilor. Întârziații actuali și mașinile fără rezervare sunt incluși și pentru zilele viitoare. Apasă „i” pentru explicația completă.</p>
          {resultTable([response.simulator], false)}
          <h3 className="font-semibold">Tabel zilnic</h3>{resultTable(response.days, true)}
        </>}
      </CardContent>
    </Card>
    {selected && response && <OccupancyForecastDetails key={forecastIntervalLabel(selected)} result={selected} response={response} onClose={() => setSelected(null)} />}
  </div>
}
