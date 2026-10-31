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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const display = (value: string | null) => value ? `${value.slice(0, 10).split("-").reverse().join(".")} ${value.slice(11, 19)}` : "Necunoscută"
export function ManualLprExitDialog({ bookingId, onClose, onSaved, eventType = "exit", onEventTypeChange }: { eventType?: "entry" | "exit"; onEventTypeChange?: (type: "entry" | "exit") => void; bookingId: string; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const isEntry = eventType === "entry"
  const endpoint = isEntry ? "/api/admin/manual-lpr-entry" : "/api/admin/manual-lpr-exit"
  const { user } = useAuth()
  const [context, setContext] = useState<ManualExitContext | null>(null)
  const [date, setDate] = useState(""); const [time, setTime] = useState("")
  const [useNow, setUseNow] = useState(false)
  const [reentry, setReentry] = useState(false)
  const [missing, setMissing] = useState(false); const [duplicates, setDuplicates] = useState(false); const [overwrite, setOverwrite] = useState(false)
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null); const [conflict, setConflict] = useState(false)
  const [reload, setReload] = useState(0)
  const [editingPlate, setEditingPlate] = useState(false)
  const [plate, setPlate] = useState("")
  const [plateCheck, setPlateCheck] = useState<{version:string;inside:boolean;newPlate:string} | null>(null)
  const [confirmPlate, setConfirmPlate] = useState(false)
  const associating = isEntry && !!context?.association
  const [confirmRestore, setConfirmRestore] = useState(false)
  const hasRestoration = isEntry && !!context?.restoration
  const arrivalMs = Date.parse(`${date}T${time.length === 5 ? `${time}:00` : time}.000Z`)
  const restoring = hasRestoration && !useNow && Number.isFinite(arrivalMs) && arrivalMs <= Date.parse(context!.restoration!.correctedAbsentAt)
  const requestId = useRef("")
  const epoch = useRef(0)
  const loadedAt = useRef(0)
  const resetRequest = () => { requestId.current = crypto.randomUUID() }
  useEffect(() => {
    const id = ++epoch.current
    const abort = new AbortController()
    setLoading(true); setError(null); setContext(null); setConflict(false)
    setEditingPlate(false); setPlateCheck(null); setConfirmPlate(false); setPlate("")
    setConfirmRestore(false)
    setReentry(false); setMissing(false); setDuplicates(false); setOverwrite(false); setUseNow(false); setDate(""); setTime(""); resetRequest()
    void (async () => {
      try {
        const response = await adminAuthorizedFetch(endpoint, user, { method: "POST", body: JSON.stringify({ action: "prepare", bookingId }), cache: "no-store", signal: abort.signal })
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        if (id !== epoch.current || abort.signal.aborted) return
        setContext(body); loadedAt.current = Date.now()
        if (isEntry && body.restoration) { setDate(body.restoration.arrival.slice(0, 10)); setTime(body.restoration.arrival.slice(11, 19)) }
        if (!isEntry && !body.inside && body.departure) { setDate(body.departure.slice(0, 10)); setTime(body.departure.slice(11, 19)) }
      } catch (e) { if (!abort.signal.aborted && id === epoch.current) setError(e instanceof Error ? e.message : "Verificarea nu a reușit.") }
      finally { if (!abort.signal.aborted && id === epoch.current) setLoading(false) }
    })()
    return () => { abort.abort(); ++epoch.current }
  }, [bookingId, user, reload, endpoint, isEntry])
  const save = async () => {
    if (!context || saving || conflict) return
    setSaving(true); setError(null)
    try {
      const response = await adminAuthorizedFetch(endpoint, user, { method: "POST", body: JSON.stringify({
        action: "save", bookingId, version: context.version, requestId: requestId.current,
        ...(useNow ? { useServerNow: true } : { date, time }),
        ...(isEntry ? { entryMode: restoring ? "restore_deleted_visit" : associating ? "associate_visit" : context.inside ? "correct_arrival" : "new_visit", confirmReentry: reentry || (hasRestoration && !restoring && confirmRestore), confirmAssociation: duplicates } : {}),
        ...(restoring ? { restorationVersion: context.restoration!.version, restorationReason: "Intrare manuală după corectarea numărului: operatorul confirmă prezența continuă de la ora sosirii indicată.", confirmRestoration: confirmRestore } : {}),
        confirmMissingArrival: missing, confirmDuplicates: duplicates, confirmOverwrite: overwrite,
      }), cache: "no-store" })
      const body = await response.json()
      if (!response.ok) {
        if (body.code === "CONTEXT_CHANGED") setConflict(true)
        throw new Error(body.error || "Salvarea nu a reușit.")
      }
      try { await onSaved() } catch { setError("Evenimentul a fost salvat, dar lista nu s-a actualizat. Închide dialogul și reîncarcă pagina."); setConflict(true); return }
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : "Salvarea nu a reușit. Încearcă din nou.") }
    finally { setSaving(false) }
  }
  const savePlate = async () => {
    if (saving || !context || conflict) return
    setSaving(true); setError(null)
    try {
      const response = await adminAuthorizedFetch("/api/admin/bookings/plate", user, { method: "POST", body: JSON.stringify({
        action: plateCheck ? "save" : "prepare", bookingId, plate, version: plateCheck?.version, confirmPresent: confirmPlate,
      }), cache: "no-store" })
      const body = await response.json()
      if (!response.ok) { if (body.code === "CONTEXT_CHANGED") { setPlateCheck(null); setConfirmPlate(false) }; throw new Error(body.error || "Modificarea numărului a eșuat.") }
      if (!plateCheck) { setPlateCheck(body); return }
      setEditingPlate(false); setPlateCheck(null); setConfirmPlate(false); setReload(v => v + 1)
      try { await onSaved() } catch { setError("Numărul a fost salvat, dar lista nu s-a actualizat. Reîncarcă pagina.") }
    } catch (e) { setError(e instanceof Error ? e.message : "Modificarea numărului a eșuat.") }
    finally { setSaving(false) }
  }
  const confirm = (id: string, checked: boolean, change: (v: boolean) => void, text: string) => <div className="flex items-start gap-2"><Checkbox id={id} checked={checked} disabled={saving || conflict} onCheckedChange={v => { change(v === true); resetRequest() }} /><Label htmlFor={id} className="leading-relaxed">{text}</Label></div>
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose() }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
    <DialogHeader><DialogTitle>{hasRestoration ? "Înregistrează intrarea" : associating ? "Asociază șederea LPR cu rezervarea" : isEntry ? context?.inside ? "Corectează ora intrării" : "Înregistrează o intrare nouă" : "Setează Ieșire LPR (manual)"}</DialogTitle><DialogDescription>Confirmă rezervarea și ora {isEntry ? "sosirii" : "plecării"} reale. Toate orele sunt orele României.</DialogDescription></DialogHeader>
    {onEventTypeChange && <div><Label htmlFor="manual-lpr-type">Tip eveniment</Label><Select value={eventType} onValueChange={v => onEventTypeChange(v as "entry" | "exit")} disabled={saving}><SelectTrigger id="manual-lpr-type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="entry">Intrare</SelectItem><SelectItem value="exit">Ieșire</SelectItem></SelectContent></Select></div>}
    {loading && <p role="status">Se verifică șederea...</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {context && <div className="space-y-4 text-sm">
      <p><strong>Nr. înmatriculare:</strong> {context.booking.licensePlate}</p>
      {!editingPlate ? <Button type="button" variant="outline" disabled={saving || conflict} onClick={() => { setEditingPlate(true); setPlate(context.booking.licensePlate); setPlateCheck(null); setConfirmPlate(false); setError(null) }}>Modifică numărul de înmatriculare</Button> : <fieldset disabled={saving || conflict} className="space-y-3 rounded border p-3">
        <legend>Modifică numărul de înmatriculare</legend>
        <Label htmlFor="manual-new-plate">Număr nou</Label><Input id="manual-new-plate" value={plate} onChange={e => { setPlate(e.target.value); setPlateCheck(null); setConfirmPlate(false) }} />
        {plateCheck && <p>Număr verificat: {plateCheck.newPlate}. Rezervarea rămâne aceeași.</p>}
        {plateCheck?.inside && confirm("manual-confirm-plate", confirmPlate, setConfirmPlate, "Confirm că este aceeași mașină prezentă și corectez numărul ei real. Șederea rămâne deschisă pe numărul nou.")}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setEditingPlate(false)}>Renunță la modificarea numărului</Button>
          <Button type="button" disabled={!plate.trim() || (!!plateCheck?.inside && !confirmPlate)} onClick={savePlate}>{plateCheck ? "Salvează numărul" : "Verifică numărul"}</Button></div>
      </fieldset>}
      <p className="break-all"><strong>Rezervarea selectată:</strong> {context.booking.id}</p>
      <p><strong>Perioada rezervării:</strong> {context.booking.startDate || "?"} {context.booking.startTime || "?"} → {context.booking.endDate || "?"} {context.booking.endTime || "?"}</p>
      <p><strong>Ieșire programată:</strong> {context.booking.endDate ? `${context.booking.endDate.split("-").reverse().join(".")} ${context.booking.endTime || "?"}` : "Necunoscută"}</p>
      <p><strong>Intrare înregistrată pentru șederea actuală:</strong> {display(context.arrival)}</p>
      {context.lastEntry && context.lastEntry !== context.arrival && <p><strong>Ultima detectare de intrare:</strong> {display(context.lastEntry)}</p>}
      {isEntry && context.inside && <p className="rounded border bg-slate-50 p-3">Corectezi doar ora sosirii pentru șederea prezentă. Numărul mașinilor și ultima detectare LPR rămân aceleași.</p>}
      {isEntry && !context.inside && context.hasPreviousVisit && <div className="space-y-2 rounded border border-amber-400 bg-amber-50 p-3">
        <p><strong>Ieșire înregistrată anterior:</strong> {display(context.departure)}</p>
        <p>Înregistrarea este închisă. Salvarea creează o ședere nouă și ocupă un loc. Pentru o simplă corecție a istoricului, nu înregistra o intrare nouă.</p>
        {confirm("entry-confirm-reentry", reentry, setReentry, "Confirm că mașina a reintrat fizic în parcare.")}
      </div>}
      {context.duplicates.length > 0 && <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-3 text-amber-950">
        <strong>{isEntry ? "Număr deja prezent pe altă înregistrare" : "Necesită verificare ADMIN"}</strong><p>Există alte înregistrări prezente pentru acest număr. {associating ? "Poți asocia șederea fără rezervare de mai jos cu rezervarea selectată. Ora reală a intrării și ocuparea se păstrează; nu se înregistrează o intrare nouă." : isEntry ? "Blocajul se aplică tuturor rolurilor și previne înregistrarea aceleiași mașini de două ori. Verifică șederea de mai jos înainte de a înregistra o intrare nouă. Marchează ieșirea ei numai dacă mașina a plecat fizic." : "Se închide numai rezervarea selectată."}</p>
        <ul className="space-y-2">{context.duplicates.map(b => <li key={b.id} className="break-words"><strong>{b.id === bookingId ? "Selectată: " : ""}{b.licensePlate}</strong> — {b.startDate || "?"} {b.startTime || "?"} → {b.endDate || "?"} {b.endTime || "?"}<div className="break-all">ID: {b.id}</div></li>)}</ul>
        {!isEntry && confirm("exit-confirm-duplicates", duplicates, setDuplicates, "Confirm că această înregistrare trebuie marcată ca ieșită.")}
        {associating && <><p><strong>Intrarea existentă:</strong> {display(context.association!.arrival)}</p>
          {context.association!.outsidePeriod && <p>Intrarea a fost în afara perioadei rezervării. Verifică atent că este aceeași mașină și aceeași ședere.</p>}
          {confirm("entry-confirm-association", duplicates, setDuplicates, "Confirm că mașina este în parcare și această ședere LPR aparține rezervării selectate.")}</>}
      </div>}
      {!associating && <fieldset disabled={saving || conflict} className="space-y-3"><legend className="mb-2 font-semibold">Data și ora {isEntry ? "sosirii" : "plecării"} reale</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label htmlFor="manual-lpr-date">Data {isEntry ? "sosirii" : "plecării"} reale</Label><Input id="manual-lpr-date" type="date" value={date} onChange={e => { setDate(e.target.value); setUseNow(false); setConfirmRestore(false); resetRequest() }} /></div>
          <div><Label htmlFor="manual-lpr-time">Ora {isEntry ? "sosirii" : "plecării"} reale</Label><Input id="manual-lpr-time" type="time" step="1" value={time} onChange={e => { setTime(e.target.value); setUseNow(false); setConfirmRestore(false); resetRequest() }} /></div>
        </div>
        <Button type="button" variant="outline" onClick={() => { setUseNow(true); setConfirmRestore(false); resetRequest(); const clock = new Date(Date.parse(context.serverNow) + Date.now() - loadedAt.current).toISOString(); setDate(clock.slice(0, 10)); setTime(clock.slice(11, 19)) }}>{isEntry ? "A sosit acum" : "A plecat acum"}</Button>
        {useNow && <p>Se va salva ora serverului din momentul confirmării.</p>}
      </fieldset>}
      {hasRestoration && confirm("entry-confirm-restoration", confirmRestore, setConfirmRestore, "Confirm că mașina este în parcare de la data și ora indicate.")}
      {!isEntry && !context.arrival && confirm("exit-confirm-missing", missing, setMissing, "Ora intrării nu poate fi verificată. Confirm că mașina a plecat la data și ora indicate.")}
      {(isEntry ? context.inside : !context.inside && context.departure) && <div className="space-y-2"><p>{isEntry ? "Intrare existentă" : "Ieșire existentă"}: {display(isEntry ? context.arrival : context.departure)}</p>{confirm("exit-confirm-overwrite", overwrite, setOverwrite, "Confirm suprascrierea valorii LPR existente")}</div>}
    </div>}
    {(!context && !loading || conflict) && <Button variant="outline" onClick={() => setReload(v => v + 1)} disabled={saving}>Reîncarcă șederea</Button>}
    <DialogFooter><Button variant="outline" onClick={onClose} disabled={saving}>Renunță</Button><Button onClick={save} disabled={loading || saving || editingPlate || conflict || !context || (hasRestoration && !confirmRestore) || (!associating && !useNow && (!date || !time)) || (!!context && ((isEntry && !context.inside && context.hasPreviousVisit === true && !reentry) || (!isEntry && !context.arrival && !missing) || (context.duplicates.length > 0 && (isEntry && !associating || !duplicates)) || ((isEntry ? context.inside : !context.inside && !!context.departure) && !overwrite)))}>{saving ? "Se salvează..." : associating ? "Asociază șederea" : "Salvează"}</Button></DialogFooter>
  </DialogContent></Dialog>
}
