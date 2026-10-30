// Regression tests for late entry receipts and historical plate corrections.
// Synthetic data only. Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8189.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const projectId = 'demo-parking-entry-fixes', root = path.resolve(__dirname, '..')
const app = initializeApp({ projectId }, 'ordering'), db = getFirestore(app), cache = new Map()
const actor = { uid:'admin-fixture', email:'admin@example.invalid' }
let clock = '2026-07-16T14:00:00.000Z', failAssociation = 0
const dbProxy = new Proxy(db, { get(target,key) {
  if (key === 'runTransaction') return (...args) => { if (failAssociation > 0) { failAssociation--;throw Error('Injected association failure') } return target.runTransaction(...args) }
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
} })
function load(relative) {
  const file = path.resolve(root,relative); if (cache.has(file)) return cache.get(file).exports
  const mod = {exports:{}}; cache.set(file,mod)
  const js = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
  new Function('require','module','exports',js)(name => {
    if (name === 'server-only') return {}
    if (name === '@/lib/firebase-admin') return {adminDb:dbProxy,adminAuth:{verifyIdToken:async()=>({...actor,role:'admin'})}}
    if (name.startsWith('@/')) return load(name.slice(2)+'.ts')
    if (name.startsWith('.')) return load(path.relative(root,path.resolve(path.dirname(file),name))+'.ts')
    return require(name)
  },mod,mod.exports)
  return mod.exports
}
const manual = load('lib/manual-lpr-exit.server.ts')
manual.manualExitClock = () => clock // Deterministic server civil clock, independently of host timezone.
const {handleLprEvent:camera,retryPendingLprEvents:retry} = load('lib/lpr-service.ts')
const {preparePlateChange,savePlateChange} = load('lib/booking-plate.server.ts')
const {reviewLprEvent:review} = load('lib/lpr-review.server.ts')
const {GET:occupancy} = load('app/api/admin/occupancy/route.ts')
const base = {licensePlate:'TEST01',status:'confirmed_paid',startDate:'2026-07-16',startTime:'08:00',endDate:'2026-07-21',endTime:'20:00'}
const seed = (id='active',patch={}) => db.doc('bookings/'+id).set({...base,...patch})
const read = async id => (await db.doc('bookings/'+id).get()).data()
const receipt = async r => (await db.doc('lpr_events/'+r.savedEventId).get()).data()
const event = (type,at='2026-07-16T10:00:00Z',plate='TEST01') => camera({plateNumber:plate,deviceId:type==='entry'?'intrare_1':'iesire_1',direction:type,snapTime:at,accurateTime:at,laneNo:1,maxEventAgeMinutes:1440})
async function observed() { const r=await occupancy(new Request('http://localhost/api/admin/occupancy',{headers:{Authorization:'Bearer admin'}})); assert.equal(r.status,200); return r.json() }
async function totals(expected) { assert.equal((await observed()).occupiedCount,expected); assert.equal((await db.doc('config/parkingLive').get()).data().occupiedCount,expected) }
async function correct(plate='TEST02') { const ctx=await preparePlateChange('active',plate); await savePlateChange({bookingId:'active',plate,version:ctx.version,confirmPresent:true},actor) }
async function legacy(extra={}) { await seed('active',{occupancyIncremented:true,lpr:{isInside:true,arrivedAt:'2026-07-16T10:00:00Z',lastSeenAt:'2026-07-16T10:00:00Z',lastEventType:'entry',...extra}}); await db.doc('config/parkingLive').set({occupiedCount:1}) }
let passed=0
async function check(name,fn) {
  assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'})).ok)
  clock='2026-07-16T14:00:00.000Z';failAssociation=0
  await db.doc('config/reservationSettings').set({maxTotalReservations:290});await db.doc('config/parkingLive').set({occupiedCount:0})
  await fn();console.log('PASS',name);passed++
}

const {saveManualEntry:enter,createManualBookingRecord:create}=load('lib/manual-lpr-entry.server.ts')
const input = (ctx, patch={}) => ({bookingId:ctx.booking.id, version:ctx.version, requestId:randomUUID(), date:'2026-07-16', time:'10:00:00', entryMode:ctx.inside?'correct_arrival':'new_visit', ...patch})
const enterAt = async(id, time, patch={}) => enter(input(await manual.prepareManualExit(id),{time,...patch}),actor)
const rejects = (promise, code) => assert.rejects(promise,e=>e.code===code)
;(async()=>{
 for (const status of ['needs_review','pending','reviewed']) await check('manual entry blocks later '+status+' exit even if no booking records it',async()=>{
  await seed();await db.doc('lpr_events/later').set({normalizedPlate:'TEST01',eventType:'exit',eventTime:'2026-07-16T12:00:00Z',associationStatus:status})
  const before=await read('active');await rejects(enterAt('active','10:00:00'),'LATER_EXIT');assert.deepEqual(await read('active'),before);await totals(0)
 })
 await check('older manual exit receipt without eventTime protects both entry channels',async()=>{
  await seed();await db.doc('lpr_events/manual-old').set({normalizedPlate:'TEST01',eventType:'exit',manual:true,accurateTime:'2026-07-16T12:00:00Z',associationStatus:'manual'})
  await rejects(enterAt('active','10:00:00'),'LATER_EXIT');assert.equal((await event('entry')).warning,'later_exit_requires_review');await totals(0)
 })
 await check('receipt arriving after dialog preparation is rechecked at save',async()=>{
  await seed();const payload=input(await manual.prepareManualExit('active'));await event('exit','2026-07-16T12:00:00Z')
  await rejects(enter(payload,actor),'CONTEXT_CHANGED');await rejects(enterAt('active','10:00:00'),'LATER_EXIT');await totals(0)
 })
 for (const reason of ['future_event_time','stale_event_time','invalid_event_time']) await check('rejected '+reason+' receipt is not trusted as physical exit',async()=>{
  await seed();await db.doc('lpr_events/invalid').set({normalizedPlate:'TEST01',eventType:'exit',eventTime:'2026-07-16T12:00:00Z',associationStatus:'needs_review',associationReason:reason})
  await enterAt('active','10:00:00');await totals(1)
 })
 await check('old-number boundary blocks manual arrival, preserving corrected vehicle and guard',async()=>{
  await legacy();await correct();await seed('old-number');const before=(await db.doc('lpr_plate_state/TEST01').get()).data()
  await rejects(enterAt('old-number','13:00:00'),'PLATE_CORRECTED');assert.deepEqual((await db.doc('lpr_plate_state/TEST01').get()).data(),before);await totals(1)
 })
 await check('manual creation cannot bypass old-number boundary in correction second',async()=>{
  await legacy();await correct();await rejects(create(base,true,actor),'PLATE_CORRECTED');assert.equal((await db.collection('bookings').get()).size,1);await totals(1)
 })
 await check('genuine later entry under former number is allowed',async()=>{
  await legacy();await correct();await seed('later');clock='2026-07-16T15:00:00.000Z';await enterAt('later','14:01:00');await totals(2)
 })
 await check('creation checks known exits atomically before creating a booking',async()=>{
  await event('exit',clock);await rejects(create(base,true,actor),'LATER_EXIT');assert.equal((await db.collection('bookings').get()).size,0);await totals(0)
 })
 await check('closed visit cannot be reopened by correction intent',async()=>{
  await seed();await event('entry');await event('exit','2026-07-16T12:00:00Z');const before=await read('active')
  await rejects(enterAt('active','13:00:00',{entryMode:'correct_arrival',confirmOverwrite:true}),'ENTRY_MODE_REQUIRED');assert.deepEqual(await read('active'),before);await totals(0)
 })
 await check('entry mode cannot be omitted or forged',async()=>{
  await seed();for(const entryMode of [undefined,'anything'])await rejects(enterAt('active','10:00:00',{entryMode}),'ENTRY_MODE_REQUIRED');await totals(0)
 })
 await check('reentry needs explicit physical confirmation and a later second',async()=>{
  await seed();await event('entry');await event('exit','2026-07-16T12:00:00Z');const old=await read('active')
  await rejects(enterAt('active','13:00:00'),'CONFIRM_REENTRY')
  await rejects(enterAt('active','12:00:00',{confirmReentry:true}),'LATER_EXIT')
  const r=await enterAt('active','13:00:00',{confirmReentry:true});await totals(1)
  const b=await read('active');assert.notEqual(b.lpr.visitId,old.lpr.visitId);assert.equal(b.lpr.departedAt,null)
  assert.equal((await db.doc('lpr_events/'+r.lprEventId).get()).data().confirmations.reentry,true)
 })
 await check('legacy departure in same second cannot silently open a new visit',async()=>{
  await seed('active',{lpr:{isInside:false,arrivedAt:'2026-07-16T10:00:00Z',departedAt:'2026-07-16T12:00:00.500Z'}})
  await rejects(enterAt('active','12:00:00',{confirmReentry:true}),'AMBIGUOUS_REENTRY');await totals(0)
 })
 await check('legacy subsecond arrival correction preserves occupancy, pointer and observation',async()=>{
  await legacy({departedAt:'2026-07-16T12:00:00.500Z',lastSeenAt:'2026-07-16T12:00:00.900Z'});const old=await read('active')
  const r=await enterAt('active','12:00:00',{confirmOverwrite:true});await totals(1)
  const b=await read('active');assert.equal(b.lpr.lastSeenAt,old.lpr.lastSeenAt);assert.equal(b.lpr.departedAt,old.lpr.departedAt);assert.equal(b.lpr.visitId,undefined)
  const audit=(await db.doc('lpr_events/'+r.lprEventId).get()).data();assert.equal(audit.eventType,'arrival_correction');assert.deepEqual(audit.previousLpr,old.lpr)
  assert.equal((await db.doc('lpr_plate_state/TEST01').get()).exists,false)
  const ctx=await manual.prepareManualExit('active');await manual.saveManualExit({...input(ctx),time:'13:00:00'},actor);await totals(0)
 })
 await check('current visit correction preserves exact visit/pointer, repeated save and count',async()=>{
  await seed();await event('entry');const old=await read('active'),pointer=(await db.doc('lpr_plate_state/TEST01').get()).data()
  const payload=input(await manual.prepareManualExit('active'),{time:'10:05:00',confirmOverwrite:true});const a=await enter(payload,actor),b=await enter(payload,actor);assert.deepEqual(a,b)
  assert.equal((await read('active')).lpr.visitId,old.lpr.visitId);assert.deepEqual((await db.doc('lpr_plate_state/TEST01').get()).data(),pointer);await totals(1)
 })
 await check('incomplete historical visit still requires reentry confirmation',async()=>{
  await seed('active',{lpr:{isInside:false,visitId:'legacy-visit',arrivedAt:'invalid',departedAt:'invalid',lastEventType:'exit'}})
  const ctx=await manual.prepareManualExit('active');assert.equal(ctx.hasPreviousVisit,true);assert.equal(ctx.arrival,null);assert.equal(ctx.departure,null)
  await rejects(enterAt('active','13:00:00'),'CONFIRM_REENTRY');await totals(0)
 })
 await check('correction that would change fallback presence is rejected unchanged',async()=>{
  await legacy({arrivedAt:'2026-07-16T12:00:00.900Z',departedAt:'2026-07-16T12:00:00.500Z',lastSeenAt:null,lastEventType:null});const before=await read('active')
  await rejects(enterAt('active','12:00:00',{confirmOverwrite:true}),'AMBIGUOUS_CORRECTION');assert.deepEqual(await read('active'),before);await totals(1)
 })
 await check('camera exit and older manual entry in parallel end outside',async()=>{
  await seed();const payload=input(await manual.prepareManualExit('active'))
  const results=await Promise.allSettled([enter(payload,actor),event('exit','2026-07-16T12:00:00Z')])
  for(const r of results)if(r.status==='rejected')assert.ok(['LATER_EXIT','CONTEXT_CHANGED'].includes(r.reason.code),r.reason)
  await totals(0)
 })
 await check('direct creation requires actual boolean presence',async()=>{
  for(const presence of [undefined,null,'true'])await rejects(create(base,presence,actor),'PRESENCE_REQUIRED');await totals(0);assert.equal((await db.collection('bookings').get()).size,0)
 })
 console.log(`${passed} entry-protection regression scenarios passed`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>deleteApp(app))
