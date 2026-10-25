"use client"

import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ForecastResult, OccupancyForecastResponse } from "@/lib/occupancy-forecast-contract"

export function forecastIntervalLabel(result: ForecastResult) {
  const i = result.interval
  return `${i.startDate} ${i.startTime} → ${i.endDate} ${i.endTime}`
}
const groups = [
  ["overlapping", "Rezervări suprapuse"], ["delayed", "Întârziați"],
  ["unmatched", "Fără rezervare"], ["excluded", "Excluse din termeni"],
] as const

export function OccupancyForecastDetails({ result, response, onClose }: {
  result: ForecastResult; response: OccupancyForecastResponse; onClose: () => void
}) {
  const [group, setGroup] = useState<typeof groups[number][0]>("overlapping")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const entries = result.diagnostics[group]
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return entries.filter(entry => {
      const doc = response.documents[entry.id]
      return `${entry.id} ${doc.licensePlate} ${doc.apiBookingNumber || ""}`.toLocaleLowerCase().includes(needle)
    })
  }, [entries, response.documents, search])
  const pages = Math.max(1, Math.ceil(filtered.length / 25))
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Explicația disponibilității</DialogTitle>
          <DialogDescription>{forecastIntervalLabel(result)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm min-w-0">
          <p>Momentul calculului: <time>{response.calculatedAt}</time>. Fus orar server: {response.serverTimeZone}. Orele intervalului sunt interpretate pe server, conform regulii Expo actuale.</p>
          <div className="rounded-md border p-3 space-y-1 break-words">
            <p>Capacitate disponibilă = max(0, capacitate − întârziați − fără rezervare)</p>
            <p>max(0, {response.capacity} − {result.delayedCount} − {result.unmatchedInsideCount}) = <strong>{result.totalSpots}</strong></p>
            <p>Rezervarea este permisă dacă suprapuse + 1 ≤ capacitatea disponibilă.</p>
            <p>{result.conflictingBookings} + 1 ≤ {result.totalSpots}: <strong>{result.available ? "Permisă" : "Blocată"}</strong></p>
          </div>
          <p>maxBookingsInPeriod = {result.maxBookingsInPeriod}: valoare informativă calculată separat pe zile, care nu decide acceptarea. Calculul actual numără rezervările suprapuse cu întregul interval; nu calculează ocuparea maximă simultană.</p>
          <p>Întârziații actuali și mașinile fără rezervare reduc capacitatea inclusiv pentru zilele viitoare. Documentele cu numere repetate sunt numărate separat. Semnalările LPR sunt informative și nu modifică rezultatul.</p>
          <div className="flex flex-wrap gap-2" aria-label="Categorii de documente">
            {groups.map(([key, label]) => <Button key={key} size="sm" variant={group === key ? "default" : "outline"} aria-pressed={group === key}
              onClick={() => { setGroup(key); setPage(0) }}>{label} ({result.diagnostics[key].length})</Button>)}
          </div>
          <p>O înregistrare poate contribui la un termen și poate fi exclusă din altul. Excluderile de mai jos explică termenul indicat în motiv.</p>
          <div className="space-y-1">
            <Label htmlFor="forecast-document-search">Caută număr sau ID rezervare</Label>
            <Input id="forecast-document-search" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} />
          </div>
          <p role="status">{filtered.length} rezultate din {entries.length} în această categorie. Pagina {page + 1} din {pages}.</p>
          <ul className="space-y-2">
            {filtered.slice(page * 25, (page + 1) * 25).map(entry => {
              const doc = response.documents[entry.id]
              return <li key={entry.id} className="rounded-md border p-3 space-y-1 break-words">
                <p><strong>{doc.licensePlate}</strong> · ID: {doc.id}{doc.apiBookingNumber ? ` · Nr. rezervare: ${doc.apiBookingNumber}` : ""}</p>
                <p>{doc.startDate || "—"} {doc.startTime || "—"} → {doc.endDate || "—"} {doc.endTime || "—"} · Status: {doc.status}</p>
                <p>{entry.reason}</p>
                <details><summary className="cursor-pointer">Indicatori LPR folosiți</summary>
                  <p>isInside brut: {String(doc.lpr.isInside)} · Ultimul eveniment: {doc.lpr.lastEventType || "—"}</p>
                  <p>Intrare: {doc.lpr.arrivedAt === null ? "—" : new Date(doc.lpr.arrivedAt).toISOString()}</p>
                  <p>Ieșire: {doc.lpr.departedAt === null ? "—" : new Date(doc.lpr.departedAt).toISOString()}</p>
                  <p>Ultima observare: {doc.lpr.lastSeenAt === null ? "—" : new Date(doc.lpr.lastSeenAt).toISOString()}</p>
                </details>
                {doc.warnings.map(warning => <p key={warning} className="text-amber-800 dark:text-amber-300">{warning}</p>)}
              </li>
            })}
          </ul>
          {filtered.length === 0 && <p>Nicio înregistrare.</p>}
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Pagina anterioară</Button>
            <Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Pagina următoare</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
