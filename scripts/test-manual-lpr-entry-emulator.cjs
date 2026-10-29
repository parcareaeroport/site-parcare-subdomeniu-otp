// Synthetic data only. Refuses production; run sequentially with other emulator suites.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const app = initializeApp({ projectId:'demo-parking-lpr' }, 'manual-entry-tests'), db = getFirestore(app)
const {initializeApp:clientInit,deleteApp:clientDelete}=require('firebase/app'), sdk=require('firebase/firestore')
const clientApp=clientInit({projectId:'demo-parking-lpr',apiKey:'emulator-only',appId:'emulator-only'},'manual-entry-tests');const clientDb=sdk.getFirestore(clientApp);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');sdk.connectFirestoreEmulator(clientDb,host,Number(port))
const root = path.resolve(__dirname, '..'), cache = new Map()
// Exercise real role authorization; only cryptographic token verification is stubbed.
const adminAuth = { verifyIdToken: async token => {
  if (!['admin', 'employee', 'entriesOperator'].includes(token)) throw Error('Invalid fixture token')
  return { uid: `${token}-test`, email: `${token}@example.invalid`, role: token }
} }
const post = (body, token) => POST(new Request('http://localhost/api/admin/manual-lpr-entry', {
  method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
}))
function load(relative) {
  const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename).exports
  const mod = {exports:{}}; cache.set(filename,mod)
  const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
  new Function('require','module','exports',js)(name => {
    if(name==='server-only') return {}
    if(name==='@/lib/firebase-admin') return {adminDb:db,adminAuth}
    if(name==='@/lib/firebase'||name==='./firebase') return {db:clientDb}
    if(name.startsWith('@/')) return load(name.slice(2)+'.ts')
    if(name.startsWith('.')) return load(path.relative(root,path.resolve(path.dirname(filename),name))+'.ts')
    return require(name)
  },mod,mod.exports);return mod.exports
}
const {prepareManualExit:prepare,saveManualExit:exit,manualExitClock:clock}=load('lib/manual-lpr-exit.server.ts')
const {saveManualEntry:save,createManualBookingRecord:create}=load('lib/manual-lpr-entry.server.ts')
const {handleLprEvent}=load('lib/lpr-service.ts')
const {getLprPresenceState}=load('lib/lpr-presence.ts')
const {POST}=load('app/api/admin/manual-lpr-entry/route.ts')
const actor={uid:'admin-test',email:'admin@example.invalid'}
const base={licensePlate:'TEST01',status:'confirmed_paid',startDate:'2026-07-16',startTime:'10:00',endDate:'2026-07-21',endTime:'20:00'}
const current=()=>({...base,startDate:clock().slice(0,10),startTime:'00:00',endDate:clock().slice(0,10),endTime:'23:59'})
const camera=(type,at,plate='TEST01')=>handleLprEvent({plateNumber:plate,deviceId:type==='entry'?'intrare_1':'iesire_1',direction:type,snapTime:at,accurateTime:at,laneNo:1})
const seed=(id='active',patch={})=>db.doc('bookings/'+id).set({...base,...patch})
const read=async(id='active')=>(await db.doc('bookings/'+id).get()).data()
const count=async()=>(await db.doc('config/parkingLive').get()).data().occupiedCount
const open=async()=> (await db.collection('bookings').get()).docs.filter(d=>getLprPresenceState(d.data()).isEffectivelyInside)
const input=(ctx,patch={})=>({bookingId:ctx.booking.id,version:ctx.version,requestId:require('node:crypto').randomUUID(),date:'2026-07-16',time:'10:00:00',...patch})
// Execute the actual server-action function body; external parking transport is a fake.
// This exercises auth/order of operations without importing unrelated payment integrations.
const source=ts.createSourceFile('actions.ts',fs.readFileSync(root+'/app/actions/booking-actions.ts','utf8'),ts.ScriptTarget.Latest,true)
const actionNode=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='createManualBooking')
assert.ok(actionNode)
let externalCalls=0, externalStatus=200
const actionDeps={...load('lib/server-firestore.ts'),normalizeLicensePlate:load('lib/utils.ts').normalizeLicensePlate,
 authorizeAdminRequest:load('lib/admin-api-auth.ts').authorizeAdminRequest,createManualBookingRecord:create,
 API_CONFIG:{url:'https://fixture.invalid/parking',username:'fixture',password:'fixture',multiparkId:'fixture'},
 fetch:async(url)=>{assert.equal(url,'https://fixture.invalid/parking');externalCalls++;return new Response('<ErrorCode>1</ErrorCode><Message>Fixture success</Message>',{status:externalStatus})},
 console:{log(){},error(){}}}
const actionModule={}
new Function('exports',...Object.keys(actionDeps),ts.transpileModule(actionNode.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(actionModule,...Object.values(actionDeps))
const form=(token='admin')=>{const f=new FormData();for(const [k,v] of Object.entries({...current(),manualIsInside:'true',adminToken:token}))f.set(k,v);return f}
let n=0
async function check(name,run){assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-parking-lpr/databases/(default)/documents`,{method:'DELETE'})).ok);await db.doc('config/parkingLive').set({occupiedCount:0});await run();console.log('PASS',name);n++}
async function rejected(p,code){await assert.rejects(p,e=>e.code===code)}
;(async()=>{
 await check('manual entry writes visit, pointer, verified audit; camera exit closes it',async()=>{
  await seed();const r=await save(input(await prepare('active')),actor)
  assert.equal(await count(),1);assert.equal((await open()).length,1)
  const b=await read();assert.equal(b.lpr.visitId,r.visitId);assert.equal(b.lpr.arrivedAt,'2026-07-16T10:00:00.000Z')
  assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().bookingId,'active')
  assert.equal((await db.doc('lpr_events/'+r.lprEventId).get()).data().adminUid,actor.uid)
  assert.equal((await db.collection('bookings/active/gateEvents').get()).size,1)
  assert.equal((await camera('exit','2026-07-17T10:00:00Z')).matchedBookingId,'active');assert.equal(await count(),0)
 })
 await check('camera entry then protected manual exit closes same visit once',async()=>{
  await seed();await camera('entry','2026-07-16T10:00:00Z');const visit=(await read()).lpr.visitId
  await exit(input(await prepare('active'),{date:'2026-07-17'}),actor)
  assert.equal((await read()).lpr.visitId,visit);assert.equal(await count(),0);assert.equal((await open()).length,0)
 })
 await check('same-plate presence blocks manual entry even with duplicate confirmation',async()=>{
  await seed('old',{licensePlate:'test-01',lpr:{isInside:true,arrivedAt:'2026-07-16T09:00:00Z'}});await seed()
  const before=await read();const ctx=await prepare('active');assert.equal(ctx.duplicates.length,1)
  await rejected(save(input(ctx,{confirmDuplicates:true}),actor),'DUPLICATE_PRESENCE')
  assert.deepEqual(await read(),before);assert.equal((await db.collection('lpr_events').get()).size,0)
 })
 await check('two manual entries for different bookings serialize by normalized plate',async()=>{
  await seed('a');await seed('b',{licensePlate:'test-01'})
  const a=input(await prepare('a')),b=input(await prepare('b'))
  const results=await Promise.allSettled([save(a,actor),save(b,actor)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONTEXT_CHANGED')
  assert.equal((await open()).length,1);assert.equal(await count(),1)
 })
 await check('same request retried concurrently creates one event and one count',async()=>{
  await seed();const payload=input(await prepare('active'));const results=await Promise.all([save(payload,actor),save(payload,actor)])
  assert.deepEqual(results[0],results[1]);assert.equal(await count(),1);assert.equal((await db.collection('lpr_events').get()).size,1)
  await rejected(save({...payload,time:'11:00'},actor),'REQUEST_REUSED')
 })
 await check('exit/reentry after dialog invalidates entry correction',async()=>{
  await seed();await camera('entry','2026-07-16T10:00:00Z');const ctx=await prepare('active')
  await camera('exit','2026-07-17T10:00:00Z');await camera('entry','2026-07-18T10:00:00Z')
  const visit=(await read()).lpr.visitId
  await rejected(save(input(ctx,{date:'2026-07-19',confirmOverwrite:true}),actor),'CONTEXT_CHANGED')
  assert.equal((await read()).lpr.visitId,visit);assert.equal(await count(),1)
 })
 await check('legacy row without visitId also blocks stale dialog',async()=>{
  await seed();const ctx=await prepare('active');await db.doc('bookings/active').update({'lpr.lastSeenAt':'2026-07-16T11:00:00Z'})
  await rejected(save(input(ctx),actor),'CONTEXT_CHANGED')
 })
 for(const [name,patch,code] of [
  ['future',{date:'2099-07-16'},'FUTURE_ENTRY'],
  ['invalid calendar date',{date:'2026-02-30'},'INVALID_TIME'],
  ['invalid hour',{time:'25:00'},'INVALID_TIME'],
  ['outside booking period',{date:'2026-10-20'},'ENTRY_OUTSIDE_PERIOD']]) {
  await check(name+' leaves booking/counter/audit unchanged',async()=>{
   await seed();const before=await read();await rejected(save(input(await prepare('active'),patch),actor),code)
   assert.deepEqual(await read(),before);assert.equal(await count(),0);assert.equal((await db.collection('lpr_events').get()).size,0)
  })
 }
 await check('newer exit on another booking prevents historical reopening',async()=>{
  await seed();await seed('newer',{lpr:{isInside:false,departedAt:'2026-07-20T12:00:00Z'}})
  await rejected(save(input(await prepare('active')),actor),'ENTRY_BEFORE_EVENT');assert.equal((await open()).length,0)
 })
 await check('cancelled booking cannot be reopened',async()=>{await seed('active',{status:'cancelled'});await rejected(save(input(await prepare('active')),actor),'INACTIVE_BOOKING')})
 await check('entry correction requires confirmation, retains visit and count',async()=>{
  await seed();await camera('entry','2026-07-16T10:00:00Z');const ctx=await prepare('active'),visit=(await read()).lpr.visitId
  await rejected(save(input(ctx,{time:'10:05'}),actor),'CONFIRM_OVERWRITE')
  await save(input(ctx,{time:'10:05',confirmOverwrite:true}),actor);assert.equal(await count(),1);assert.equal((await read()).lpr.visitId,visit)
 })
 await check('valid reentry clears previous departure and assigns a new visit',async()=>{
  await seed();await camera('entry','2026-07-16T10:00:00Z');const visit=(await read()).lpr.visitId
  await camera('exit','2026-07-17T10:00:00Z');await save(input(await prepare('active'),{date:'2026-07-18'}),actor)
  assert.notEqual((await read()).lpr.visitId,visit);assert.equal((await read()).lpr.departedAt,null);assert.equal(await count(),1)
 })
 await check('booking times with seconds accepted, invalid reservation calendar rejected',async()=>{
  await seed('active',{startTime:'10:00:00',endTime:'20:00:00'});await save(input(await prepare('active')),actor);assert.equal(await count(),1)
  await seed('bad',{licensePlate:'BAD01',startDate:'2026-02-30',endDate:'2026-03-02'})
  await rejected(save(input(await prepare('bad'),{date:'2026-03-01'}),actor),'ENTRY_OUTSIDE_PERIOD')
 })
 await check('manual booking with presence atomically creates arrival, pointer, audit and count',async()=>{
  const before=clock();const ref=await create(current(),true,actor);const b=await read(ref.id)
  assert.equal(b.lpr.isInside,true);assert.ok(b.lpr.arrivedAt>=before&&b.lpr.arrivedAt<=clock())
  assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().visitId,b.lpr.visitId)
  assert.equal((await db.collection('bookings/'+ref.id+'/gateEvents').get()).size,1);assert.equal(await count(),1)
 })
 await check('manual booking without presence does not occupy or create camera state',async()=>{
  const ref=await create(current(),false,actor);assert.equal((await read(ref.id)).lpr,undefined)
  assert.equal((await open()).length,0);assert.equal(await count(),0);assert.equal((await db.collection('lpr_plate_state').get()).size,0)
 })
 await check('duplicate manual booking creation is rejected without a partial document',async()=>{
  await create({...current(),licensePlate:'test-01'},true,actor)
  await rejected(create(current(),true,actor),'DUPLICATE_PRESENCE')
  assert.equal((await db.collection('bookings').get()).size,1);assert.equal(await count(),1)
 })
 await check('simultaneous manual creations: only one booking and one occupied place',async()=>{
  const results=await Promise.allSettled([create(current(),true,actor),create({...current(),licensePlate:'test-01'},true,actor)])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'DUPLICATE_PRESENCE')
  assert.equal((await db.collection('bookings').get()).size,1);assert.equal(await count(),1)
 })
 await check('manual creation racing camera entry never creates two presences',async()=>{
  const at=clock()
  const results=await Promise.allSettled([create(current(),true,actor),camera('entry',at)])
  for(const r of results) if(r.status==='rejected')assert.equal(r.reason.code,'DUPLICATE_PRESENCE')
  assert.equal((await open()).length,1);assert.equal(await count(),1)
 })
 await check('manual entry racing camera entry preserves one visit and counter',async()=>{
  await seed();const payload=input(await prepare('active'))
  const results=await Promise.allSettled([save(payload,actor),camera('entry','2026-07-16T10:00:01Z')])
  for(const r of results) if(r.status==='rejected')assert.equal(r.reason.code,'CONTEXT_CHANGED')
  assert.equal((await open()).length,1);assert.equal(await count(),1)
 })
 await check('pre-counted booking compatibility: entry does not increment reservation cache twice',async()=>{
  await seed('active',{occupancyIncremented:true,occupancyDecremented:false});await db.doc('config/parkingLive').set({occupiedCount:1})
  await save(input(await prepare('active')),actor);assert.equal(await count(),1)
  await camera('exit','2026-07-17T10:00:00Z');assert.equal(await count(),0)
 })
 for(const role of ['admin','employee','entriesOperator']) {
  await check('HTTP '+role+' entry uses verified actor and rejects forged actor',async()=>{
   await seed();const prepared=await post({action:'prepare',bookingId:'active'},role);assert.equal(prepared.status,200)
   const response=await post({...input(await prepared.json()),action:'save',adminUid:'forged'},role);assert.equal(response.status,200)
   const result=await response.json();assert.equal((await db.doc('lpr_events/'+result.lprEventId).get()).data().adminUid,role+'-test')
  })
 }
 await check('HTTP missing/invalid authorization cannot read or write',async()=>{
  await seed();for(const token of [undefined,'bad'])assert.equal((await post({action:'prepare',bookingId:'active'},token)).status,401)
  assert.equal((await open()).length,0);assert.equal((await db.collection('lpr_events').get()).size,0)
 })
 for(const operation of ['entry','creation']) {
  await check('transaction failure rolls back '+operation+', presence, audit, pointer and count',async()=>{
   await seed();const before=await read(),payload=input(await prepare('active'))
   const original=db.runTransaction.bind(db)
   db.runTransaction=callback=>original(async tx=>{await callback(tx);throw Error('injected commit abort')})
   try{await assert.rejects(operation==='entry'?save(payload,actor):create({...current(),licensePlate:'NEW01'},true,actor),/injected commit abort/)}finally{db.runTransaction=original}
   assert.deepEqual(await read(),before);assert.equal((await db.collection('bookings').get()).size,1)
   assert.equal((await db.collection('lpr_events').get()).size,0);assert.equal((await db.collection('lpr_plate_state').get()).size,0);assert.equal(await count(),0)
  })
 }
 await check('server action rejects unauthenticated manual creation before Firestore/API',async()=>{
  externalCalls=0;const result=await actionModule.createManualBooking(form(''))
  assert.equal(result.success,false);assert.equal(externalCalls,0);assert.equal((await db.collection('bookings').get()).size,0)
 })
 await check('server action duplicate guard stops before external parking request',async()=>{
  await create(current(),true,actor);externalCalls=0
  const result=await actionModule.createManualBooking(form());assert.equal(result.success,false);assert.match(result.message,/deja în parcare/)
  assert.equal(externalCalls,0);assert.equal((await db.collection('bookings').get()).size,1);assert.equal(await count(),1)
 })
 await check('server action creates manual booking and retains visit after mocked parking API success',async()=>{
  await db.doc('config/reservationStats').set({activeBookingsCount:0});externalCalls=0;externalStatus=200
  const result=await actionModule.createManualBooking(form());assert.equal(result.success,true);assert.equal(externalCalls,1)
  const b=await read(result.bookingId);assert.equal(b.status,'confirmed_paid');assert.equal(b.apiSuccess,true);assert.equal(b.lpr.isInside,true);assert.equal(await count(),1)
  assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().bookingId,result.bookingId)
 })
 await check('external API failure does not erase confirmed physical presence',async()=>{
  externalStatus=503;externalCalls=0
  try{const result=await actionModule.createManualBooking(form());assert.equal(result.success,true);assert.equal(externalCalls,1)
   const b=await read(result.bookingId);assert.equal(b.status,'api_error');assert.equal(b.lpr.isInside,true);assert.equal(await count(),1)
   await new Promise(resolve=>setTimeout(resolve,1100));const at=clock();assert.equal((await camera('exit',at)).matchedBookingId,result.bookingId);assert.equal(await count(),0)
  }finally{externalStatus=200}
 })
 console.log(`${n} protected manual-entry scenarios passed`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await sdk.terminate(clientDb);await clientDelete(clientApp);await deleteApp(app)})
