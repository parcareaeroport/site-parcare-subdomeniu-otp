"use client"
import { useState } from "react"
import { useAuth } from "@/context/auth-context"
import { adminAuthorizedFetch } from "@/lib/admin-authorized-fetch"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import type { LprAttention } from "@/lib/lpr-attention"
export type { LprAttention } from "@/lib/lpr-attention"
const receivedFormat = new Intl.DateTimeFormat("ro-RO",{timeZone:"Europe/Bucharest",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
const receivedLabel = (value:string|null) => value ? receivedFormat.format(new Date(value)) : "Necunoscut"
const reasons:Record<string,string> = {
  invalid_pending_event:"Eveniment vechi/incomplet: ora trebuie verificată",
  earlier_event_pending:"Așteaptă procesarea unui eveniment anterior",
  ambiguous_reservations:"Mai multe rezervări eligibile", multiple_open_visits:"Mai multe șederi deschise",
  exit_without_open_visit:"Ieșire fără ședere deschisă",out_of_order_event:"Eveniment mai vechi decât starea cunoscută",
  later_exit_requires_review:"Există deja o ieșire ulterioară. Intrarea veche nu a redeschis șederea; verifică succesiunea.",
  later_entry_requires_review:"Există o intrare mai nouă, încă neclarificată. Ieșirea veche nu a scos mașina din evidență.",
  inconsistent_visit_state:"Rezervarea și evidența șederii se contrazic. Ieșirea nu a fost aplicată.",
  exit_before_last_entry:"Ieșirea este înaintea ultimei intrări înregistrate. Verifică ora plecării reale.",
  ambiguous_event_time:"Ora camerei se repetă la schimbarea orei. Momentul exact trebuie verificat.",
  ambiguous_event_order:"Ordinea evenimentelor nu poate fi stabilită sigur din orele înregistrate.",
  ambiguous_exit_order:"Ordinea intrării și ieșirii nu poate fi stabilită sigur. Prezența nu a fost schimbată.",
  plate_corrected_event_requires_review:"Citire întârziată pentru un număr corectat. Nu s-a creat o prezență suplimentară; verifică șederea.",
  stale_event_time:"Eveniment vechi: verifică prezența actuală a mașinii",
  invalid_clock_offset_config:"Corecția orei camerei este configurată invalid",
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
  const [showHistory,setShowHistory] = useState(false)
  const [page,setPage] = useState(0)
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
  const groups = showHistory ? attention.history : attention.groups
  const currentPage = Math.min(page,Math.max(0,Math.ceil(groups.length/20)-1))
  const visibleGroups = groups.slice(currentPage*20,currentPage*20+20)
  if (!attention.totalCount && !selected) return null
  return <section className="my-4 rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm" aria-label="Evenimente LPR de verificat">
    <details><summary className="cursor-pointer font-semibold">Necesită verificare ADMIN: {attention.count} {attention.count === 1 ? "număr auto" : "numere auto"} · ultimele {attention.windowHours} de ore</summary>
      <p className="my-2">{attention.count ? `${attention.eventCount} mesaje recente nu au fost aplicate automat și pot necesita verificarea prezenței. Verifică fiecare caz înainte de a corecta evidența.` : "Nu sunt cazuri recente nerezolvate în această listă."} Numărul de cazuri nu reprezintă mașini prezente sau locuri ocupate.</p>
      <div className="my-3 flex flex-wrap gap-2">
        <Button className="h-auto max-w-full whitespace-normal text-left" variant={!showHistory ? "default" : "outline"} onClick={()=>{setShowHistory(false);setPage(0)}}>Cazuri recente ({attention.count})</Button>
        <Button className="h-auto max-w-full whitespace-normal text-left" variant={showHistory ? "default" : "outline"} onClick={()=>{setShowHistory(true);setPage(0)}}>Istoric ({attention.totalCount-attention.eventCount} {attention.totalCount-attention.eventCount===1 ? "mesaj" : "mesaje"})</Button>
      </div>
      {showHistory && <p className="my-2">Mesaje mai vechi de {attention.windowHours} de ore, cu moment de primire necunoscut sau acoperite de o actualizare ulterioară a șederii. Sunt păstrate pentru diagnostic; această clasificare nu confirmă prezența fizică și nu modifică ocuparea.</p>}
      {visibleGroups.map(group => <details key={group.plate} className="border-t border-amber-200 py-3">
        <summary className="cursor-pointer break-words"><strong>{group.plate}</strong> · {group.events.length} {group.events.length===1 ? "mesaj" : "mesaje"} · Ultima primire: {receivedLabel(group.lastReceivedAt)} (România)<span className="mt-1 block">{reasons[group.events[0].reason] || "Necesită verificare"}</span></summary>
        {group.events.map(event => <div key={event.id} className="ml-2 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 py-3">
          <div className="min-w-0 flex-1">{event.type === "entry" ? "Intrare" : event.type === "exit" ? "Ieșire" : "Direcție necunoscută"} · Primit: {receivedLabel(event.receivedAt)} (România)<br/>
            Ora evenimentului: {event.at ? event.at.slice(0,19).replace("T"," ") : "Necunoscută"} (România)<br/>{reasons[event.reason] || "Necesită verificare"}
            {event.pending && <p className="text-xs">În așteptare pentru reîncercare.</p>}
            {event.bookingIds.length>0 && <p className="break-all text-xs">Rezervări: {event.bookingIds.join(", ")}</p>}</div>
          {isAdmin && <Button variant="outline" onClick={()=>void prepare(event)}>Verifică evenimentul</Button>}
        </div>)}
      </details>)}
      {groups.length>20 && <div className="mt-3 flex flex-wrap items-center gap-3"><Button variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Înapoi</Button><span>Pagina {currentPage+1} din {Math.ceil(groups.length/20)}</span><Button variant="outline" disabled={(currentPage+1)*20>=groups.length} onClick={()=>setPage(currentPage+1)}>Înainte</Button></div>}
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
