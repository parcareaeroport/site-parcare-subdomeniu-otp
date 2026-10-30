// Regression tests for late entry receipts and historical plate corrections.
// Synthetic data only. Run with FIRESTORE_EMULATOR_HOST=127.0.0.1:8189.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const projectId = 'demo-parking-exit-fixes', root = path.resolve(__dirname, '..')
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
const actualCivilClock = manual.manualExitClock
manual.manualExitClock = () => clock // The camera parser converts its own explicit instants independently.
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
const input=(ctx,time='12:00:00',extra={})=>({bookingId:ctx.booking.id,version:ctx.version,requestId:randomUUID(),date:'2026-07-16',time,...extra})
const exitAt=async(id='active',time='12:00:00',extra={})=>manual.saveManualExit(input(await manual.prepareManualExit(id),time,extra),actor)
const reject=(p,code)=>assert.rejects(p,e=>e.code===code)
const laterBooking=()=>seed('new-booking',{startTime:'12:00',endTime:'23:00',endDate:'2026-07-16'})
const instantEvent=(type,at)=>camera({plateNumber:'TEST01',deviceId:type==='entry'?'intrare_1':'iesire_1',direction:type,snapTime:at,accurateTime:at,laneNo:1,timestampMode:'instant'})
const snapshot=async()=>({b:await read('active'),p:(await db.doc('lpr_plate_state/TEST01').get()).data(),count:(await observed()).occupiedCount})
;(async()=>{
 await check('legacy linked camera entry and duplicate receipts do not block a valid manual exit',async()=>{
  await legacy({visitId:'legacy-entry'})
  await db.doc('lpr_plate_state/TEST01').set({bookingId:'active',visitId:'legacy-entry',isInside:true,lastEventAt:'2026-07-16T10:00:00Z',lastEventType:'entry'})
  for(const [id,status] of [['legacy-entry','matched'],['legacy-duplicate','duplicate']]) await db.doc('lpr_events/'+id).set({normalizedPlate:'TEST01',eventType:'entry',deviceId:'intrare_1',accurateTime:'2026-07-16 10:00:00.000',associationStatus:status,matchedBookingId:'active'})
  await exitAt();await totals(0)
  assert.equal((await read('active')).lpr.departedAt,'2026-07-16T12:00:00.000Z')
  assert.equal((await db.doc('lpr_events/legacy-entry').get()).data().eventTime,undefined)
 })
 for(const channel of ['camera','manual']) await check('legacy linked later entry still blocks earlier '+channel+' exit',async()=>{
  await seed();await event('entry')
  await db.doc('lpr_events/later-legacy').set({normalizedPlate:'TEST01',eventType:'entry',accurateTime:'2026-07-16 13:00:00.000',associationStatus:'matched',matchedBookingId:'other-booking'})
  if(channel==='manual') await reject(exitAt(),'EXIT_REQUIRES_REVIEW')
  else assert.equal((await event('exit','2026-07-16T12:00:00Z')).warning,'later_entry_requires_review')
  await totals(1)
 })
 for(const patch of [
  {accurateTime:'invalid'}, {accurateTime:'2026-02-30 10:00:00'},
  {accurateTime:'2026-07-16 10:00:00',associationStatus:'pending'},
  {accurateTime:'2026-07-16 10:00:00',matchedBookingId:null},
  {accurateTime:'2026-07-16 10:00:00',eventTime:'invalid'},
  {accurateTime:'2026-07-16 10:00:00',clockOffsetSeconds:3149},
  {accurateTime:'2026-07-16T10:00:00Z',timestampMode:'instant'},
  {accurateTime:'2026-10-25 03:30:00'},
 ]) await check('unproven legacy clock remains blocked: '+JSON.stringify(patch),async()=>{
  await seed();await event('entry')
  await db.doc('lpr_events/unproven-legacy').set({normalizedPlate:'TEST01',eventType:'entry',associationStatus:'matched',matchedBookingId:'active',...patch})
  await reject(exitAt(),'EXIT_REQUIRES_REVIEW');await totals(1)
 })
 await check('old camera exit cannot close newer unassociated reentry',async()=>{
  await seed();await event('entry');await laterBooking()
  assert.equal((await event('entry','2026-07-16T13:00:00Z')).warning,'open_visit_conflicts_with_reservation')
  const before=await snapshot();assert.equal((await event('exit','2026-07-16T12:00:00Z')).warning,'later_entry_requires_review')
  assert.deepEqual(await snapshot(),before);await totals(1)
 })
 await check('new unassociated receipt invalidates manual dialog and fresh context still blocks old exit',async()=>{
  await seed();await event('entry');await laterBooking();const ctx=await manual.prepareManualExit('active')
  await event('entry','2026-07-16T13:00:00Z')
  await reject(manual.saveManualExit(input(ctx),actor),'CONTEXT_CHANGED')
  await reject(exitAt(),'EXIT_REQUIRES_REVIEW');await totals(1)
 })
 for(const status of ['pending','needs_review','reviewed']) await check('exit checks later '+status+' entry',async()=>{
  await seed();await event('entry');await db.doc('lpr_events/later-entry').set({normalizedPlate:'TEST01',eventType:'entry',eventTime:'2026-07-16T13:00:00Z',associationStatus:status})
  await reject(exitAt(),'EXIT_REQUIRES_REVIEW');assert.equal((await event('exit','2026-07-16T12:00:00Z')).warning,'later_entry_requires_review');await totals(1)
 })
 await check('retry worker applies the same exit guard',async()=>{
  await seed();await event('entry');await laterBooking();await event('entry','2026-07-16T13:00:00Z');failAssociation=1
  const pending=await event('exit','2026-07-16T12:00:00Z');assert.equal(pending.warning,'association_failed')
  await db.doc('lpr_events/'+pending.savedEventId).update({nextAttemptAt:0});await retry()
  assert.equal((await receipt(pending)).associationReason,'later_entry_requires_review');await totals(1)
 })
 await check('invalid future entry receipt does not poison valid exit',async()=>{
  await seed();await event('entry');await event('entry','2099-01-01T10:00:00Z');await exitAt();await totals(0)
 })
 for(const hasPointer of [true,false]) for(const channel of ['camera','manual']) await check('earlier correction permits '+channel+' reentry, pointer='+hasPointer,async()=>{
  await seed();await event('entry');if(!hasPointer)await db.doc('lpr_plate_state/TEST01').delete()
  clock='2026-07-16T14:30:00.000Z';const original=await exitAt('active','14:00:00'),correction=await exitAt('active','12:00:00',{confirmOverwrite:true})
  const old=(await db.doc('lpr_events/'+original.lprEventId).get()).data()
  assert.equal(old.supersededBy,correction.lprEventId);assert.equal(old.eventTime,'2026-07-16T14:00:00.000Z')
  assert.equal((await db.doc('bookings/active/gateEvents/'+original.lprEventId).get()).data().supersededBy,correction.lprEventId)
  if(hasPointer)assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().lastEventAt,'2026-07-16T12:00:00.000Z')
  if(channel==='camera')assert.equal((await event('entry','2026-07-16T13:00:00Z')).matchedBookingId,'active')
  else await enter(input(await manual.prepareManualExit('active'),'13:00:00',{entryMode:'new_visit',confirmReentry:true}),actor)
  await totals(1)
 })
 await check('correcting camera departure preserves original receipt, replay and repeated correction are safe',async()=>{
  await seed();await event('entry');clock='2026-07-16T15:00:00.000Z';const old=await event('exit','2026-07-16T14:00:00Z')
  const first=await exitAt('active','12:00:00',{confirmOverwrite:true});const ctx=await manual.prepareManualExit('active'),payload=input(ctx,'12:10:00',{confirmOverwrite:true})
  const second=await manual.saveManualExit(payload,actor);assert.deepEqual(await manual.saveManualExit(payload,actor),second)
  assert.equal((await receipt(old)).supersededBy,first.lprEventId)
  assert.equal((await db.doc('lpr_events/'+first.lprEventId).get()).data().supersededBy,second.lprEventId)
  await event('exit','2026-07-16T14:00:00Z');await totals(0)
  await event('entry','2026-07-16T13:00:00Z');await totals(1)
 })
 await check('legacy correction without visitId supersedes only matching departure',async()=>{
  await seed('active',{occupancyIncremented:true,occupancyDecremented:true,lpr:{isInside:false,arrivedAt:'2026-07-16T10:00:00Z',departedAt:'2026-07-16T14:00:00Z',lastSeenAt:'2026-07-16T14:00:00Z',lastEventType:'exit'}})
  clock='2026-07-16T15:00:00.000Z'
  for(const [id,at] of [['old-exit','14:00'],['older-visit','09:00']])await db.doc('lpr_events/'+id).set({normalizedPlate:'TEST01',matchedBookingId:'active',manual:true,eventType:'exit',accurateTime:`2026-07-16T${at}:00Z`,associationStatus:'manual'})
  await exitAt('active','12:00:00',{confirmOverwrite:true})
  assert.ok((await db.doc('lpr_events/old-exit').get()).data().supersededBy);assert.equal((await db.doc('lpr_events/older-visit').get()).data().supersededBy,undefined)
  await event('entry','2026-07-16T13:00:00Z');await totals(1)
 })
 await check('historical correction never closes later visit pointer or supersedes its audit',async()=>{
  await seed('old',{endDate:'2026-07-16',endTime:'10:30'});await event('entry');await event('exit','2026-07-16T11:00:00Z')
  await seed('active',{startTime:'12:00'});await event('entry','2026-07-16T13:00:00Z');const pointer=(await db.doc('lpr_plate_state/TEST01').get()).data()
  await exitAt('old','10:50:00',{confirmOverwrite:true,confirmDuplicates:true});await totals(1)
  assert.deepEqual((await db.doc('lpr_plate_state/TEST01').get()).data(),pointer)
  await reject(exitAt('old','13:10:00',{confirmOverwrite:true}),'EXIT_OVERLAPS_NEW_VISIT');await totals(1)
 })
 await check('concurrent correction and reentry cannot rewind new visit',async()=>{
  await seed();await event('entry');await exitAt();const ctx=await manual.prepareManualExit('active')
  const rs=await Promise.allSettled([manual.saveManualExit(input(ctx,'11:50:00',{confirmOverwrite:true}),actor),event('entry','2026-07-16T13:00:00Z')])
  for(const r of rs)if(r.status==='rejected')assert.equal(r.reason.code,'CONTEXT_CHANGED')
  await totals(1);assert.equal((await db.doc('lpr_plate_state/TEST01').get()).data().isInside,true)
 })
 await check('uppercase legacy entry is validated against its latest detection',async()=>{
  await legacy({lastEventType:' ENTRY ',lastSeenAt:'2026-07-16T13:00:00Z'});await reject(exitAt(),'EXIT_BEFORE_LAST_ENTRY');await totals(1)
 })
 await check('newer legacy pointer blocks old manual exit and does not change either record',async()=>{
  await legacy({visitId:'v'});await db.doc('lpr_plate_state/TEST01').set({bookingId:'active',visitId:'v',isInside:true,lastEventAt:'2026-07-16T13:00:00Z',lastEventType:'entry'})
  const before=await snapshot();await reject(exitAt(),'EXIT_REQUIRES_REVIEW');assert.deepEqual(await snapshot(),before)
  await reject(exitAt('active','13:30:00'),'EXIT_REQUIRES_REVIEW');await totals(1)
 })
 await check('contradictory pointer cannot be overwritten as historical correction',async()=>{
  await seed();await event('entry');await exitAt();await db.doc('lpr_plate_state/TEST01').update({isInside:true,lastEventType:'entry'})
  await reject(exitAt('active','11:50:00',{confirmOverwrite:true}),'EXIT_REQUIRES_REVIEW');await totals(0)
 })
 await check('confirmed duplicate closes selected record only',async()=>{
  await legacy();await seed('other',{lpr:{isInside:true,arrivedAt:'2026-07-16T10:00:00Z'}});await db.doc('config/parkingLive').set({occupiedCount:2})
  const other=await read('other');await reject(exitAt(),'CONFIRM_DUPLICATES');await exitAt('active','12:00:00',{confirmDuplicates:true});await totals(1);assert.deepEqual(await read('other'),other)
 })
 await check('transaction abort rolls back correction, supersession, pointer and counter',async()=>{
  await seed();await event('entry');const old=await exitAt();const payload=input(await manual.prepareManualExit('active'),'11:50:00',{confirmOverwrite:true}),before=await snapshot()
  const original=db.runTransaction.bind(db);db.runTransaction=fn=>original(async tx=>{await fn(tx);throw Error('abort audit')})
  try{await assert.rejects(manual.saveManualExit(payload,actor),/abort audit/)}finally{db.runTransaction=original}
  assert.deepEqual(await snapshot(),before);assert.equal((await db.doc('lpr_events/'+old.lprEventId).get()).data().supersededBy,undefined)
 })
 await check('DST real later exit closes visit despite earlier wall time',async()=>{
  clock='2026-10-25T12:00:00.000Z';await seed('active',{startDate:'2026-10-25',startTime:'00:00',endDate:'2026-10-26'})
  await instantEvent('entry','2026-10-25T00:50:00Z');await totals(1)
  assert.equal((await read('active')).lpr.arrivedAt,'2026-10-25T03:50:00.000Z')
  const r=await instantEvent('exit','2026-10-25T01:10:00Z');assert.equal(r.matchedBookingId,'active');await totals(0)
  assert.equal((await read('active')).lpr.departedAtInstant,'2026-10-25T01:10:00.000Z')
 })
 await check('DST old exit cannot close later reentry even if wall time looks newer',async()=>{
  clock='2026-10-25T12:00:00.000Z';await seed('active',{startDate:'2026-10-25',startTime:'00:00',endDate:'2026-10-26'})
  await instantEvent('entry','2026-10-24T23:00:00Z');await instantEvent('exit','2026-10-25T00:30:00Z');await instantEvent('entry','2026-10-25T01:20:00Z')
  const before=await snapshot();assert.equal((await instantEvent('exit','2026-10-25T00:40:00Z')).warning,'out_of_order_event');assert.deepEqual(await snapshot(),before);await totals(1)
 })
 await check('DST identical wall clocks represent distinct correctly ordered crossings',async()=>{
  clock='2026-10-25T12:00:00.000Z';await instantEvent('entry','2026-10-25T00:30:00Z');await totals(1)
  const x=await instantEvent('exit','2026-10-25T01:30:00Z');await totals(0)
  const b=await read(x.matchedBookingId);assert.equal(b.durationMinutes,60)
 })
 await check('ambiguous wall-clock camera exit quarantined; exact valid exit later succeeds',async()=>{
  clock='2026-10-25T12:00:00.000Z';await instantEvent('entry','2026-10-25T00:00:00Z')
  const ambiguous=await event('exit','2026-10-25T03:30:00Z');assert.equal(ambiguous.warning,'ambiguous_event_time');await totals(1)
  await instantEvent('exit','2026-10-25T02:30:00Z');await totals(0)
 })
 await check('legacy ambiguous entry blocks guessing an exit within repeated hour',async()=>{
  clock='2026-10-25T12:00:00.000Z';await legacy({arrivedAt:'2026-10-25T03:30:00Z',lastSeenAt:'2026-10-25T03:30:00Z'})
  assert.equal((await instantEvent('exit','2026-10-25T00:40:00Z')).warning,'ambiguous_event_order');await totals(1)
  await instantEvent('exit','2026-10-25T02:10:00Z');await totals(0)
 })
 await check('manual repeated and nonexistent hours require review; ordinary hour works',async()=>{
  clock='2026-10-25T12:00:00.000Z';await seed('active',{startDate:'2026-10-25',startTime:'00:00',endDate:'2026-10-26'});await instantEvent('entry','2026-10-24T23:00:00Z')
  await reject(exitAt('active','03:30:00',{date:'2026-10-25'}),'AMBIGUOUS_TIME');await totals(1)
  await reject(exitAt('active','03:30:00',{date:'2026-03-29'}),'AMBIGUOUS_TIME');await totals(1)
  await exitAt('active','04:00:00',{date:'2026-10-25'});await totals(0)
 })
 await check('spring transition calculates real elapsed time and accepts correct exit',async()=>{
  clock='2026-03-29T12:00:00.000Z';await instantEvent('entry','2026-03-29T00:50:00Z')
  const x=await instantEvent('exit','2026-03-29T01:10:00Z');await totals(0);assert.equal((await read(x.matchedBookingId)).durationMinutes,20)
 })
 await check('invalid spring camera wall time is not applied',async()=>{
  clock='2026-03-29T12:00:00.000Z';const e=await event('entry','2026-03-29T03:30:00Z');assert.equal(e.warning,'invalid_event_time');await totals(0)
 })
 await check('absolute metadata survives a plate correction during repeated hour',async()=>{
  clock='2026-10-25T12:00:00.000Z';await seed('active',{startDate:'2026-10-25',startTime:'00:00',endDate:'2026-10-26'});await instantEvent('entry','2026-10-25T00:50:00Z');await correct()
  const state=(await db.doc('lpr_plate_state/TEST02').get()).data();assert.equal(state.lastEventAtInstant,'2026-10-25T00:50:00.000Z')
  await camera({plateNumber:'TEST02',deviceId:'iesire_1',direction:'exit',snapTime:'2026-10-25T01:10:00Z',accurateTime:null,laneNo:1,timestampMode:'instant'});await totals(0)
 })
 await check('normal exit retry and manual-camera concurrency decrement once',async()=>{
  await seed();await event('entry');const ctx=await manual.prepareManualExit('active')
  const rs=await Promise.allSettled([manual.saveManualExit(input(ctx),actor),event('exit','2026-07-16T12:00:00Z')])
  for(const r of rs)if(r.status==='rejected')assert.equal(r.reason.code,'CONTEXT_CHANGED')
  await event('exit','2026-07-16T12:00:00Z');await totals(0)
 })
 await check('server now distinguishes both occurrences without guessing a typed time',async()=>{
  for(const at of ['2026-10-25T00:30:00.900Z','2026-10-25T01:30:00.900Z']) {
   const real=new Date(at),wall=actualCivilClock(real)
   assert.equal(manual.manualLprInstant(wall,true,real),at.replace('.900','.000'))
   assert.throws(()=>manual.manualLprInstant(wall,false,real),e=>e.code==='AMBIGUOUS_TIME')
  }
 })
 await check('DST correction boundary rejects delayed reading before correction on former number',async()=>{
  clock='2026-10-25T12:00:00.000Z';await seed('active',{startDate:'2026-10-25',startTime:'00:00',endDate:'2026-10-26'})
  await instantEvent('entry','2026-10-25T00:30:00Z');await correct()
  await db.doc('lpr_plate_state/TEST01').update({'plateCorrection.through':'2026-10-25T03:10:00.000Z','plateCorrection.throughInstant':'2026-10-25T01:10:00.000Z'})
  const e=await instantEvent('entry','2026-10-25T00:50:00Z');assert.equal(e.warning,'plate_corrected_event_requires_review');await totals(1)
 })
 await check('receipt without visitId can be superseded by exact closed departure match',async()=>{
  await seed();await event('entry');clock='2026-07-16T15:00:00.000Z';const old=await exitAt('active','14:00:00')
  await db.doc('lpr_events/'+old.lprEventId).update({visitId:null})
  await exitAt('active','12:00:00',{confirmOverwrite:true});assert.ok((await db.doc('lpr_events/'+old.lprEventId).get()).data().supersededBy)
  await event('entry','2026-07-16T13:00:00Z');await totals(1)
 })
 await check('closed booking and different closed pointer time require review before correction',async()=>{
  await seed();await event('entry');await exitAt();await db.doc('lpr_plate_state/TEST01').update({lastEventAt:'2026-07-16T13:00:00Z',lastEventAtInstant:'2026-07-16T10:00:00Z'})
  const before=await snapshot();await reject(exitAt('active','11:50:00',{confirmOverwrite:true}),'EXIT_REQUIRES_REVIEW');assert.deepEqual(await snapshot(),before)
 })
 await check('DST entry failure and pending exit recover in actual chronological order',async()=>{
  clock='2026-10-25T12:00:00.000Z';failAssociation=1
  const e=await instantEvent('entry','2026-10-25T00:50:00Z'),x=await instantEvent('exit','2026-10-25T01:10:00Z')
  assert.equal(x.warning,'earlier_event_pending');await totals(0)
  await db.doc('lpr_events/'+e.savedEventId).update({nextAttemptAt:0});await retry();await totals(1)
  await db.doc('lpr_events/'+x.savedEventId).update({nextAttemptAt:0});await retry();await totals(0)
 })
 await check('DST new visit after an exit with later wall time is accepted once',async()=>{
  clock='2026-10-25T12:00:00.000Z';await seed('active',{startDate:'2026-10-25',startTime:'00:00',endDate:'2026-10-26'})
  await instantEvent('entry','2026-10-24T23:30:00Z');await instantEvent('exit','2026-10-25T00:50:00Z');await totals(0)
  const r=await instantEvent('entry','2026-10-25T01:10:00Z');assert.equal(r.matchedBookingId,'active');await totals(1)
  await instantEvent('entry','2026-10-25T03:10:00+02:00');await totals(1)
 })
 await check('clock conversion is independent from host zone and preserves milliseconds',async()=>{
  const {cameraEventInstant,parseCameraTime}=load('lib/lpr-camera-config.server.ts'),{lprTimeCandidates,lprTime}=load('lib/lpr-time.ts'),old=process.env.TZ
  try{for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']) {
   process.env.TZ=zone
   assert.equal(cameraEventInstant('2026-10-25T03:30:00.123+03:00','instant'),'2026-10-25T00:30:00.123Z')
   assert.equal(parseCameraTime('2026-10-25T01:30:00.456Z','instant'),'2026-10-25T03:30:00.456Z')
   assert.equal(cameraEventInstant('2026-10-25T03:30:00Z'),null)
   assert.equal(lprTimeCandidates(lprTime('2026-03-29T03:30:00Z')).length,0)
   assert.equal(cameraEventInstant('2026-07-16T13:00:00.123Z'),'2026-07-16T10:00:00.123Z')
  }}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old}
 })
 await check('invalid or inconsistent absolute metadata fails closed without mutating presence',async()=>{
  const {lprTimeCandidates,lprTime}=load('lib/lpr-time.ts')
  assert.deepEqual(lprTimeCandidates(lprTime(1e20)),[])
  assert.deepEqual(lprTimeCandidates(lprTime('2026-07-16T10:00:00Z','bad')),[])
  await seed();await event('entry');await db.doc('bookings/active').update({'lpr.lastSeenAtInstant':'2026-07-16T05:00:00Z'})
  const before=await snapshot();await reject(exitAt(),'EXIT_REQUIRES_REVIEW')
  assert.equal((await event('exit','2026-07-16T12:00:00Z')).warning,'ambiguous_event_order');assert.deepEqual(await snapshot(),before)
 })
 await check('unassociated entry simultaneous with exit is ambiguous on both channels',async()=>{
  await seed();await event('entry');await db.doc('lpr_events/simultaneous').set({normalizedPlate:'TEST01',eventType:'entry',eventTime:'2026-07-16T12:00:00Z',associationStatus:'needs_review'})
  const before=await snapshot();await reject(exitAt(),'EXIT_REQUIRES_REVIEW')
  assert.equal((await event('exit','2026-07-16T12:00:00Z')).warning,'ambiguous_exit_order');assert.deepEqual(await snapshot(),before)
 })
 console.log(`${passed} exit-protection regression scenarios passed`)
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>deleteApp(app))
