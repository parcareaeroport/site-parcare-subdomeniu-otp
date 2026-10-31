// Actual camera -> deletion -> plate correction -> recovery APIs. Demo data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{randomUUID}=require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/)
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
const project='demo-lpr-restoration',app=initializeApp({projectId:project},'restoration-tests'),db=getFirestore(app),root=path.resolve(__dirname,'..'),cache=new Map()
function load(relative){const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports
 const mod={exports:{}};cache.set(file,mod)
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText)(name=>{
  if(name==='server-only')return {}
  if(name==='@/lib/firebase-admin')return {adminDb:db,adminAuth:{verifyIdToken:async token=>{if(!['admin','employee','entriesOperator'].includes(token))throw Error('Invalid fixture token');return {uid:token+'-test',email:token+'@example.invalid',role:token}}}}
  if(name==='@/app/actions/booking-actions')return {cancelBooking:async()=>{throw Error('External cancellation forbidden')}}
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts')
  if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name))+'.ts')
  return require(name)
 },mod,mod.exports);return mod.exports
}
const {POST:entry}=load('app/api/admin/manual-lpr-entry/route.ts'),{POST:plate}=load('app/api/admin/bookings/plate/route.ts')
const {GET:occupancy}=load('app/api/admin/occupancy/route.ts')
const {prepareBookingDeletion,saveBookingDeletion}=load('lib/booking-deletion.server.ts')
const {handleLprEvent:camera}=load('lib/lpr-service.ts'),{manualExitClock:wall}=load('lib/manual-lpr-exit.server.ts')
const actor={uid:'admin-test',email:'admin@example.invalid'}
const post=(handler,body,role='admin')=>handler(new Request('http://localhost/api/admin/test',{method:'POST',headers:{Authorization:'Bearer '+role},body:JSON.stringify(body)}))
const read=async p=>(await db.doc(p).get()).data()
const event=(type,at,number='NEW01')=>camera({plateNumber:number,deviceId:type==='entry'?'intrare_1':'iesire_1',direction:type,snapTime:at,accurateTime:at})
async function totals(n){const r=await occupancy(new Request('http://localhost/api/admin/occupancy',{headers:{Authorization:'Bearer admin'}}));assert.equal(r.status,200);assert.equal((await r.json()).occupiedCount,n);assert.equal((await read('config/parkingLive')).occupiedCount,n)}
async function setup(){
 const now=wall(),arrival=new Date(Date.parse(now)-3600000).toISOString(),day=now.slice(0,10)
 await db.doc('bookings/target').set({licensePlate:'OLD01',status:'confirmed_paid',startDate:day,startTime:'00:00',endDate:day,endTime:'23:59'})
 const cameraResult=await event('entry',arrival),sourceId=cameraResult.matchedBookingId;assert.ok(sourceId);await totals(1)
 const deletion=await prepareBookingDeletion(sourceId)
 const deleteInput={bookingId:sourceId,version:deletion.version,requestId:randomUUID(),confirmNotPresent:true}
 await saveBookingDeletion(deleteInput,actor);await totals(0)
 const p=await post(plate,{action:'prepare',bookingId:'target',plate:'NEW01'});assert.equal(p.status,200);const pc=await p.json()
 assert.equal((await post(plate,{action:'save',bookingId:'target',plate:'NEW01',version:pc.version})).status,200)
 const ctx=await (await post(entry,{action:'prepare',bookingId:'target'})).json();assert.ok(ctx.restoration,JSON.stringify(ctx))
 const input={action:'save',bookingId:'target',version:ctx.version,entryMode:'restore_deleted_visit',requestId:randomUUID(),
  restorationVersion:ctx.restoration.version,restorationReason:'Numărul rezervării era greșit; mașina nu a plecat.',confirmRestoration:true,
  date:arrival.slice(0,10),time:arrival.slice(11,19)}
 return {ctx,input,sourceId,cameraResult,arrival,deleteInput}
}
let passed=0
async function check(name,fn){assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'})).ok);await db.doc('config/parkingLive').set({occupiedCount:0});await fn();console.log('PASS '+name);passed++}
;(async()=>{
 for(const role of ['admin','employee','entriesOperator'])await check(role+' restores corrected reservation once; stale camera cannot undo; real exit subtracts once',async()=>{
  const s=await setup(),before=await read('deleted_bookings/'+s.sourceId)
  const response=await post(entry,{...s.input,adminUid:'forged'},role);assert.equal(response.status,200,JSON.stringify(await response.clone().json()))
  const result=await response.json();await totals(1)
  assert.equal((await post(entry,{...s.input,adminUid:'forged'},role)).status,200);await totals(1)
  const b=await read('bookings/target');assert.equal(b.licensePlate,'NEW01');assert.equal(b.originalLicensePlate,'OLD01')
  assert.equal(b.lpr.visitId,before.lpr.visitId);assert.equal(b.lpr.arrivedAt,s.input.date+'T'+s.input.time+'.000Z')
  assert.equal((await db.doc('bookings/'+s.sourceId).get()).exists,false)
  const archived=await read('deleted_bookings/'+s.sourceId);assert.equal(archived.lpr.isInside,false);assert.equal(archived.restoredLprToBookingId,'target')
  assert.deepEqual(archived.deletionOperation,before.deletionOperation)
  const correctionId=before.lpr.presenceCorrection.eventId
  assert.equal((await read('lpr_events/'+correctionId)).supersededBy,result.lprEventId)
  assert.equal((await read('lpr_events/'+result.lprEventId)).adminUid,role+'-test')
  assert.equal((await read('lpr_events/'+s.cameraResult.savedEventId)).matchedBookingId,'target')
  await saveBookingDeletion(s.deleteInput,actor);await totals(1)
  const stale=await event('exit',new Date(Date.parse(wall())-60000).toISOString());assert.equal(stale.warning,'out_of_order_event');await totals(1)
  await new Promise(r=>setTimeout(r,1100));const exit=await event('exit',wall());assert.equal(exit.matchedBookingId,'target');await totals(0)
  await event('exit',wall());await totals(0)
 })
 await check('confirmation and reason required, ordinary historical entry stays blocked',async()=>{
  const s=await setup()
  for(const patch of [{confirmRestoration:false},{restorationReason:''},{restorationReason:'x'.repeat(1001)},{useServerNow:true}])assert.equal((await post(entry,{...s.input,...patch})).status,409)
  const ordinary=await post(entry,{...s.input,entryMode:'new_visit'});assert.equal(ordinary.status,409);assert.equal((await ordinary.json()).code,'LATER_EXIT')
  await totals(0);assert.equal((await read('bookings/target')).lpr,undefined)
 })
 await check('real camera exit prevents recovery, including pending evidence',async()=>{
  const s=await setup();await db.doc('lpr_events/actual-exit').set({normalizedPlate:'NEW01',eventType:'exit',eventTime:wall(),associationStatus:'pending'})
  const ctx=await (await post(entry,{action:'prepare',bookingId:'target'})).json();assert.equal(ctx.restoration,null)
  assert.equal((await post(entry,s.input)).status,409);await totals(0)
 })
 await check('another present car and changed archive invalidate recovery',async()=>{
  const s=await setup();await db.doc('deleted_bookings/'+s.sourceId).update({lastUpdated:new Date()})
  assert.equal((await post(entry,s.input)).status,409);await totals(0)
  await db.doc('bookings/other').set({licensePlate:'NEW01',status:'unmatched_lpr',lpr:{isInside:true,arrivedAt:s.arrival,visitId:'other'}})
  await db.doc('config/parkingLive').update({occupiedCount:1})
  assert.equal((await post(entry,s.input)).status,409);await totals(1)
 })
 await check('two requests or two corrected reservations cannot restore twice',async()=>{
  const s=await setup(),target=await read('bookings/target');await db.doc('bookings/other').set(target)
  const other=await (await post(entry,{action:'prepare',bookingId:'other'})).json();assert.ok(other.restoration)
  const responses=await Promise.all([post(entry,s.input),post(entry,{...s.input,bookingId:'other',version:other.version,restorationVersion:other.restoration.version,requestId:randomUUID()})])
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);await totals(1)
 })
 await check('failure rolls back presence, cache, archive and superseded receipt together',async()=>{
  const s=await setup(),before=await read('deleted_bookings/'+s.sourceId),original=db.runTransaction.bind(db)
  db.runTransaction=fn=>original(async tx=>{await fn(tx);throw Error('injected restoration abort')})
  try{assert.equal((await post(entry,s.input)).status,503)}finally{db.runTransaction=original}
  await totals(0);assert.equal((await read('bookings/target')).lpr,undefined)
  assert.deepEqual(await read('deleted_bookings/'+s.sourceId),before)
  assert.equal((await read('lpr_events/'+before.lpr.presenceCorrection.eventId)).supersededBy,undefined)
 })
 await check('historical accounting drift is reconciled without counting another car twice',async()=>{
  const s=await setup();await db.doc('bookings/unrelated').set({licensePlate:'OTHER',lpr:{isInside:true,arrivedAt:s.arrival}})
  await db.doc('config/parkingLive').update({occupiedCount:999})
  const ctx=await (await post(entry,{action:'prepare',bookingId:'target'})).json()
  assert.equal((await post(entry,{...s.input,version:ctx.version,restorationVersion:ctx.restoration.version})).status,200)
  await totals(2);assert.equal((await read('bookings/unrelated')).lpr.isInside,true)
 })
 await check('later camera reread of restored visit does not add another place',async()=>{
  const s=await setup();assert.equal((await post(entry,s.input)).status,200);await totals(1)
  await new Promise(r=>setTimeout(r,1100));const reread=await event('entry',wall());assert.equal(reread.matchedBookingId,'target');await totals(1)
  await new Promise(r=>setTimeout(r,1100));assert.equal((await event('exit',wall())).matchedBookingId,'target');await totals(0)
 })
 await check('backdating arrival cannot cross an actual exit before the archived camera arrival',async()=>{
  const s=await setup(),earlier=new Date(Date.parse(s.arrival)-600000).toISOString()
  await db.doc('lpr_events/earlier-exit').set({normalizedPlate:'NEW01',eventType:'exit',eventTime:new Date(Date.parse(s.arrival)-300000).toISOString(),associationStatus:'needs_review'})
  const ctx=await (await post(entry,{action:'prepare',bookingId:'target'})).json();assert.ok(ctx.restoration)
  const r=await post(entry,{...s.input,version:ctx.version,restorationVersion:ctx.restoration.version,date:earlier.slice(0,10),time:earlier.slice(11,19)})
  assert.equal(r.status,409);assert.equal((await r.json()).code,'RESTORE_UNAVAILABLE');await totals(0)
 })
 await check('recovery racing a fresh camera entry never creates two presences',async()=>{
  const s=await setup();await new Promise(r=>setTimeout(r,1100))
  const [manual]=await Promise.all([post(entry,s.input),event('entry',wall())])
  assert.ok([200,409].includes(manual.status));await totals(1)
  const open=await db.collection('bookings').where('lpr.isInside','==',true).get();assert.equal(open.size,1);assert.equal(open.docs[0].id,'target')
 })
 console.log(`PASS ${passed} restoration scenarios`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>deleteApp(app))
