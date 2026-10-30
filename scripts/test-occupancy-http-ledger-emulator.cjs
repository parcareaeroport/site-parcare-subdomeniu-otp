// Real route handlers exposed through a loopback HTTP server + real Firestore emulator.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),ts=require('typescript'),{randomUUID}=require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/)
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore')
const projectId='demo-parking-http-ledger',root=path.resolve(__dirname,'..'),app=initializeApp({projectId},'http-ledger'),db=getFirestore(app),cache=new Map()
const adminAuth={verifyIdToken:async token=>{if(token!=='fixture-admin')throw Error('Invalid fixture token');return {uid:'fixture-admin',email:'admin@example.invalid',role:'admin'}}}
let failAssociation=0
const dbProxy=new Proxy(db,{get(target,key){if(key==='runTransaction')return(...args)=>{if(failAssociation){failAssociation--;throw Error('Injected transaction failure')}return target.runTransaction(...args)};const v=target[key];return typeof v==='function'?v.bind(target):v}})
function load(rel){const filename=path.resolve(root,rel);if(cache.has(filename))return cache.get(filename).exports;const m={exports:{}};cache.set(filename,m)
 const js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
 new Function('require','module','exports',js)(n=>{
  if(n==='server-only')return {}
  if(n==='@/lib/firebase-admin')return {adminDb:dbProxy,adminAuth}
  if(n==='@/app/actions/booking-actions')return {cancelBooking:async()=>({success:true})}
  if(n.startsWith('@/'))return load(n.slice(2)+'.ts')
  if(n.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(filename),n))+'.ts')
  return require(n)
 },m,m.exports);return m.exports}
let clock='2026-07-16T23:00:00.000Z'
const manual=load('lib/manual-lpr-exit.server.ts');manual.manualExitClock=()=>clock
const {romaniaCivilClock}=load('lib/lpr-time.ts')
process.env.LPR_DEVICES_JSON=JSON.stringify({intrare_1:{direction:'entry',timestampMode:'romania_wall_clock',maxEventAgeMinutes:1440},iesire_1:{direction:'exit',timestampMode:'romania_wall_clock',maxEventAgeMinutes:1440}})
process.env.CRON_SECRET='fixture-cron'
const routes={
 '/NotificationInfo/TollgateInfo':load('app/NotificationInfo/TollgateInfo/route.ts').POST,
 '/api/admin/manual-lpr-entry':load('app/api/admin/manual-lpr-entry/route.ts').POST,
 '/api/admin/manual-lpr-exit':load('app/api/admin/manual-lpr-exit/route.ts').POST,
 '/api/admin/bookings/plate':load('app/api/admin/bookings/plate/route.ts').POST,
 '/api/admin/bookings/delete':load('app/api/admin/bookings/delete/route.ts').POST,
 '/api/admin/occupancy':load('app/api/admin/occupancy/route.ts').GET,
 '/api/cron/lpr-retry':load('app/api/cron/lpr-retry/route.ts').GET,
}
const {NextRequest}=require('next/server')
let origin,scenario,report=[],expected=new Set(),steps=0,server,failed=0
const base={licensePlate:'SIM01',status:'confirmed_paid',startDate:'2026-07-16',startTime:'00:00',endDate:'2026-07-16',endTime:'23:59'}
const seed=(id='active',patch={})=>db.doc('bookings/'+id).set({...base,...patch})
async function request(route,body,status=200,token='fixture-admin'){
 const r=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:token?{Authorization:'Bearer '+token,'Content-Type':'application/json'}:{},...(body===undefined?{}:{body:JSON.stringify(body)})})
 const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data
}
async function inspect(step){
 const api=await request('/api/admin/occupancy'),bookings=(await db.collection('bookings').get()).docs.map(d=>({id:d.id,...d.data()})),counter=(await db.doc('config/parkingLive').get()).data().occupiedCount
 const open=bookings.filter(b=>b.lpr?.isInside===true),plates=open.map(b=>b.licensePlate).sort(),wanted=[...expected].sort()
 const row={scenario,step,expected:expected.size,expectedPlates:wanted,api:api.occupiedCount,counter,actualPlates:plates,passed:false}
 report.push(row);steps++
 try{
  assert.deepEqual(plates,wanted,'open booking plates must match physical model')
  assert.equal(new Set(plates).size,plates.length,'one open stay per plate')
  assert.equal(api.occupiedCount,expected.size);assert.equal(counter,expected.size)
  assert.deepEqual(api.plates.map(p=>p.licensePlate).sort(),wanted)
  assert.deepEqual(api.plates.map(p=>p.id).sort(),open.map(p=>p.id).sort())
  for(const b of open){const p=(await db.doc('lpr_plate_state/'+b.licensePlate).get()).data();assert.ok(p?.isInside);assert.equal(p.bookingId,b.id);assert.equal(p.visitId,b.lpr.visitId);assert.equal(p.lastEventType,'entry');assert.equal(b.lpr.lastEventType,'entry');assert.equal(b.lpr.departedAt,null)}
  row.passed=true
 }finally{if(process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR)fs.writeFileSync(path.join(process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR,'timeline.json'),JSON.stringify(report,null,2))}
}
async function settlePending(step){
 const pending=await db.collection('lpr_events').where('associationStatus','==','pending').get()
 if(!pending.empty){
  const api=await request('/api/admin/occupancy'),counter=(await db.doc('config/parkingLive').get()).data().occupiedCount
  report.push({scenario,step:step+' (before retry)',expected:expected.size,api:api.occupiedCount,counter,pending:pending.size,settling:true,passed:null})
  for(let attempt=0;attempt<5;attempt++){
   const due=await db.collection('lpr_events').where('associationStatus','==','pending').get()
   if(due.empty)break
   // Advance scheduling for this synthetic fixture; don't wait real minutes.
   const batch=db.batch();for(const d of due.docs)batch.update(d.ref,{nextAttemptAt:0});await batch.commit()
   await request('/api/cron/lpr-retry',undefined,200,'fixture-cron')
  }
  assert.equal((await db.collection('lpr_events').where('associationStatus','==','pending').get()).size,0,'retry must drain all recoverable fixtures')
 }
 await inspect(step+' (after retry if needed)')
}
async function camera(type,time,plate='SIM01',extra={}){
 return request('/NotificationInfo/TollgateInfo',{Picture:{Plate:{PlateNumber:plate},SnapInfo:{DeviceID:type==='entry'?'intrare_1':'iesire_1',Direction:'Obverse',AccurateTime:`2026-07-16 ${time}`,SnapTime:`2026-07-16 ${time}`,Source:'Realtime',...extra}}},200,null)
}
async function manualSave(type,id,time,patch={}){
 const route='/api/admin/manual-lpr-'+type,ctx=await request(route,{action:'prepare',bookingId:id});await inspect('prepare manual '+type)
 const body={action:'save',bookingId:id,version:ctx.version,requestId:randomUUID(),date:'2026-07-16',time,...(type==='entry'?{entryMode:'new_visit',confirmReentry:!!ctx.departure}:{}),...patch}
 return {body,result:await request(route,body)}
}
async function check(name,fn){
 scenario=name;expected=new Set();failAssociation=0;clock='2026-07-16T23:00:00.000Z';delete process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON;delete process.env.LPR_TOLLGATE_WHITELIST
 assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,{method:'DELETE'})).ok)
 await db.doc('config/parkingLive').set({occupiedCount:0});await db.doc('config/reservationSettings').set({maxTotalReservations:290});try{await fn();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e);process.exitCode=1}
}
async function main(){
 server=http.createServer(async(req,res)=>{try{const url=origin+req.url,handler=routes[new URL(url).pathname];if(!handler){res.writeHead(404);res.end('{}');return}const chunks=[];for await(const chunk of req)chunks.push(chunk);const r=await handler(new NextRequest(url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}));res.writeHead(r.status,Object.fromEntries(r.headers));res.end(await r.text())}catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}))}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port
 await check('Camera -> exit -> reentry -> exit, with replay',async()=>{
  await seed();await inspect('reservation exists, vehicle absent')
  const a=await camera('entry','10:00:00');assert.equal(a.matchedBookingId,'active');expected.add('SIM01');await inspect('camera entry')
  await camera('entry','10:00:00');await inspect('same entry replayed')
  await camera('exit','11:00:00');expected.delete('SIM01');await inspect('camera exit')
  await camera('exit','11:00:00');await inspect('same exit replayed')
  await camera('entry','12:00:00');expected.add('SIM01');await inspect('new visit')
  await camera('exit','13:00:00');expected.delete('SIM01');await inspect('second exit')
 })
 await check('Camera entry -> manual exit -> camera exit',async()=>{
  await seed();await camera('entry','10:00:00');expected.add('SIM01');await inspect('entry')
  const manual=await manualSave('exit','active','11:00:00');expected.delete('SIM01');await inspect('manual exit')
  await request('/api/admin/manual-lpr-exit',manual.body);await inspect('manual save replay')
  await camera('exit','11:01:00');await inspect('later camera exit, no second decrement')
 })
 await check('Manual entry -> camera -> manual exit',async()=>{
  await seed();await manualSave('entry','active','10:00:00');expected.add('SIM01');await inspect('manual entry')
  await camera('entry','10:01:00');await inspect('camera confirms arrival')
  await manualSave('exit','active','11:00:00');expected.delete('SIM01');await inspect('manual exit')
 })
 await check('Without reservation, whitelist, ambiguous reservations',async()=>{
  await camera('entry','10:00:00','SIMFREE');expected.add('SIMFREE');await inspect('unmatched arrival')
  await camera('exit','11:00:00','SIMFREE');expected.delete('SIMFREE');await inspect('unmatched departure')
  await db.doc('lpr_whitelist/SIMSTAFF').set({});await camera('entry','10:00:00','SIMSTAFF');await inspect('whitelist arrival ignored')
  await camera('exit','11:00:00','SIMSTAFF');await inspect('whitelist departure ignored')
  await seed('choice1');await seed('choice2');assert.equal((await camera('entry','12:00:00')).warning,'ambiguous_reservations');await inspect('ambiguous arrival blocked')
 })
 await check('Stale manual dialog cannot close a reentered car',async()=>{
  await seed();await camera('entry','10:00:00');expected.add('SIM01');await inspect('entry')
  const ctx=await request('/api/admin/manual-lpr-exit',{action:'prepare',bookingId:'active'});await inspect('dialog opened')
  await camera('exit','11:00:00');expected.delete('SIM01');await inspect('exit after dialog opened')
  await camera('entry','12:00:00');expected.add('SIM01');await inspect('reentry after dialog opened')
  const r=await request('/api/admin/manual-lpr-exit',{action:'save',bookingId:'active',version:ctx.version,requestId:randomUUID(),date:'2026-07-16',time:'12:30:00'},409);assert.equal(r.code,'CONTEXT_CHANGED');await inspect('stale save refused')
  await camera('exit','13:00:00');expected.delete('SIM01');await inspect('valid later exit')
 })
 await check('Concurrent different cars and repeated same-camera deliveries',async()=>{
  for(let i=0;i<4;i++)await seed('car'+i,{licensePlate:'SIMCAR'+i})
  await inspect('four reservations only')
  await Promise.all(Array.from({length:12},(_,i)=>camera('entry','10:00:00','SIMCAR'+(i%4))))
  for(let i=0;i<4;i++)expected.add('SIMCAR'+i);await settlePending('12 deliveries = 4 arrivals')
  await Promise.all(Array.from({length:12},(_,i)=>camera('exit','11:00:00','SIMCAR'+(i%4))));expected.clear();await settlePending('12 deliveries = 4 departures')
 })
 await check('Transactional failure -> cron recovery, no double count',async()=>{
  await seed();failAssociation=1;const r=await camera('entry','10:00:00');assert.equal(r.status,'pending')
  // Physical arrival happened even though association was temporarily unavailable.
  expected.add('SIM01');await settlePending('receipt saved, cron recovers actual arrival')
  await request('/api/cron/lpr-retry',undefined,200,'fixture-cron');await inspect('cron repeated')
  await camera('exit','11:00:00');expected.clear();await inspect('exit after recovery')
 })
 await check('Plate correction retains one physical stay, old plate cannot remove it',async()=>{
  await seed();await camera('entry','10:00:00');expected.add('SIM01');await inspect('entry')
  clock='2026-07-16T11:00:00.000Z'
  const ctx=await request('/api/admin/bookings/plate',{action:'prepare',bookingId:'active',plate:'SIM02'});await inspect('plate-change prepare')
  await request('/api/admin/bookings/plate',{action:'save',bookingId:'active',plate:'SIM02',version:ctx.version,confirmPresent:true});expected.delete('SIM01');expected.add('SIM02');await inspect('plate corrected, count same')
  await camera('exit','10:59:00','SIM01');await inspect('old plate event cannot close corrected visit')
  clock='2026-07-16T23:00:00.000Z';await camera('exit','12:00:00','SIM02');expected.clear();await inspect('corrected plate exit')
 })
 await check('Deleting an occupied reservation is blocked; deletion after departure is safe',async()=>{
  await seed();await camera('entry','10:00:00');expected.add('SIM01');await inspect('entry')
  const r=await request('/api/admin/bookings/delete',{bookingId:'active'},409);assert.equal(r.code,'VEHICLE_PRESENT');await inspect('deletion refused while inside')
  await camera('exit','11:00:00');expected.clear();await inspect('exit')
  await request('/api/admin/bookings/delete',{bookingId:'active'});await inspect('delete closed booking')
 })
 await check('Corrected camera clocks retain original data and occupancy sequence',async()=>{
  await seed();process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON=JSON.stringify({intrare_1:3149,iesire_1:3206})
  const r=await camera('entry','10:52:29');expected.add('SIM01');await inspect('offset entry')
  const e=(await db.doc('lpr_events/'+r.savedEventId).get()).data();assert.equal(e.eventTime,'2026-07-16T10:00:00.000Z');assert.equal(e.accurateTime,'2026-07-16 10:52:29')
  await camera('exit','11:53:26');expected.clear();await inspect('offset exit')
 })
 console.log(`${failed?'FAIL':'PASS'} ${10-failed}/10 HTTP ledger flows, ${steps} occupancy checkpoints`)
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR)fs.writeFileSync(path.join(process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR,'timeline.json'),JSON.stringify(report,null,2));if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server.closeAllConnections()}await deleteApp(app)})
