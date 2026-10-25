"use client"
import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import type { ManualExitContext } from "@/lib/manual-lpr-exit-contract"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"

const display = (value: string | null) => value ? `${value.slice(0, 10).split("-").reverse().join(".")} ${value.slice(11, 19)}` : "Necunoscută"
export function ManualLprExitDialog({ bookingId, onClose, onSaved }: { bookingId: string; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const { user } = useAuth()
  const [context, setContext] = useState<ManualExitContext | null>(null)
  const [date, setDate] = useState(""); const [time, setTime] = useState("")
  const [useNow, setUseNow] = useState(false)
  const [missing, setMissing] = useState(false); const [duplicates, setDuplicates] = useState(false); const [overwrite, setOverwrite] = useState(false)
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null); const [conflict, setConflict] = useState(false)
  const [reload, setReload] = useState(0)
  const requestId = useRef("")
  const epoch = useRef(0)
  const loadedAt = useRef(0)
  const resetRequest = () => { requestId.current = crypto.randomUUID() }
  useEffect(() => {
    const id = ++epoch.current
    const abort = new AbortController()
    setLoading(true); setError(null); setContext(null); setConflict(false)
    setMissing(false); setDuplicates(false); setOverwrite(false); setUseNow(false); setDate(""); setTime(""); resetRequest()
    void (async () => {
      try {
        const response = await adminAuthorizedFetch("/api/admin/manual-lpr-exit", user, { method: "POST", body: JSON.stringify({ action: "prepare", bookingId }), cache: "no-store", signal: abort.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        if (id !== epoch.current || abort.signal.aborted) return
        setContext(body); loadedAt.current = Date.now()
        if (!body.inside && body.departure) { setDate(body.departure.slice(0, 10)); setTime(body.departure.slice(11, 19)) }
      } catch (e) { if (!abort.signal.aborted && id === epoch.current) setError(e instanceof Error ? e.message : "Verificarea nu a reușit.") }
      finally { if (!abort.signal.aborted && id === epoch.current) setLoading(false) }
    })()
    return () => { abort.abort(); ++epoch.current }
  }, [bookingId, user, reload])
  const save = async () => {
    if (!context || saving || conflict) return
    setSaving(true); setError(null)
    try {
      const response = await adminAuthorizedFetch("/api/admin/manual-lpr-exit", user, { method: "POST", body: JSON.stringify({
        action: "save", bookingId, version: context.version, requestId: requestId.current,
        ...(useNow ? { useServerNow: true } : { date, time }),
        confirmMissingArrival: missing, confirmDuplicates: duplicates, confirmOverwrite: overwrite,
      }), cache: "no-store" })
      const body = await response.json()
      if (!response.ok) {
        if (body.code === "CONTEXT_CHANGED") setConflict(true)
        throw new Error(body.error || "Salvarea nu a reușit.")
      }
      try { await onSaved() } catch { setError("Ieșirea a fost salvată, dar lista nu s-a actualizat. Închide dialogul și reîncarcă pagina."); setConflict(true); return }
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : "Salvarea nu a reușit. Încearcă din nou.") }
    finally { setSaving(false) }
  }
  const confirm = (id: string, checked: boolean, change: (v: boolean) => void, text: string) => <div className="flex items-start gap-2"><Checkbox id={id} checked={checked} disabled={saving || conflict} onCheckedChange={v => { change(v === true); resetRequest() }} /><Label htmlFor={id} className="leading-relaxed">{text}</Label></div>
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
    <DialogHeader><DialogTitle>Setează Ieșire LPR (manual)</DialogTitle><DialogDescription>Confirmă rezervarea și ora plecării reale. Toate orele sunt orele României.</DialogDescription></DialogHeader>
    {loading && <p role="status">Se verifică șederea...</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {context && <div className="space-y-4 text-sm">
      <p><strong>Nr. înmatriculare:</strong> {context.booking.licensePlate}</p>
      <p className="break-all"><strong>Rezervarea selectată:</strong> {context.booking.id}</p>
      <p><strong>Perioada rezervării:</strong> {context.booking.startDate || "?"} {context.booking.startTime || "?"} → {context.booking.endDate || "?"} {context.booking.endTime || "?"}</p>
      <p><strong>Ieșire programată:</strong> {context.booking.endDate ? `${context.booking.endDate.split("-").reverse().join(".")} ${context.booking.endTime || "?"}` : "Necunoscută"}</p>
      <p><strong>Intrare înregistrată pentru șederea actuală:</strong> {display(context.arrival)}</p>
      {context.duplicates.length > 0 && <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-3 text-amber-950">
        <strong>Necesită verificare ADMIN</strong><p>Există alte înregistrări prezente pentru acest număr. Se închide numai rezervarea selectată.</p>
        <ul className="space-y-2">{context.duplicates.map(b => <li key={b.id} className="break-words"><strong>{b.id === bookingId ? "Selectată: " : ""}{b.licensePlate}</strong> — {b.startDate || "?"} {b.startTime || "?"} → {b.endDate || "?"} {b.endTime || "?"}<div className="break-all">ID: {b.id}</div></li>)}</ul>
        {confirm("exit-confirm-duplicates", duplicates, setDuplicates, "Confirm că această înregistrare trebuie marcată ca ieșită.")}
      </div>}
      <fieldset disabled={saving || conflict} className="space-y-3"><legend className="mb-2 font-semibold">Data și ora plecării reale</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label htmlFor="manual-lpr-date">Data plecării reale</Label><Input id="manual-lpr-date" type="date" value={date} onChange={e => { setDate(e.target.value); setUseNow(false); resetRequest() }} /></div>
          <div><Label htmlFor="manual-lpr-time">Ora plecării reale</Label><Input id="manual-lpr-time" type="time" step="1" value={time} onChange={e => { setTime(e.target.value); setUseNow(false); resetRequest() }} /></div>
        </div>
        <Button type="button" variant="outline" onClick={() => { setUseNow(true); resetRequest(); const clock = new Date(Date.parse(context.serverNow) + Date.now() - loadedAt.current).toISOString(); setDate(clock.slice(0, 10)); setTime(clock.slice(11, 19)) }}>A plecat acum</Button>
        {useNow && <p>Se va salva ora serverului din momentul confirmării.</p>}
      </fieldset>
      {!context.arrival && confirm("exit-confirm-missing", missing, setMissing, "Ora intrării nu poate fi verificată. Confirm că mașina a plecat la data și ora indicate.")}
      {!context.inside && context.departure && <div className="space-y-2"><p>Ieșire existentă: {display(context.departure)}</p>{confirm("exit-confirm-overwrite", overwrite, setOverwrite, "Confirm suprascrierea valorii LPR existente")}</div>}
    </div>}
    {(!context && !loading || conflict) && <Button variant="outline" onClick={() => setReload(v => v + 1)} disabled={saving}>Reîncarcă șederea</Button>}
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Renunță</Button><Button onClick={save} disabled={loading || saving || conflict || !context || (!useNow && (!date || !time)) || (!!context && ((!context.arrival && !missing) || (context.duplicates.length > 0 && !duplicates) || (!context.inside && !!context.departure && !overwrite)))}>{saving ? "Se salvează..." : "Salvează"}</Button></DialogFooter>
  </DialogContent></Dialog>
}
