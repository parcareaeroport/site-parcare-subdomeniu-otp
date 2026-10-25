// Synthetic data only. Refuses production; run sequentially with other emulator suites.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const app = initializeApp({ projectId:'demo-parking-lpr' }, 'manual-exit-tests'), db = getFirestore(app)
const {initializeApp:clientInit,deleteApp:clientDelete}=require('firebase/app'), sdk=require('firebase/firestore')
const clientApp=clientInit({projectId:'demo-parking-lpr',apiKey:'emulator-only',appId:'emulator-only'},'manual-exit-tests');const clientDb=sdk.getFirestore(clientApp);const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');sdk.connectFirestoreEmulator(clientDb,host,Number(port))
const root = path.resolve(__dirname, '..'), cache = new Map()
let authorized = true
function load(relative) {
  const filename = path.resolve(root, relative); if (cache.has(filename)) return cache.get(filename).exports
  const mod = {exports:{}}; cache.set(filename,mod)
  const js = ts.transpileModule(fs.readFileSync(filename,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
  new Function('require','module','exports',js)(name => {
    if(name==='server-only') return {}
    if(name==='@/lib/firebase-admin') return {adminDb:db}
    if(name==='@/lib/admin-api-auth') return {authorizeAdminRequest:async()=>authorized?{ok:true,user:{uid:'admin-test',email:'admin@example.invalid',role:'admin'}}:{ok:false,response:new Response('{}',{status:403})}}
    if(name==='@/lib/firebase'||name==='./firebase') return {db:clientDb}
    if(name.startsWith('@/')) return load(name.slice(2)+'.ts')
    if(name.startsWith('.')) return load(path.relative(root,path.resolve(path.dirname(filename),name))+'.ts')
    return require(name)
  },mod,mod.exports);return mod.exports
}
const {prepareManualExit:prepare,saveManualExit:save,manualExitClock:clock,parseManualExitClock:parse}=load('lib/manual-lpr-exit.server.ts')
const {handleLprEvent}=load('lib/lpr-service.ts')
const {getLprPresenceState}=load('lib/lpr-presence.ts')
const {POST}=load('app/api/admin/manual-lpr-exit/route.ts')
const camera=(eventType,at)=>handleLprEvent({plateNumber:'TEST01',deviceId:eventType==='entry'?'intrare_1':'iesire_1',direction:eventType,snapTime:at,accurateTime:at,laneNo:1})
const actor={uid:'admin-test',email:'admin@example.invalid'}
const base={licensePlate:'TEST01',status:'confirmed_paid',startDate:'2026-07-16',startTime:'10:00',endDate:'2026-07-21',endTime:'20:00',occupancyIncremented:true,occupancyDecremented:false,lpr:{isInside:true,visitId:'first',arrivedAt:'2026-07-16T10:00:00Z',lastSeenAt:'2026-07-16T10:00:00Z',lastEventType:'entry'}}
let n=0
const seed=(id='active',patch={})=>db.doc('bookings/'+id).set({...base,...patch})
const read=async(id='active')=>(await db.doc('bookings/'+id).get()).data()
const count=async()=>(await db.doc('config/parkingLive').get()).data().occupiedCount
const input=(ctx,patch={})=>({bookingId:ctx.booking.id,version:ctx.version,requestId:require('node:crypto').randomUUID(),date:'2026-07-17',time:'10:00:00',...patch})
async function check(name,run){assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-parking-lpr/databases/(default)/documents`,{method:'DELETE'})).ok);await db.doc('config/parkingLive').set({occupiedCount:1});await run();console.log('PASS',name);n++}
async function rejected(p,code){await assert.rejects(p,e=>e.code===code);assert.equal((await db.collection('lpr_events').get()).size,0)}
;(async()=>{
 await check('valid manual exit closes only selected booking, pointer and counter with audit',async()=>{
  await seed();await db.doc('lpr_plate_state/TEST01').set({bookingId:'active',visitId:'first',isInside:true});const ctx=await prepare('active');const r=await save(input(ctx),actor)
  assert.equal(r.occupancyChanged,'decremented');assert.equal((await read()).lpr.isInside,false);assert.equal(await count(),0)
  assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().isInside,false)
  assert.equal((await db.doc('lpr_events/'+r.lprEventId).get()).data().adminUid,actor.uid)
  assert.equal((await db.collection('bookings/active/gateEvents').get()).size,1)
 })
 await check('exit before arrival rejected without writes',async()=>{await seed();await rejected(save(input(await prepare('active'),{date:'2026-07-15'}),actor),'EXIT_BEFORE_ENTRY');assert.equal(await count(),1)})
 await check('future exit rejected using Romania server clock',async()=>{await seed();await rejected(save(input(await prepare('active'),{date:'2099-01-01'}),actor),'FUTURE_EXIT')})
 await check('invalid calendar/time rejected',async()=>{await seed();const ctx=await prepare('active');for(const x of [{date:'2026-02-30'},{time:'25:00:00'},{time:'10:60'},{date:'2026-7-17'}])await rejected(save(input(ctx,x),actor),'INVALID_TIME')})
 await check('missing arrival requires explicit audited confirmation',async()=>{await seed('active',{lpr:{isInside:true}});const ctx=await prepare('active');assert.equal(ctx.arrival,null);await rejected(save(input(ctx),actor),'CONFIRM_MISSING_ARRIVAL');const r=await save(input(ctx,{confirmMissingArrival:true}),actor);assert.equal((await db.doc('lpr_events/'+r.lprEventId).get()).data().confirmations.missingArrival,true)})
 await check('invalid arrival treated as missing',async()=>{await seed('active',{lpr:{isInside:true,arrivedAt:'bad'}});const ctx=await prepare('active');assert.equal(ctx.arrival,null);await rejected(save(input(ctx),actor),'CONFIRM_MISSING_ARRIVAL')})
 await check('new visit after dialog opened rejects stale save',async()=>{await seed();const ctx=await prepare('active');await seed('active',{lpr:{...base.lpr,visitId:'second',arrivedAt:'2026-07-18T10:00:00Z',lastSeenAt:'2026-07-18T10:00:00Z'}});await rejected(save(input(ctx,{date:'2026-07-19'}),actor),'CONTEXT_CHANGED');assert.equal(getLprPresenceState(await read()).isEffectivelyInside,true)})
 await check('legacy booking without visitId still detects newer camera state',async()=>{await seed('active',{lpr:{isInside:true,arrivedAt:'2026-07-16T10:00:00Z'}});const ctx=await prepare('active');await db.doc('bookings/active').update({'lpr.lastSeenAt':'2026-07-16T11:00:00Z'});await rejected(save(input(ctx),actor),'CONTEXT_CHANGED')})
 await check('duplicates normalized and confirmed; other booking/pointer preserved',async()=>{await seed();await seed('old',{licensePlate:'test-01',startDate:'2026-05-01',endDate:'2026-05-08'});await db.doc('config/parkingLive').set({occupiedCount:2});await db.doc('lpr_plate_state/TEST01').set({bookingId:'old',visitId:'first',isInside:true});const old=await read('old');const ctx=await prepare('active');assert.equal(ctx.duplicates.length,2);await rejected(save(input(ctx),actor),'CONFIRM_DUPLICATES');const r=await save(input(ctx,{confirmDuplicates:true}),actor);assert.equal(await count(),1);assert.deepEqual(await read('old'),old);assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().isInside,true);assert.equal((await db.doc('lpr_events/'+r.lprEventId).get()).data().confirmations.duplicates,true)})
 await check('duplicate appearing after context blocks save',async()=>{await seed();const ctx=await prepare('active');await seed('new');await rejected(save(input(ctx,{confirmDuplicates:true}),actor),'CONTEXT_CHANGED')})
 await check('duplicate closed after context blocks save',async()=>{await seed();await seed('old');const ctx=await prepare('active');await db.doc('bookings/old').update({'lpr.isInside':false});await rejected(save(input(ctx,{confirmDuplicates:true}),actor),'CONTEXT_CHANGED')})
 await check('same request retry idempotent even after context changed',async()=>{await seed();const payload=input(await prepare('active'));const first=await save(payload,actor);assert.deepEqual(await save(payload,actor),first);assert.equal(await count(),0);assert.equal((await db.collection('lpr_events').get()).size,1)})
 await check('concurrent identical requests decrement once',async()=>{await seed();const payload=input(await prepare('active'));const rs=await Promise.all([save(payload,actor),save(payload,actor)]);assert.deepEqual(rs[0],rs[1]);assert.equal(await count(),0)})
 await check('concurrent different requests: one success and one context conflict',async()=>{await seed();const ctx=await prepare('active');const rs=await Promise.allSettled([save(input(ctx),actor),save(input(ctx),actor)]);assert.equal(rs.filter(x=>x.status==='fulfilled').length,1);assert.equal(rs.find(x=>x.status==='rejected').reason.code,'CONTEXT_CHANGED');assert.equal(await count(),0)})
 await check('historical departure correction needs overwrite; no second decrement',async()=>{await seed('active',{lpr:{...base.lpr,isInside:false,departedAt:'2026-07-17T10:00:00Z',lastEventType:'exit',lastSeenAt:'2026-07-17T10:00:00Z'},occupancyDecremented:true});await db.doc('config/parkingLive').set({occupiedCount:0});const ctx=await prepare('active');await rejected(save(input(ctx,{time:'11:00'}),actor),'CONFIRM_OVERWRITE');await save(input(ctx,{time:'11:00',confirmOverwrite:true}),actor);assert.equal(await count(),0)})
 await check('legacy reopened row checks newer entry instead of old arrival',async()=>{await seed('active',{lpr:{...base.lpr,arrivedAt:'2026-05-01T10:00:00Z',departedAt:'2026-05-08T10:00:00Z',lastSeenAt:'2026-07-18T10:00:00Z'}});const ctx=await prepare('active');assert.equal(ctx.arrival,'2026-07-18T10:00:00.000Z');await rejected(save(input(ctx),actor),'EXIT_BEFORE_ENTRY')})
 await check('useServerNow stores Romania civil clock and ignores client date',async()=>{await seed();const before=clock();await save(input(await prepare('active'),{useServerNow:true,date:'2099-01-01'}),actor);const at=(await read()).lpr.departedAt;assert.ok(at>=before&&at<=clock())})
 await check('clock independent from host timezone with DST fallback',async()=>{const before=process.env.TZ;for(const tz of ['UTC','America/New_York','Asia/Tokyo']){process.env.TZ=tz;assert.equal(clock(new Date('2026-10-25T00:30:00Z')),'2026-10-25T03:30:00.000Z');assert.equal(clock(new Date('2026-10-25T01:30:00Z')),'2026-10-25T03:30:00.000Z')}process.env.TZ=before;assert.equal(parse('2026-07-17','10:00'),'2026-07-17T10:00:00.000Z')})
 await check('HTTP prepare/save uses authenticated actor; access denied rejected',async()=>{await seed();const post=body=>POST(new Request('http://localhost/api/admin/manual-lpr-exit',{method:'POST',body:JSON.stringify(body)}));authorized=false;assert.equal((await post({action:'prepare',bookingId:'active'})).status,403);authorized=true;const ctx=await (await post({action:'prepare',bookingId:'active'})).json();const response=await post({...input(ctx),action:'save',adminUid:'forged'});assert.equal(response.status,200);const result=await response.json();assert.equal((await db.doc('lpr_events/'+result.lprEventId).get()).data().adminUid,'admin-test')})
 await check('transaction failure leaves booking/counter/audits untouched',async()=>{await seed();const ctx=await prepare('active'),original=db.runTransaction.bind(db);db.runTransaction=fn=>original(async tx=>{await fn(tx);throw Error('abort')});try{await assert.rejects(save(input(ctx),actor),/abort/)}finally{db.runTransaction=original}assert.equal((await read()).lpr.isInside,true);assert.equal(await count(),1);assert.equal((await db.collection('lpr_events').get()).size,0)})

 await check('camera exit racing manual exit closes once with conflict on stale manual context',async()=>{
  await seed();const ctx=await prepare('active');const rs=await Promise.allSettled([save(input(ctx),actor),camera('exit','2026-07-17T10:00:00Z')]);
  assert.ok(rs.some(x=>x.status==='fulfilled'));for(const r of rs)if(r.status==='rejected')assert.equal(r.reason.code,'CONTEXT_CHANGED');assert.equal(await count(),0);assert.equal((await read()).lpr.isInside,false)
 })
 await check('manual exit then old camera entry cannot reopen; next reservation associates correctly',async()=>{
  await seed();await save(input(await prepare('active')),actor);assert.equal((await camera('entry','2026-07-16T10:01:00Z')).warning,'out_of_order_event');
  await seed('next',{startDate:'2026-08-01',endDate:'2026-08-05',lpr:{isInside:false},occupancyIncremented:false});
  assert.equal((await camera('entry','2026-08-01T10:00:00Z')).matchedBookingId,'next');assert.equal((await read()).lpr.isInside,false);assert.equal(await count(),1)
 })
 await check('camera event after prepare invalidates context',async()=>{
  await seed();const ctx=await prepare('active');await camera('entry','2026-07-16T11:00:00Z');await assert.rejects(save(input(ctx),actor),e=>e.code==='CONTEXT_CHANGED');assert.equal((await read()).lpr.isInside,true)
 })
 await check('arrival milliseconds respect second precision',async()=>{
  await seed('active',{lpr:{...base.lpr,arrivedAt:'2026-07-16T10:00:00.987Z'}});await save(input(await prepare('active'),{date:'2026-07-16',time:'10:00:00'}),actor);assert.equal(await count(),0)
 })
 console.log(`${n} protected manual-exit scenarios passed`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await sdk.terminate(clientDb);await clientDelete(clientApp);await deleteApp(app)})
