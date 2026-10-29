// Stage 3 regression tests: real services/routes, isolated Firestore only; external services forbidden/stubbed.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict'), ts=require('typescript'), {randomUUID}=require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/)
const projectId='demo-parking-integrity',root=path.resolve(__dirname,'..')
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore')
const app=initializeApp({projectId},'integrity-tests'),db=getFirestore(app),cache=new Map()
const actor={uid:'admin-fixture',email:'admin@example.invalid'}
let failReceipt=false,failAssociation=0,onCancellation=null,onExternalCreate=null
const dbProxy=new Proxy(db,{get(target,key){
 if(key==='runTransaction')return async(...args)=>{if(failAssociation>0){failAssociation--;throw Error('Injected transient transaction failure')}return target.runTransaction(...args)}
 if(key==='collection')return name=>{const col=target.collection(name);if(name!=='lpr_events')return col;return new Proxy(col,{get(c,k){if(k==='doc')return(...args)=>{const ref=c.doc(...args);const create=ref.create.bind(ref);ref.create=async data=>{if(failReceipt)throw Error('Injected receipt failure');return create(data)};return ref};const v=c[k];return typeof v==='function'?v.bind(c):v}})}
 const value=target[key];return typeof value==='function'?value.bind(target):value
}})
function load(relative){const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod)
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
 new Function('require','module','exports',js)(name=>{
  if(name==='server-only')return {}
  if(name==='@/lib/firebase-admin')return {adminDb:dbProxy,adminAuth:{verifyIdToken:async token=>{if(!['admin','employee'].includes(token))throw Error('Invalid fixture token');return {...actor,role:token}}}}
  if(name==='@/app/actions/booking-actions')return {cancelBooking:async()=>{if(onCancellation)await onCancellation();return {success:true}}}
  if(name==='@/lib/multipark-bookings')return {cancelMultiparkBooking:async()=>({success:true}),createMultiparkBooking:async()=>{if(onExternalCreate)await onExternalCreate();return {success:true,bookingNumber:'fixture-new',message:'fixture'}}}
  if(name==='@/lib/booking-utils')return {checkAvailability:async()=>({available:true}),checkExistingReservationByLicensePlate:async()=>({exists:false})}
  if(name==='@/lib/user-credits')return {addUserCredit:async()=>{throw Error('Unexpected credit')}}
  if(name==='@/lib/email-service')return {sendBookingModificationConfirmationEmail:async()=>({success:true})}
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts')
  if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name))+'.ts')
  return require(name)
 },mod,mod.exports);return mod.exports}
process.env.LPR_AUTH_SECRET='fixture-camera-secret'
process.env.LPR_DEVICES_JSON=JSON.stringify({intrare_1:{direction:'entry',timestampMode:'romania_wall_clock',maxEventAgeMinutes:525600},iesire_1:{direction:'exit',timestampMode:'romania_wall_clock',maxEventAgeMinutes:525600},utc_exit:{direction:'exit',timestampMode:'instant',maxEventAgeMinutes:525600}})
const {handleLprEvent:camera,retryPendingLprEvents:retry}=load('lib/lpr-service.ts')
const {prepareManualExit:prepare,saveManualExit:exit}=load('lib/manual-lpr-exit.server.ts')
const {saveManualEntry:enter}=load('lib/manual-lpr-entry.server.ts')
const {preparePlateChange,savePlateChange}=load('lib/booking-plate.server.ts')
const {GET:occupancy,POST:occupancyAction}=load('app/api/admin/occupancy/route.ts')
const {POST:cameraHTTP}=load('app/NotificationInfo/TollgateInfo/route.ts')
const {POST:removeBooking}=load('app/api/admin/bookings/delete/route.ts')
const {POST:plateHTTP}=load('app/api/admin/bookings/plate/route.ts')
const {POST:reviewHTTP}=load('app/api/admin/lpr-review/route.ts')
const {GET:workerHTTP}=load('app/api/cron/lpr-retry/route.ts')
const {reviewLprEvent:review}=load('lib/lpr-review.server.ts')
const {parseCameraTime}=load('lib/lpr-camera-config.server.ts')
const {applyBookingModificationRequest:applyModification}=load('lib/booking-modifications.ts')
const {cancelNoShow}=require('../functions/pay-on-site-no-show.js')
const {NextRequest}=require('next/server')
const base={licensePlate:'TEST01',status:'confirmed_paid',startDate:'2026-07-16',startTime:'10:00',endDate:'2026-07-21',endTime:'20:00'}
const seed=(id='active',patch={})=>db.doc('bookings/'+id).set({...base,...patch})
const read=async id=>(await db.doc('bookings/'+id).get()).data()
const event=(type,at='2026-07-16T10:00:00Z',plate='TEST01',extra={})=>camera({plateNumber:plate,deviceId:type==='entry'?'intrare_1':'iesire_1',direction:type,snapTime:at,accurateTime:at,laneNo:1,...extra})
const apiReq=(body,role='admin')=>new Request('http://localhost/api/admin/test',{method:'POST',headers:role?{Authorization:'Bearer '+role}:{},body:JSON.stringify(body)})
const observed=async()=>{const r=await occupancy(new Request('http://localhost/api/admin/occupancy',{headers:{Authorization:'Bearer admin'}}));assert.equal(r.status,200);return r.json()}
const count=async()=>(await observed()).occupiedCount
const counter=async()=>(await db.doc('config/parkingLive').get()).data().occupiedCount
const postCamera=(at,token='fixture-camera-secret',device='intrare_1')=>cameraHTTP(new NextRequest('http://localhost/NotificationInfo/TollgateInfo',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify({Picture:{Plate:{PlateNumber:'TEST01'},SnapInfo:{DeviceID:device,AccurateTime:at}}})}))
const input=(ctx,patch={})=>({entryMode:ctx.inside?"correct_arrival":"new_visit",confirmReentry:!ctx.inside&&!!(ctx.arrival||ctx.departure),bookingId:ctx.booking.id,version:ctx.version,requestId:randomUUID(),date:'2026-07-16',time:'11:00:00',...patch})
const correction=async(plate='TEST02')=>({bookingId:'active',plate,...await preparePlateChange('active',plate),confirmPresent:true})
// Only the commercial modification eligibility clock is fixed; LPR timestamps remain independently validated.
const realNow=Date.now
async function applyFixture(){Date.now=()=>Date.parse('2026-07-14T10:00:00Z');try{return await applyModification('request',{reason:'admin_approved'})}finally{Date.now=realNow}}
let passed=0
async function check(name,fn){assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'})).ok);failReceipt=false;failAssociation=0;onCancellation=null;onExternalCreate=null;delete process.env.LPR_TOLLGATE_WHITELIST
 await db.doc('config/reservationSettings').set({maxTotalReservations:290});await db.doc('config/parkingLive').set({occupiedCount:0})
 await fn();passed++;console.log('PASS',name)}
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code)
async function modification(){await db.doc('bookingModificationRequests/request').set({bookingId:'active',status:'pending_admin_review',amountToPay:0,creditAmount:0,difference:0,newAmount:100,currentAmount:100,finalValues:{licensePlate:'TEST02',startDate:base.startDate,startTime:base.startTime,endDate:base.endDate,endTime:base.endTime}})}
;(async()=>{
 await check('inside deletion blocked before external cancellation',async()=>{await seed('active',{apiBookingNumber:'fixture'});await event('entry');onCancellation=()=>{throw Error('Must not contact external API')};const r=await removeBooking(apiReq({bookingId:'active'}));assert.equal(r.status,409);assert.equal((await r.json()).code,'VEHICLE_PRESENT');assert.equal(await count(),1);assert.equal((await db.doc('deleted_bookings/active').get()).exists,false)})
 await check('entry while deletion is preparing blocks final deletion',async()=>{await seed('active',{apiBookingNumber:'fixture'});onCancellation=async()=>{await event('entry')};assert.equal((await removeBooking(apiReq({bookingId:'active'}))).status,409);assert.equal(await count(),1);assert.equal((await read('active')).lpr.isInside,true)})
 await check('outside deletion archives actual evidence without fabricating exit',async()=>{await seed();const r=await removeBooking(apiReq({bookingId:'active'}));assert.equal(r.status,200);assert.equal((await db.doc('deleted_bookings/active').get()).data().lpr,undefined);assert.equal(await count(),0)})
 await check('plate correction requires explicit confirmation and moves same stay atomically',async()=>{await seed();await event('entry');const change=await correction();await rejects(savePlateChange({...change,confirmPresent:false},actor),'VEHICLE_PRESENT');const visit=(await read('active')).lpr.visitId;await savePlateChange(change,actor);assert.equal(await count(),1);assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().isInside,false);assert.equal((await db.doc('lpr_plate_state/TEST02').get()).data().visitId,visit);await event('exit','2026-07-17T10:00:00Z','TEST02');assert.equal(await count(),0);assert.equal(await counter(),0);assert.equal((await db.collection('bookings/active/plateCorrections').get()).size,1)})
 await check('duplicate target plate cannot be assigned to present booking',async()=>{await seed();await seed('other',{licensePlate:'test-02'});await event('entry');await event('entry','2026-07-16T10:00:00Z','TEST02');await rejects(preparePlateChange('active','TEST02'),'DUPLICATE_PLATE');assert.equal(await count(),2)})
 await check('camera exit after plate context invalidates correction',async()=>{await seed();await event('entry');const ctx=await correction();await event('exit','2026-07-17T10:00:00Z');await rejects(savePlateChange(ctx,actor),'CONTEXT_CHANGED');assert.equal((await read('active')).licensePlate,'TEST01')})
 await check('camera vs correction race never yields duplicate counted documents',async()=>{await seed();await event('entry');const ctx=await correction();await Promise.allSettled([savePlateChange(ctx,actor),event('exit','2026-07-17T10:00:00Z')]);const b=await read('active');if(b.licensePlate==='TEST02'){assert.equal(await count(),1);assert.ok((await observed()).lprAttention.count);await event('exit','2026-07-17T11:00:00Z','TEST02')}assert.equal(await count(),0)})
 await check('general modifications cannot change a present vehicle plate',async()=>{await seed();await event('entry');await modification();await rejects(applyFixture(),'VEHICLE_PRESENT');assert.equal((await read('active')).licensePlate,'TEST01');assert.equal(await count(),1)})
 await check('outside general plate modification succeeds with audited helper',async()=>{await seed('active',{source:'pay_on_site',amount:100,apiSuccess:false});await modification();await applyFixture();assert.equal((await read('active')).licensePlate,'TEST02');assert.equal((await db.collection('bookings/active/plateCorrections').get()).size,1)})
 await check('entry in general modification finalization preserves presence and requests recovery',async()=>{await seed('active',{apiBookingNumber:'fixture',amount:100,apiSuccess:true});await modification();onExternalCreate=async()=>{await enter(input(await prepare('active'),{time:'10:00:00'}),actor)};await rejects(applyFixture(),'VEHICLE_PRESENT');const b=await read('active');assert.equal(b.licensePlate,'TEST01');assert.equal(b.modificationRecoveryRequired,true);assert.equal(await count(),1)})
 await check('manual exit preceding latest known entry is rejected',async()=>{await seed();await event('entry');await event('entry','2026-07-17T12:00:00Z');await rejects(exit(input(await prepare('active')),actor),'EXIT_BEFORE_LAST_ENTRY');assert.equal(await count(),1);assert.equal((await read('active')).lpr.lastSeenAt,'2026-07-17T12:00:00.000Z')})
 await check('historical correction does not rewind plate ordering',async()=>{await seed();await event('entry');await event('exit','2026-07-17T10:00:00Z');await exit(input(await prepare('active'),{date:'2026-07-17',time:'09:00:00',confirmOverwrite:true}),actor);assert.equal(await count(),0);assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().lastEventAt,'2026-07-17T10:00:00.000Z')})
 await check('historical correction cannot overlap another active visit',async()=>{await seed();await event('entry');await event('exit','2026-07-17T10:00:00Z');await seed('new',{startDate:'2026-08-01',endDate:'2026-08-02'});await event('entry','2026-08-01T10:00:00Z');await rejects(exit(input(await prepare('active'),{date:'2026-08-01',time:'11:00:00',confirmOverwrite:true,confirmDuplicates:true}),actor),'EXIT_OVERLAPS_NEW_VISIT');assert.equal(await count(),1)})
 await check('global legacy occupancy mutations return 410 and preserve stay',async()=>{await seed();await event('entry');for(const action of ['reset','set_all_outside','reverse_set_all_outside_window'])assert.equal((await occupancyAction(apiReq({action}))).status,410);assert.equal(await count(),1);assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().isInside,true)})
 await check('no-show transaction ignores stale candidate after entry',async()=>{await seed('active',{source:'pay_on_site',status:'confirmed_pay_on_site'});const candidate=await db.doc('bookings/active').get();await db.doc('config/reservationSettings').update({payOnSiteAutoCancelEnabled:true});await event('entry');assert.equal(await cancelNoShow(db,candidate.ref,FieldValue,new Date('2026-07-17T12:00:00Z')),false);assert.equal(await count(),1)})
 await check('concurrent no-show and camera entry cannot erase presence',async()=>{await seed('active',{source:'pay_on_site',status:'confirmed_pay_on_site'});await db.doc('config/reservationSettings').update({payOnSiteAutoCancelEnabled:true});await Promise.all([cancelNoShow(db,db.doc('bookings/active'),FieldValue,new Date('2026-07-16T14:00:00Z')),event('entry','2026-07-16T16:00:00Z')]);assert.equal(await count(),1);assert.equal(await counter(),1)})
 await check('no-show disabled by missing config; genuine no-show changes status only',async()=>{await seed('active',{source:'pay_on_site',status:'confirmed_pay_on_site'});assert.equal(await cancelNoShow(db,db.doc('bookings/active'),FieldValue),false);await db.doc('config/reservationSettings').update({payOnSiteAutoCancelEnabled:true});assert.equal(await cancelNoShow(db,db.doc('bookings/active'),FieldValue),true);assert.equal((await read('active')).lpr,undefined);assert.equal(await counter(),0);assert.equal(await cancelNoShow(db,db.doc('bookings/active'),FieldValue),false)})
 await check('very old camera backlog is quarantined instead of asserting current presence',async()=>{
  const config=process.env.LPR_DEVICES_JSON
  try {process.env.LPR_DEVICES_JSON=JSON.stringify({intrare_1:{direction:'entry',timestampMode:'romania_wall_clock'}})
    const r=await postCamera('2020-01-01T10:00:00Z');assert.equal(r.status,200);assert.equal((await r.json()).warning,'stale_event_time');assert.equal(await count(),0);assert.equal((await observed()).lprAttention.count,1)
  } finally {process.env.LPR_DEVICES_JSON=config}
 })
 await check('source secret and device allowlist reject without writes',async()=>{assert.equal((await postCamera('2026-07-16T10:00:00Z',null)).status,401);assert.equal((await postCamera('2026-07-16T10:00:00Z','wrong')).status,401);assert.equal((await postCamera('2026-07-16T10:00:00Z','fixture-camera-secret','unknown')).status,403);assert.equal((await db.collection('lpr_events').get()).size,0);assert.equal(await count(),0)})
 await check('receipt failure responds 503; retry creates exactly one visit',async()=>{await seed();failReceipt=true;assert.equal((await postCamera('2026-07-16T10:00:00Z')).status,503);assert.equal((await db.collection('lpr_events').get()).size,0);failReceipt=false;assert.equal((await postCamera('2026-07-16T10:00:00Z')).status,200);assert.equal((await postCamera('2026-07-16T10:00:00Z')).status,200);assert.equal(await count(),1);assert.equal((await db.collection('lpr_events').get()).size,1)})
 await check('processing failure durable and visible; concurrent workers apply once',async()=>{await seed();failAssociation=1;const r=await event('entry');assert.equal(r.degraded,true);assert.equal((await observed()).lprAttention.count,1);await db.doc('lpr_events/'+r.savedEventId).update({nextAttemptAt:0});await Promise.all([retry(),retry()]);assert.equal(await count(),1);assert.equal(await counter(),1);assert.equal((await observed()).lprAttention.count,0);assert.equal((await db.collection('bookings/active/gateEvents').get()).size,1)})
 await check('failed entry followed by exit preserves receipt order and returns to zero',async()=>{
  await seed();failAssociation=1;const entry=await event('entry');const departure=await event('exit','2026-07-17T10:00:00Z');assert.equal(departure.warning,'earlier_event_pending');assert.equal(await count(),0)
  await db.doc('lpr_events/'+entry.savedEventId).update({nextAttemptAt:0});await retry();assert.equal(await count(),1)
  await db.doc('lpr_events/'+departure.savedEventId).update({nextAttemptAt:0});await retry();assert.equal(await count(),0);assert.equal(await counter(),0)
 })
 await check('persistent processing failures become visible review and can be retried by admin',async()=>{
  await seed();let e
  for(let i=0;i<10;i++){failAssociation=1;e=await event('entry')}
  let receipt=(await db.doc('lpr_events/'+e.savedEventId).get()).data();assert.equal(receipt.attempts,10);assert.equal(receipt.associationStatus,'needs_review');assert.equal(receipt.nextAttemptAt,undefined);assert.equal(await count(),0)
  const ctx=await review({eventId:e.savedEventId,action:'prepare'},actor);await review({eventId:e.savedEventId,action:'retry',version:ctx.version},actor);await retry();assert.equal(await count(),1);assert.equal(await counter(),1)
 })
 await check('legacy incomplete receipt cannot block recovery of other events',async()=>{
  await db.doc('lpr_events/legacy').set({normalizedPlate:'OLD01',eventType:'entry',accurateTime:'2026-07-16T10:00:00Z',associationStatus:'pending',nextAttemptAt:0})
  await seed();failAssociation=1;const current=await event('entry');await db.doc('lpr_events/'+current.savedEventId).update({nextAttemptAt:0});await retry()
  assert.equal((await db.doc('lpr_events/legacy').get()).data().associationReason,'invalid_pending_event');assert.equal(await count(),1)
 })
 await check('future/invalid clock quarantined, later valid entry/exit unaffected',async()=>{await seed();for(const at of ['2099-01-01T10:00:00Z','2026-02-30T10:00:00Z','bad']){const r=await event('entry',at);assert.ok(r.warning);assert.equal(await count(),0)}await event('entry');await event('exit','2026-07-17T10:00:00Z');assert.equal(await count(),0);assert.equal((await observed()).lprAttention.count,3)})
 await check('explicit real UTC mode agrees with Romania manual clock',async()=>{await seed();await enter(input(await prepare('active'),{time:'10:00:00'}),actor);const response=await postCamera('2026-07-16T08:00:00Z','fixture-camera-secret','utc_exit');assert.equal(response.status,200);assert.equal(await count(),0);assert.equal((await read('active')).lpr.departedAt,'2026-07-16T11:00:00.000Z')})
 await check('clock normalization independent of server timezone and rejects guessing',async()=>{for(const tz of ['UTC','America/New_York','Asia/Tokyo']){process.env.TZ=tz;assert.equal(parseCameraTime('2026-07-16T08:00:00Z','instant'),'2026-07-16T11:00:00.000Z');assert.equal(parseCameraTime('2026-10-25T01:30:00Z','instant'),'2026-10-25T03:30:00.000Z')}assert.equal(parseCameraTime('2026-07-16T08:00:00','instant'),null);assert.equal(parseCameraTime('2026-07-16T08:00:00+03:00','romania_wall_clock'),null);process.env.TZ='UTC'})
 await check('adding dynamic whitelist mid-stay never suppresses exit',async()=>{await seed();await event('entry');await db.doc('lpr_whitelist/TEST01').set({});await event('exit','2026-07-17T10:00:00Z');assert.equal(await count(),0);assert.equal(await counter(),0)})
 await check('adding static whitelist mid-stay never suppresses exit',async()=>{await seed();await event('entry');process.env.LPR_TOLLGATE_WHITELIST='TEST01';await event('exit','2026-07-17T10:00:00Z');assert.equal(await count(),0)})
 await check('whitelisted arrival stays excluded with durable receipt',async()=>{await db.doc('lpr_whitelist/TEST01').set({});const r=await event('entry');assert.equal(await count(),0);assert.equal((await db.doc('lpr_events/'+r.savedEventId).get()).data().associationStatus,'whitelist_skip')})
 await check('ambiguous entry visible; cannot auto-retry; explicit audited review after correction',async()=>{await seed('a');await seed('b');const e=await event('entry');assert.equal(await count(),0);const obs=await observed();assert.equal(obs.lprAttention.count,1);assert.equal(obs.lprAttention.events[0].reason,'ambiguous_reservations');const ctx=await review({eventId:e.savedEventId,action:'prepare'},actor);await rejects(review({eventId:e.savedEventId,action:'retry',version:ctx.version},actor),'MANUAL_REVIEW_REQUIRED');await enter(input(await prepare('a'),{time:'10:00:00'}),actor);await rejects(review({eventId:e.savedEventId,action:'resolve',version:ctx.version,confirmed:true,note:'Verified'},actor),'CONTEXT_CHANGED');const fresh=await review({eventId:e.savedEventId,action:'prepare'},actor);await review({eventId:e.savedEventId,action:'resolve',version:fresh.version,confirmed:true,note:'Physical car present; entry recorded on a'},actor);assert.equal(await count(),1);assert.equal((await observed()).lprAttention.count,0);assert.equal((await db.doc('lpr_events/'+e.savedEventId).get()).data().review.uid,actor.uid)})
 await check('historical correction cannot overlap the entry of a newer already-closed stay',async()=>{
  await seed();await event('entry');await event('exit','2026-07-17T10:00:00Z');await seed('new',{startDate:'2026-08-01',endDate:'2026-08-03'});await event('entry','2026-08-01T10:00:00Z');await event('exit','2026-08-03T10:00:00Z')
  await rejects(exit(input(await prepare('active'),{date:'2026-08-02',confirmOverwrite:true}),actor),'EXIT_OVERLAPS_NEW_VISIT');assert.equal(await count(),0)
 })
 await check('manual and camera events: 60-step model never differs from counted physical stays',async()=>{
  for(let i=0;i<6;i++)await seed('model-'+i,{licensePlate:'MODEL'+i})
  const present=new Set()
  for(let step=0;step<60;step++) {
    const n=(step*7+Math.floor(step/6))%6, plate='MODEL'+n, id='model-'+n, type=present.has(plate)?'exit':'entry'
    const at=new Date(Date.parse('2026-07-16T10:00:00Z')+step*60000).toISOString()
    if(step%3===0){const ctx=await prepare(id);await (type==='entry'?enter:exit)(input(ctx,{time:at.slice(11,19)}),actor)}
    else {await event(type,at,plate);await event(type,at,plate)}
    if(type==='entry')present.add(plate);else present.delete(plate)
    const obs=await observed();assert.equal(obs.occupiedCount,present.size,'step '+step);assert.equal(await counter(),present.size,'counter step '+step)
    assert.deepEqual(obs.plates.map(x=>x.licensePlate).sort(),[...present].sort())
    for(const row of obs.plates){const pointer=(await db.doc('lpr_plate_state/'+row.licensePlate).get()).data();assert.equal(pointer.bookingId,row.id);assert.equal(pointer.isInside,true)}
  }
 })
 await check('12 simultaneous arrivals, replays and departures converge without lost or double occupancy',async()=>{
  const plates=Array.from({length:12},(_,i)=>'BURST'+i)
  for(const plate of plates)await seed(plate,{licensePlate:plate})
  async function drain(){for(let i=0;i<6;i++){const pending=await db.collection('lpr_events').where('associationStatus','==','pending').get();if(pending.empty)return;for(const d of pending.docs)await d.ref.update({nextAttemptAt:0});await retry()}assert.fail('pending events did not converge')}
  await Promise.all(plates.map(p=>event('entry','2026-07-16T10:00:00Z',p)));await drain();assert.equal(await count(),12);assert.equal(await counter(),12)
  await Promise.all(plates.map(p=>event('entry','2026-07-16T10:00:00Z',p)));assert.equal(await count(),12)
  await Promise.all(plates.map(p=>event('exit','2026-07-16T11:00:00Z',p)));await drain();assert.equal(await count(),0);assert.equal(await counter(),0)
  assert.equal((await observed()).lprAttention.count,0)
 })
 await check('admin routes and retry worker enforce authorization',async()=>{for(const fn of [plateHTTP,reviewHTTP,removeBooking]){assert.equal((await fn(apiReq({},null))).status,401);assert.equal((await fn(apiReq({},'employee'))).status,403)}delete process.env.CRON_SECRET;assert.equal((await workerHTTP(new Request('http://localhost/api/cron/lpr-retry'))).status,503);process.env.CRON_SECRET='fixture-cron';assert.equal((await workerHTTP(new Request('http://localhost/api/cron/lpr-retry'))).status,401);assert.equal((await workerHTTP(new Request('http://localhost/api/cron/lpr-retry',{headers:{Authorization:'Bearer fixture-cron'}}))).status,200)})
 await check('occupancy list does not use drifting cached counter',async()=>{await seed();await event('entry');await db.doc('config/parkingLive').set({occupiedCount:999});assert.equal(await count(),1)})
 console.log(`PASS ${passed} occupancy integrity scenarios`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>deleteApp(app))
