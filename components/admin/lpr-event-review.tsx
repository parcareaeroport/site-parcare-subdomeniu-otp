"use client"
import { useState } from "react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
export type LprAttention = {count:number; events:{id:string;plate:string;at:string|null;type:string;reason:string;pending:boolean;bookingIds:string[]}[]}
const reasons:Record<string,string> = {
  invalid_pending_event:"Eveniment vechi/incomplet: ora trebuie verificată",
  earlier_event_pending:"Așteaptă procesarea unui eveniment anterior",
  ambiguous_reservations:"Mai multe rezervări eligibile", multiple_open_visits:"Mai multe șederi deschise",
  exit_without_open_visit:"Ieșire fără ședere deschisă",out_of_order_event:"Eveniment mai vechi decât starea cunoscută",
  later_exit_requires_review:"Există deja o ieșire ulterioară. Intrarea veche nu a redeschis șederea; verifică succesiunea.",
  plate_corrected_event_requires_review:"Citire întârziată pentru un număr corectat. Nu s-a creat o prezență suplimentară; verifică șederea.",
  stale_event_time:"Eveniment vechi: verifică prezența actuală a mașinii",
  future_event_time:"Ora camerei este în viitor",invalid_event_time:"Ora camerei este invalidă",
  unknown_direction:"Direcție necunoscută",missing_plate:"Număr lipsă sau invalid",
  association_failed:"Eroare temporară la procesare",simultaneous_event_requires_review:"Evenimente simultane contradictorii",
  open_visit_conflicts_with_reservation:"Șederea deschisă diferă de rezervarea eligibilă",
  legacy_open_visit_outside_period:"Ședere veche în afara perioadei",
  booking_modification_in_progress:"Modificarea rezervării este în curs",
}
export function LprEventReview({attention,onSaved}:{attention:LprAttention;onSaved:()=>Promise<void>}) {
  const {user,isAdmin} = useAuth()
  const [selected,setSelected] = useState<LprAttention["events"][number]|null>(null)
  const [version,setVersion] = useState(""); const [note,setNote] = useState(""); const [confirmed,setConfirmed] = useState(false)
  const [busy,setBusy] = useState(false); const [error,setError] = useState("")
  async function request(eventId:string,action:string) {
    const response = await adminAuthorizedFetch("/api/admin/lpr-review",user,{method:"POST",body:JSON.stringify({eventId,action,version,note,confirmed})})
    const body = await response.json()
    if (!response.ok) { if (body.code === "CONTEXT_CHANGED") setVersion(""); throw Error(body.error) }
    return body
  }
  async function prepare(event:LprAttention["events"][number]) {
    setSelected(event); setVersion(""); setNote(""); setConfirmed(false); setError(""); setBusy(true)
    try {setVersion((await request(event.id,"prepare")).version)} catch(e) {setError(e instanceof Error ? e.message : "Verificarea a eșuat.")} finally {setBusy(false)}
  }
  async function save(action:string) {
    if (!selected || busy) return
    setBusy(true);setError("")
    try {await request(selected.id,action);setSelected(null);await onSaved()} catch(e) {setError(e instanceof Error ? e.message : "Salvarea a eșuat.")} finally {setBusy(false)}
  }
  if (!attention.count && !selected) return null
  return <section className="my-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm" aria-label="Evenimente LPR de verificat">
    <details><summary className="cursor-pointer font-semibold">Necesită verificare ADMIN: {attention.count} evenimente LPR</summary>
      <p className="my-2">Aceste evenimente nu au actualizat automat prezența. Numărul afișat poate diferi de parcarea fizică până la verificare. Erorile temporare se reiau automat.</p>
      {attention.events.map(event => <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 py-3">
        <div><strong>{event.plate}</strong> · {event.type === "entry" ? "Intrare" : event.type === "exit" ? "Ieșire" : "Direcție necunoscută"} · {event.at ? event.at.slice(0,19).replace("T"," ") : "Oră necunoscută"} (România)<br/>{reasons[event.reason] || "Procesare în așteptare"}
          {event.bookingIds.length > 0 && <p className="break-all text-xs">Rezervări: {event.bookingIds.join(", ")}</p>}</div>
        {isAdmin && <Button variant="outline" onClick={() => void prepare(event)}>Verifică {event.plate}</Button>}
      </div>)}
      {attention.count > attention.events.length && <p>Sunt afișate primele {attention.events.length}. După soluționare și reîncărcare apar următoarele.</p>}
    </details>
    <Dialog open={!!selected} onOpenChange={open=>{if(!open&&!busy)setSelected(null)}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Verificare {selected?.plate}</DialogTitle><DialogDescription>Verifică fizic mașina și rezervarea în Bookings. Dacă este necesar, corectează intrarea sau ieșirea prin dialogurile dedicate, apoi reîncarcă verificarea aici. Această confirmare păstrează istoricul și nu schimbă ocuparea.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <label className="space-y-1">Ce ai verificat sau corectat?<textarea aria-label="Ce ai verificat sau corectat?" className="w-full rounded border p-2" maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Confirm că am verificat prezența fizică și evidența acestei mașini.</label>
      {!version && <Button disabled={busy} onClick={()=>selected&&void prepare(selected)}>Reîncarcă verificarea</Button>}
      {(selected?.pending || selected?.reason === "association_failed") && <Button variant="outline" disabled={busy||!version} onClick={()=>void save("retry")}>Reîncearcă procesarea</Button>}
      <Button disabled={busy||!version||!confirmed||!note.trim()} onClick={()=>void save("resolve")}>Marchează verificat</Button>
    </DialogContent></Dialog>
  </section>
}
