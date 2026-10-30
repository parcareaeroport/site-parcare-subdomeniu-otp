import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

type Fields = Record<string, unknown>
type Scope = { requestId: string; endpoint: string; started: number; fields: Fields; buffer?: {level:Level;stage:string;fields:Fields}[] }
type Level = "info" | "warn" | "error"
const scope = new AsyncLocalStorage<Scope>()
// Explicit allowlist: never serialize arbitrary payloads, errors, headers or admin input.
const allowed = new Set(`method status durationMs action actorUid bookingId eventId visitId plate deviceId direction receivedDirection timestampMode configSource accurateTime snapTime eventTime eventInstant serverTime clockDifferenceSeconds clockOffsetSeconds originalEventTime originalEventInstant maxEventAgeMinutes reason outcome explanation insideBefore insideAfter occupancyDelta candidateBookingIds processed attempts confirmOverwrite confirmDuplicates confirmMissingArrival confirmReentry confirmed useServerNow entryMode errorCode errorName replayed contentType textFieldCount imageCount barrierCommand responseRequestId`.split(' '))
function safe(fields:Fields):Fields {
  const result:Fields = {}
  for (const [key,value] of Object.entries(fields)) {
    if (!allowed.has(key) || value === undefined) continue
    if (typeof value === 'string') result[key] = value.replace(/[\r\n\t]/g,' ').slice(0,240)
    else if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) result[key] = value
    else if (key === 'candidateBookingIds' && Array.isArray(value)) result[key] = value.slice(0,20).filter(v=>typeof v==='string').map(v=>v.slice(0,120))
  }
  return result
}
const explanations:Record<string,string> = {
  missing_plate:'Numărul lipsește sau nu poate fi acceptat.',
  ambiguous_event_time:'Ora repetată la schimbarea orei nu identifică sigur momentul.',
  invalid_pending_event:'Evenimentul în așteptare nu conține o oră și o direcție interpretabile.',
  earlier_event_pending:'Un eveniment anterior al aceleiași mașini așteaptă procesarea.',
  booking_modification_in_progress:'Rezervarea este în curs de modificare; procesarea se amână.',
  plate_corrected_event_requires_review:'Eveniment anterior corectării numărului; necesită verificare.',
  ambiguous_event_order:'Ordinea evenimentelor nu poate fi stabilită sigur.',
  out_of_order_event:'Există deja un eveniment mai recent; acesta nu îl suprascrie.',
  simultaneous_event_requires_review:'Evenimente simultane contradictorii; necesită verificare.',
  later_exit_requires_review:'Există o ieșire ulterioară; intrarea nu redeschide automat șederea.',
  later_entry_requires_review:'Există o intrare ulterioară; ieșirea necesită verificare.',
  multiple_open_visits:'Același număr apare prezent pe mai multe documente.',
  exit_without_open_visit:'Nu există o ședere deschisă pentru această ieșire.',
  open_visit_conflicts_with_reservation:'Șederea deschisă contrazice rezervarea eligibilă.',
  legacy_open_visit_outside_period:'Ședere veche în afara perioadei; asocierea necesită verificare.',
  ambiguous_reservations:'Mai multe rezervări pot corespunde evenimentului.',
  ambiguous_exit_order:'Ieșirea nu poate fi ordonată sigur față de intrări.',
  exit_before_last_entry:'Ieșirea precede ultima intrare înregistrată.',
  inconsistent_visit_state:'Evidențele șederii se contrazic; ieșirea nu este aplicată.',
  invalid_json:'Corpul cererii nu este JSON valid.', invalid_multipart:'Corpul multipart nu poate fi citit.',
  invalid_booking:'Identificator de rezervare invalid.',invalid_action:'Acțiune necunoscută.',invalid_event:'Identificator de eveniment invalid.',
  retry_unavailable:'Reîncercarea a eșuat tehnic.',processing_unavailable:'Procesarea evenimentului a eșuat tehnic.',
  matched:'Eveniment asociat rezervării.', unmatched_visit:'Ședere fără rezervare asociată.',
  needs_review:'Eveniment păstrat pentru verificare ADMIN; nu confirmă modificarea ocupării.',
  pending:'Eveniment în așteptarea procesării.', duplicate:'Eveniment deja tratat; fără o nouă modificare.',
  whitelist_skip:'Număr exceptat; fără modificarea ocupării.', reviewed:'Verificare ADMIN înregistrată.',
  invalid_clock_offset_config:'Corecția orei camerei este configurată invalid; necesită verificare.',
  future_event_time:'Ora camerei este în viitor față de server.', stale_event_time:'Eveniment mai vechi decât limita acceptată.',
  invalid_event_time:'Data camerei nu poate fi interpretată.', unknown_direction:'Nu poate fi stabilită direcția.',
  association_failed:'Asocierea a eșuat; verifică reîncercarea.', persist_failed:'Evenimentul nu a putut fi salvat.',
  worker_not_configured:'Procesul de reîncercare nu este configurat.', unauthorized:'Cerere neautorizată.',
  disabled:'Endpoint dezactivat; mesajul nu este procesat.', receipt_only:'Mesaj recepționat; acest endpoint nu actualizează ocuparea.',
  committed:'Tranzacție confirmată; efectul asupra ocupării este indicat separat.',
}
/** Isolate each worker item while retaining the request correlation. */
export function withLprFields<T>(fields:Fields, callback:()=>Promise<T>):Promise<T> {
  const parent=scope.getStore() || {requestId:randomUUID(),endpoint:'service',started:Date.now(),fields:{}}
  return scope.run({...parent,fields:{...parent.fields,...safe(fields)}},callback)
}
export function lprFields(fields:Fields) { try { Object.assign(scope.getStore()?.fields || {},safe(fields)) } catch {} }
export function lprLog(stage:string, fields:Fields={}, level:Level='info') {
  try {
    const ctx=scope.getStore()
    const clean=safe(fields)
    const reason=String(clean.reason || clean.outcome || '')
    if (!clean.explanation && reason) clean.explanation=explanations[reason] || (level === "error" ? "Eroare tehnică; consultă motivul și etapa." : "Decizia procesării este indicată în outcome; motivul este indicat în reason.")
    if (ctx?.buffer) { ctx.buffer.push({stage,fields:clean,level}); return }
    const entry={prefix:'LPR',time:new Date().toISOString(),requestId:ctx?.requestId || null,endpoint:ctx?.endpoint || 'service',stage,
      ...(ctx?.fields || {}),...clean}
    console[level](JSON.stringify(entry))
  } catch { /* Diagnostics must never change processing. */ }
}
export function lprError(stage:string,error:unknown) {
  const e=error as {code?:unknown;name?:unknown}
  lprLog(stage,{errorCode:typeof e?.code==='number'||typeof e?.code==='string'?e.code:'unknown',errorName:typeof e?.name==='string'?e.name:'Error'},'error')
}
/** Buffer transaction diagnostics per attempt. Only the committed attempt is emitted. */
export async function lprTransaction<T>(db:FirebaseFirestore.Firestore, callback:(tx:FirebaseFirestore.Transaction)=>Promise<T>):Promise<T> {
  const parent=scope.getStore() || {requestId:randomUUID(),endpoint:'service',started:Date.now(),fields:{}}
  const committed=await db.runTransaction(async tx=> {
    const attempt:Scope={...parent,fields:{...parent.fields},buffer:[]}
    const value=await scope.run(attempt,()=>callback(tx))
    return {value,entries:attempt.buffer!}
  })
  for (const entry of committed.entries) scope.run({...parent,buffer:undefined},()=>lprLog(entry.stage,entry.fields,entry.level))
  return committed.value
}
export function withLprRequest<T extends (...args:any[])=>Response | Promise<Response>>(handler:T) {
  return async (...args:Parameters<T>):Promise<Response> => {
    const request = args[0] as Request | undefined
    const ctx:Scope={requestId:randomUUID(),endpoint:request ? new URL(request.url).pathname : "service",started:Date.now(),fields:{method:request?.method}}
    return scope.run(ctx,async ()=> {
      // KeepAlive is one compact line; other routes log before parsing/authentication.
      if (!ctx.endpoint.endsWith('/KeepAlive')) lprLog('received')
      try {
        const response:Response=await handler(...args)
        lprLog('response',{status:response.status,durationMs:Date.now()-ctx.started,
          ...(response.status>=400?{reason:ctx.fields.reason || (response.status===401||response.status===403?'unauthorized':'request_failed')}: {})},response.status>=500?'error':response.status>=400?'warn':'info')
        return response
      } catch(error) {
        lprError('unhandled_error',error)
        lprLog('response',{status:500,durationMs:Date.now()-ctx.started,reason:'unhandled_error'},'error')
        throw error
      }
    })
  }
}
