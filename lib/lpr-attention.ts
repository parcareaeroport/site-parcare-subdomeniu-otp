import { normalizeLicensePlate } from "./utils"
import { lprTimestampToMillis } from "./lpr-presence"
import { receiptLprTime, compareLprTimes, lprTime, romaniaCivilClock } from "./lpr-time"

export type AttentionEvent = {id:string;plate:string;at:string|null;receivedAt:string|null;type:string;reason:string;pending:boolean;bookingIds:string[]}
export type AttentionGroup = {plate:string;events:AttentionEvent[];lastReceivedAt:string|null}
export type LprAttention = {count:number;eventCount:number;totalCount:number;windowHours:number;groups:AttentionGroup[];history:AttentionGroup[];events:AttentionEvent[]}
export type AttentionRecord = {id:string;data:any}
export const LPR_ATTENTION_HOURS = 24

/** Display classification only: never acknowledges receipts or changes presence.
 * Receipt time determines recency, because a rejected camera clock is not trusted.
 * Only a provably later applied state can move a recent event to history. */
export function buildLprAttention(records:AttentionRecord[], states:Map<string,any>, now:number):LprAttention {
  const active:AttentionEvent[]=[], history:AttentionEvent[]=[]
  const cutoff=now-LPR_ATTENTION_HOURS*3600000
  for(const {id,data:e} of records) {
    const plate=normalizeLicensePlate(String(e.normalizedPlate||e.plateNumber||"")) || "Necunoscut"
    const received=lprTimestampToMillis(e.receivedAt)
    const point=receiptLprTime(e), wall=lprTimestampToMillis(point.wall)
    const event:AttentionEvent={id,plate,at:wall===null?null:new Date(wall).toISOString(),receivedAt:received===null?null:new Date(received).toISOString(),
      type:e.eventType||"unknown",reason:e.associationReason||"pending",pending:e.associationStatus==="pending",bookingIds:Array.isArray(e.candidateBookingIds)?e.candidateBookingIds:[]}
    const state=states.get(plate)
    const order=state ? compareLprTimes(point,lprTime(state.lastEventAt,state.lastEventAtInstant)) : null
    const consistentState=state && (state.lastEventType==="entry" && state.isInside===true || state.lastEventType==="exit" && state.isInside===false)
    const stateNotFuture=state && compareLprTimes(lprTime(state.lastEventAt,state.lastEventAtInstant),lprTime(romaniaCivilClock(new Date(now)),new Date(now).toISOString()))!==1
    const covered=consistentState && stateNotFuture && (order===-1 || order===0 && state.lastEventType===event.type)
    const recent=received!==null && received>=cutoff && received<=now
    ;(recent && !e.supersededBy && !covered ? active : history).push(event)
  }
  function group(events:AttentionEvent[]):AttentionGroup[] {
    const grouped=new Map<string,AttentionEvent[]>()
    for(const e of events) {const list=grouped.get(e.plate)||[];list.push(e);grouped.set(e.plate,list)}
    return [...grouped].map(([plate,events])=>{events.sort((a,b)=>(b.receivedAt||"").localeCompare(a.receivedAt||"")||a.id.localeCompare(b.id));return {plate,events,lastReceivedAt:events[0].receivedAt}})
      .sort((a,b)=>(b.lastReceivedAt||"").localeCompare(a.lastReceivedAt||"")||a.plate.localeCompare(b.plate))
  }
  const groups=group(active)
  return {count:groups.length,eventCount:active.length,totalCount:records.length,windowHours:LPR_ATTENTION_HOURS,groups,history:group(history),events:groups.flatMap(g=>g.events)}
}
