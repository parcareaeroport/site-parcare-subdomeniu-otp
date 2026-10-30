// Regression tests for late entry receipts and historical plate corrections.
// Synthetic data only. Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8189.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const projectId = 'demo-parking-ordering', root = path.resolve(__dirname, '..')
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
;(async()=>{
  await check('exit delivered first prevents stale entry reopening; both receipts remain reviewable',async()=>{
    await seed();const x=await event('exit','2026-07-16T12:00:00Z');assert.equal(x.warning,'exit_without_open_visit')
    const e=await event('entry');await totals(0);assert.equal(e.warning,'later_exit_requires_review')
    assert.deepEqual((await receipt(e)).relatedEventIds,[x.savedEventId]);const attention=(await observed()).lprAttention;assert.equal(attention.count,1);assert.equal(attention.eventCount,2)
    assert.equal((await read('active')).lpr,undefined);assert.equal((await db.collection('bookings/active/gateEvents').get()).size,0)
    await event('entry');await event('exit','2026-07-16T12:00:00Z');await retry();await totals(0)
  })
  await check('retrying an entry after ten failures and a later reviewed exit cannot reopen it',async()=>{
    await seed();let e;for(let i=0;i<10;i++){failAssociation=1;e=await event('entry')}
    await event('exit','2026-07-16T12:00:00Z');const ctx=await review({eventId:e.savedEventId,action:'prepare'},actor)
    await review({eventId:e.savedEventId,action:'retry',version:ctx.version},actor);await retry();await totals(0)
    assert.equal((await receipt(e)).associationReason,'later_exit_requires_review')
  })
  await check('an acknowledged later exit still prevents an old entry reopening',async()=>{
    await seed();const x=await event('exit','2026-07-16T12:00:00Z'),ctx=await review({eventId:x.savedEventId,action:'prepare'},actor)
    await review({eventId:x.savedEventId,action:'resolve',version:ctx.version,confirmed:true,note:'Vehicle confirmed absent'},actor)
    assert.equal((await event('entry')).warning,'later_exit_requires_review');await totals(0)
  })
  await check('a genuine new arrival after the unresolved exit remains possible',async()=>{
    await seed();await event('exit','2026-07-16T12:00:00Z');await event('entry');await event('entry','2026-07-16T13:00:00Z');await totals(1)
    await event('exit','2026-07-16T13:30:00Z');await totals(0)
  })
  await check('entry failure then pending exit still recovers automatically in order',async()=>{
    await seed();failAssociation=1;const e=await event('entry');const x=await event('exit','2026-07-16T12:00:00Z');assert.equal(x.warning,'earlier_event_pending')
    await db.doc('lpr_events/'+e.savedEventId).update({nextAttemptAt:0});await retry();await totals(1)
    await db.doc('lpr_events/'+x.savedEventId).update({nextAttemptAt:0});await retry();await totals(0);assert.equal((await observed()).lprAttention.count,0)
  })
  await check('future, stale and invalid exit receipts do not poison valid arrivals',async()=>{
    await seed();await event('exit','2099-01-01T12:00:00Z');await event('exit','2020-01-01T12:00:00Z');await event('exit','invalid')
    await event('entry');await totals(1);await event('exit','2026-07-16T12:00:00Z');await totals(0)
  })
  await check('quarantined future exit does not become authoritative when clock catches up',async()=>{
    await seed();await event('exit','2026-07-16T16:00:00Z');clock='2026-07-16T17:00:00.000Z'
    await event('entry','2026-07-16T15:00:00Z');await totals(1)
  })
  await check('exit without booking and delayed entry never creates an unmatched ghost',async()=>{
    await event('exit','2026-07-16T12:00:00Z');await event('entry');await totals(0);assert.equal((await db.collection('bookings').get()).size,0)
  })
  await check('normal and simultaneous deliveries converge without ghost occupancy',async()=>{
    await seed();for(let i=0;i<6;i++) {
      const minute=String(i*5).padStart(2,'0')
      await Promise.all([event('entry',`2026-07-16T11:${minute}:00Z`),event('exit',`2026-07-16T11:${minute}:30Z`)])
      for(const d of (await db.collection('lpr_events').where('associationStatus','==','pending').get()).docs)await d.ref.update({nextAttemptAt:0})
      await retry();await totals(0)
    }
  })
  await check('historical correction creates old-number guard even without a pointer',async()=>{
    await legacy();await correct();const old=(await db.doc('lpr_plate_state/TEST01').get()).data()
    assert.equal(old.isInside,false);assert.equal(old.plateCorrection.bookingId,'active');assert.equal(old.plateCorrection.through,clock)
    const e=await event('entry','2026-07-16T09:59:00Z');assert.equal(e.warning,'plate_corrected_event_requires_review');await totals(1)
    assert.equal((await db.collection('bookings').get()).size,1);assert.equal((await observed()).lprAttention.count,1)
    await event('exit','2026-07-16T13:00:00Z','TEST02');await totals(0)
  })
  await check('old-number readings between the original entry and correction cannot duplicate it',async()=>{
    await legacy();await correct();const e=await event('entry','2026-07-16T13:00:00Z');assert.equal(e.warning,'plate_corrected_event_requires_review');await totals(1)
  })
  await check('missing legacy timestamps still retain a bounded correction guard',async()=>{
    await legacy({arrivedAt:null,lastSeenAt:null});await correct();await event('entry','2026-07-16T13:00:00Z');await totals(1)
  })
  await check('existing old pointer is retained and real departure on corrected number works',async()=>{
    await seed();await event('entry');await correct();await event('entry','2026-07-16T09:59:00Z');await totals(1)
    await event('exit','2026-07-16T13:00:00Z','TEST02');await totals(0)
  })
  await check('old number may identify a different vehicle after correction cutoff',async()=>{
    await legacy();await correct();clock='2026-07-16T16:00:00.000Z';await event('entry','2026-07-16T15:00:00Z');await totals(2)
    await event('exit','2026-07-16T15:30:00Z');await totals(1);await event('exit','2026-07-16T15:30:00Z','TEST02');await totals(0)
    await event('entry','2026-07-16T13:00:00Z');await totals(0) // New pointer preserves ordering after the old guard is replaced.
  })
  await check('boundary at correction second is quarantined, not guessed',async()=>{
    await legacy();await correct();await event('entry',clock);await totals(1)
  })
  await check('camera milliseconds in the correction second cannot bypass the boundary',async()=>{
    await legacy();await correct();await event('entry','2026-07-16T14:00:00.999Z');await totals(1)
    assert.equal((await observed()).lprAttention.events[0].reason,'plate_corrected_event_requires_review')
  })
  await check('concurrent legacy correction and delayed event cannot create a second stay',async()=>{
    await legacy();const ctx=await preparePlateChange('active','TEST02')
    const results=await Promise.allSettled([savePlateChange({bookingId:'active',plate:'TEST02',version:ctx.version,confirmPresent:true},actor),event('entry','2026-07-16T09:59:00Z')])
    for(const r of results)if(r.status==='rejected')assert.equal(r.reason.code,'CONTEXT_CHANGED')
    await totals(1);assert.equal((await db.collection('bookings').get()).size,1)
  })
  await check('manual exit on the corrected legacy stay closes only that booking',async()=>{
    await legacy();await correct();const ctx=await manual.prepareManualExit('active')
    await manual.saveManualExit({bookingId:'active',version:ctx.version,requestId:randomUUID(),date:'2026-07-16',time:'13:00:00'},actor);await totals(0)
    await event('entry','2026-07-16T13:30:00Z');await totals(0)
  })
  console.log(`PASS ${passed} ordering/correction scenarios`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>deleteApp(app))
