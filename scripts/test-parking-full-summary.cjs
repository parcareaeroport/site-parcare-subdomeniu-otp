const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), ts=require('typescript')
const root=path.resolve(__dirname,'..'), cache=new Map()
let snapshot={rows:[],limit:2,now:Date.parse('2030-03-28T12:00:00Z')}, fail=false, reads=0
function load(file) {
 if(cache.has(file))return cache.get(file).exports
 const mod={exports:{}};cache.set(file,mod)
 const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
 new Function('require','module','exports',js)(id=>{
  if(id==='@/lib/firebase-admin')return {adminAuth:{verifyIdToken:async token=>{if(!['admin','employee','entriesOperator'].includes(token))throw Error('invalid');return {uid:token,role:token}}}}
  if(id==='@/lib/reservation-check-snapshot.server')return {readReservationCheckSnapshot:async include=>{assert.equal(include,true);reads++;if(fail)throw Error('fixture failure');return snapshot}}
  if(id.startsWith('@/'))return load(id.slice(2)+'.ts')
  return require(id)
 },mod,mod.exports);return mod.exports
}
const {calculateParkingFullSummary:summary}=load('lib/parking-full-summary.ts')
const {calculateOccupancyForecast:forecast}=load('lib/occupancy-forecast-calculation.ts')
const {GET}=load('app/api/admin/parking-full-summary/route.ts')
const booking=(id,patch={})=>({id,booking:{status:'confirmed_paid',startDate:'2030-03-29',startTime:'00:00',endDate:'2030-03-30',endTime:'00:00',...patch}})
for(const [name,rows,limit] of [
 ['empty',[],2],['at capacity',[booking('a')],1],['over capacity',[booking('a'),booking('b')],1],
 ['late',[booking('late',{endDate:'2030-03-27',lpr:{isInside:true}})],1],
 ['unmatched',[booking('raw',{status:'unmatched_lpr',lpr:{isInside:true}})],1],
 ['excluded',[booking('cancelled',{status:'cancelled'}),booking('pay',{status:'confirmed_pay_on_site'})],1],
 ['touching',[booking('end',{endDate:'2030-03-29'}),booking('start',{startDate:'2030-03-30'})],1],
])test('forecast parity: '+name,()=>{
 const result=summary(rows,limit,snapshot.now)
 const full=forecast(rows,limit,snapshot.now,{from:result.from,to:result.to,simulator:{startDate:result.from,startTime:'00:00',endDate:result.to,endTime:'00:00'}})
 assert.equal(full.days.length,30)
 assert.deepEqual(result.fullDays,full.days.filter(d=>!d.available).map(d=>d.interval.startDate))
 assert.deepEqual(result.warningDays,full.days.filter(d=>d.totalSpots-d.conflictingBookings<=5).map(d=>d.interval.startDate))
 assert.deepEqual(Object.keys(result).sort(),['calculatedAt','from','fullDays','to','warningDays'])
 if(name==='late'||name==='unmatched')assert.equal(result.fullDays.length,30)
 if(name==='empty'||name==='excluded')assert.equal(result.fullDays.length,0)
})
for(const remaining of [6,5,4,0,-1])test('warning boundary: '+remaining+' places remaining',()=>{
 const rows=Array.from({length:290-remaining},(_,i)=>booking('b'+i))
 const result=summary(rows,290,snapshot.now)
 assert.deepEqual(result.warningDays,remaining<=5?['2030-03-29']:[])
 assert.deepEqual(result.fullDays,remaining<=0?['2030-03-29']:[])
})
for(const kind of ['late','unmatched','mixed'])test('warning uses reduced capacity: '+kind,()=>{
 const reductions=Array.from({length:5},(_,i)=>booking('reduction'+i,
  kind==='late'||(kind==='mixed'&&i<3)
   ?{endDate:'2030-03-27',lpr:{isInside:true}}
   :{status:'unmatched_lpr',lpr:{isInside:true}}))
 for(const count of [279,280]){
  const result=summary([...reductions,...Array.from({length:count},(_,i)=>booking('b'+i))],290,snapshot.now)
  assert.deepEqual(result.warningDays,count===280?['2030-03-29']:[])
  assert.deepEqual(result.fullDays,[])
 }
})
for(const [now,from,to] of [
 ['2030-12-31T22:30:00Z','2031-01-02','2031-01-31'],
 ['2030-03-31T21:30:00Z','2030-04-02','2030-05-01'],
 ['2030-03-31T20:30:00Z','2030-04-01','2030-04-30'],
 ['2030-01-31T12:00:00Z','2030-02-01','2030-03-02'],
])test('Romania window '+now,()=>{const r=summary([],2,Date.parse(now));assert.equal(r.from,from);assert.equal(r.to,to);assert.equal((Date.parse(to)-Date.parse(from))/86400000+1,30)})
test('route authorization, minimal response and errors',async()=>{
 const request=token=>new Request('http://localhost/api/admin/parking-full-summary',{headers:token?{Authorization:'Bearer '+token}:{}})
 for(const role of ['admin','employee','entriesOperator']){const r=await GET(request(role));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),summary(snapshot.rows,snapshot.limit,snapshot.now))}
 const before=reads
 for(const token of [null,'invalid']){const r=await GET(request(token));assert.equal(r.status,401);assert.equal(r.headers.get('cache-control'),'no-store')}
 assert.equal(reads,before)
 fail=true;const r=await GET(request('admin'));assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(!(await r.json()).fullDays);fail=false
})
