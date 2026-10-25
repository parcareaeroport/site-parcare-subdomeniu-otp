const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
function load(file, mocks = {}, date = Date) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require(id) { if (!(id in mocks)) throw Error(`Unexpected import ${id}`); return mocks[id] }, Date: date, Intl, performance, console: {error(){} } })
  return exports
}
const presence = load('lib/lpr-presence.ts')
const capacity = load('lib/reservation-availability-calculation.ts', {'@/lib/lpr-presence': presence})
const forecast = load('lib/occupancy-forecast-calculation.ts', {'@/lib/lpr-presence':presence,'@/lib/reservation-availability-calculation':capacity})
const now = new Date('2030-03-28T12:00:00').getTime()
const interval = {startDate:'2030-03-30',startTime:'00:00',endDate:'2030-03-31',endTime:'00:00'}
const input = {from:interval.startDate,to:interval.startDate,simulator:interval}
const booking = (id, overrides = {}) => ({id, booking:{...interval, status:'confirmed_paid',licensePlate:'B1TEST', ...overrides}})
const availability = (rows, limit, i = interval, diagnostic) => capacity.calculateReservationAvailability(rows,i.startDate,i.startTime,i.endDate,i.endTime,limit,now,diagnostic)
const plain = value => JSON.parse(JSON.stringify(value))
const fields = value => Object.fromEntries(['available','conflictingBookings','totalSpots','maxBookingsInPeriod'].map(key=>[key,value[key]]))
for (const [name, rows, limit, expected] of [
  ['exact capacity permits the additional car',[booking('1')],2,true],
  ['one car over capacity blocks',[booking('1'),booking('2')],2,false],
  ['touching ends do not overlap',[booking('1',{endDate:'2030-03-30',endTime:'00:00'}), booking('2',{startDate:'2030-03-31'})],1,true],
  ['successive bookings count separately across entire interval',[booking('1',{endDate:'2030-03-30',endTime:'12:00'}),booking('2',{startTime:'12:00'})],2,false],
  ['pay on site excluded from overlaps',[booking('1',{status:'confirmed_pay_on_site'})],1,true],
  ['cancelled and expired excluded',[booking('1',{status:'cancelled'}),booking('2',{status:'expired'})],1,true],
  ['duplicate plates not deduplicated',[booking('1'),booking('2')],2,false],
]) test(name,()=>{
  const d = capacity.createAvailabilityDiagnostics()
  const a = availability(rows,limit,interval,d)
  assert.equal(a.available,expected)
  assert.deepEqual(plain(a),plain(availability(rows,limit)))
  const result = forecast.calculateOccupancyForecast(rows,limit,now,input)
  assert.deepEqual(fields(result.days[0]),fields(a)); assert.deepEqual(fields(result.simulator),fields(a))
  assert.equal(d.overlapping.length,a.conflictingBookings)
  assert.equal(a.totalSpots,Math.max(0,limit-d.delayed.length-d.unmatched.length))
  for(const list of Object.values(d)) for(const entry of list) { assert.ok(result.documents[entry.id]);assert.ok(entry.reason) }
})
test('late presence, raw unmatched rule and historical exits/new entries',()=>{
  const past = {startDate:'2030-03-20',endDate:'2030-03-21',lpr:{isInside:true}}
  const rows = [booking('late',past),booking('pay-late',{...past,status:'confirmed_pay_on_site'}),
    booking('exit',{...past,lpr:{isInside:true,lastEventType:'exit'}}),
    booking('reentry',{...past,lpr:{isInside:true,lastEventType:'entry',departedAt:'2030-03-22T10:00:00',lastSeenAt:'2030-03-23T10:00:00'}}),
    booking('raw',{status:'unmatched_lpr',lpr:{isInside:true,lastEventType:'exit'}}),
    booking('outside',{status:'unmatched_lpr',lpr:{isInside:false}})]
  const r = forecast.calculateOccupancyForecast(rows,10,now,input)
  assert.equal(r.simulator.delayedCount,3);assert.equal(r.simulator.unmatchedInsideCount,1);assert.equal(r.simulator.totalSpots,6)
  assert.ok(r.documents.raw.warnings.some(x=>x.includes('contradictorii')))
  assert.ok(r.documents.late.warnings.some(x=>x.includes('repetat')))
  assert.ok(r.simulator.diagnostics.excluded.some(x=>x.id==='pay-late' && x.reason.includes('Plată la parcare')))
  assert.equal(r.days[0].totalSpots,6)
})
for(const [startDate,endDate] of [['2030-03-30','2030-04-01'],['2030-10-26','2030-10-28'],['2030-03-30','2030-03-31']]) {
  test(`midnight and DST parity ${startDate} (${process.env.TZ})`,()=>{
    const i={startDate,startTime:'22:00',endDate,endTime:'04:00'}, rows=[booking('night',{...i})]
    const r=forecast.calculateOccupancyForecast(rows,5,now,{from:startDate,to:endDate,simulator:i})
    assert.deepEqual(fields(r.simulator),fields(availability(rows,5,i)))
    assert.equal(r.days.length,Math.round((Date.parse(endDate)-Date.parse(startDate))/86400000)+1)
    assert.equal(new Set(r.days.map(x=>x.interval.startDate)).size,r.days.length)
    for(const day of r.days) assert.deepEqual(fields(day),fields(availability(rows,5,day.interval)))
  })
}
test('maxBookingsInPeriod does not decide acceptance',()=>{
  const i={...interval,startTime:'12:00',endTime:'13:00',endDate:interval.startDate}
  const a=availability([booking('early',{endDate:interval.startDate,endTime:'10:00'})],1,i)
  assert.equal(a.maxBookingsInPeriod,1);assert.equal(a.conflictingBookings,0);assert.equal(a.available,true)
})
test('bad relevant stored interval fails entire forecast; invalid input rejected',()=>{
  assert.throws(()=>forecast.calculateOccupancyForecast([booking('bad',{startTime:'invalid'})],5,now,input))
  assert.throws(()=>forecast.calculateOccupancyForecast([],NaN,now,input))
  for(const value of [null,{}, {...input,from:'2030-02-30'}, {...input,simulator:{...interval,endDate:interval.startDate}}, {...input,simulator:{...interval,startTime:'24:00'}}]) assert.equal(forecast.validateForecastInput(value),false)
})
function snapshotFixture(limit, failure) {
  const reads=[];let selected;let statuses
  const query={where(_f,_op,s){statuses=s;return this},select(...fields){selected=fields;return this},async get(){reads.push('bookings');if(failure==='bookings')throw Error('offline');return {docs:[{id:'one',data:()=>booking('one').booking}]}}}
  const adminDb = { collection(name) {
    if (name === 'bookings') return query
    return { doc() { return { async get() {
      reads.push('config')
      if (failure === 'config') throw Error('offline')
      return { data: () => ({ maxTotalReservations: limit }) }
    } } } }
  } }
  const reader=load('lib/reservation-check-snapshot.server.ts',{
    'server-only':{}, '@/lib/firebase-admin':{adminDb},
    '@/lib/mobile-reservation-conflicts':{CONFLICT_STATUSES:['paid','expired'],RESERVATION_CHECK_FIELDS:['status','licensePlate']},
  }, class extends Date {static now(){return now}})
  return {reader,reads,get statuses(){return statuses}, get selected(){return selected}}
}
for(const admin of [false,true]) test(`snapshot reads each collection once; admin=${admin}`,async()=>{
  const f=snapshotFixture(0);const result=await f.reader.readReservationCheckSnapshot(admin)
  assert.deepEqual(f.reads.sort(),['bookings','config']);assert.equal(result.limit,100);assert.equal(result.now,now)
  assert.equal(f.statuses===undefined,admin);assert.deepEqual(plain(f.selected),['status','licensePlate'])
})
test('mobile service retains result contract and uses snapshot clock',async()=>{
  const f=snapshotFixture(2)
  const mobile=load('lib/mobile-reservation-check.server.ts',{'server-only':{},'@/lib/reservation-check-snapshot.server':f.reader,
    '@/lib/mobile-reservation-conflicts':{findMobileReservationConflict:()=>({exists:false,unavailable:false})},'@/lib/reservation-availability-calculation':capacity})
  const metrics={};const r=await mobile.checkMobileReservation(interval,{},metrics)
  assert.deepEqual(Object.keys(r).sort(),['availability','conflict'])
  const a=forecast.calculateOccupancyForecast([booking('one')],2,now,input)
  assert.deepEqual(fields(r.availability),fields(a.simulator));assert.equal(metrics.documents,1);assert.ok(metrics.readMs>=0)
})
function routeFixture({allowed=true,failure,limit=2}={}) {
  const f=snapshotFixture(limit,failure)
  const json=(body,{status=200,headers={}}={})=>({body,status,headers:new Headers(headers)})
  const route=load('app/api/admin/occupancy-forecast/route.ts',{
    'next/server':{NextResponse:{json}},'@/lib/admin-api-auth':{authorizeAdminRequest:async(_req,roles)=>{
      assert.deepEqual(plain(roles),['admin','employee']);return allowed?{ok:true}:{ok:false,response:json({error:'Forbidden'},{status:403})}
    }},'@/lib/reservation-check-snapshot.server':f.reader,'@/lib/occupancy-forecast-calculation':forecast,
  })
  return {...f,route}
}
for(const failure of ['config','bookings']) test(`route fails closed on ${failure} read failure`,async()=>{
  const f=routeFixture({failure});const r=await f.route.POST({json:async()=>input})
  assert.equal(r.status,503);assert.equal(r.body.error,'Calcul indisponibil');assert.equal(r.body.days,undefined);assert.equal(r.headers.get('Cache-Control'),'no-store')
})
test('route authorizes before reads and rejects malformed input',async()=>{
  const denied=routeFixture({allowed:false});assert.equal((await denied.route.POST({})).status,403);assert.equal(denied.reads.length,0)
  const f=routeFixture();assert.equal((await f.route.POST({json:async()=>({})})).status,400);assert.equal(f.reads.length,0)
  assert.equal((await f.route.POST({json:async()=>{throw Error('invalid json')}})).status,400)
})
test('route recalculation reads fresh data and uses no-store',async()=>{
  const f=routeFixture();for(let i=0;i<2;i++){
    const r=await f.route.POST({json:async()=>input});assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store')
    assert.equal(r.body.calculatedAt,new Date(now).toISOString())
  }
  assert.equal(f.reads.length,4)
})
for (const [token,role,status] of [[null,null,401],['bad',null,401],['ok','entriesOperator',403],['ok','employee',200],['ok','admin',200]]) {
  test(`real authorization: role ${role}, status ${status}`,async()=>{
    const realAuth=load('lib/admin-api-auth.ts',{
      'next/server':{NextResponse:{json:(body,{status=200}={})=>({body,status,headers:new Headers()})}},
      '@/lib/firebase-admin':{adminAuth:{verifyIdToken:async token=>{if(token==='bad')throw Error('invalid');return {uid:'u',role}}}},
      '@/lib/admin-roles':load('lib/admin-roles.ts'),
    })
    const r=await realAuth.authorizeAdminRequest({headers:new Headers(token?{Authorization:`Bearer ${token}`}:{})},['admin','employee'])
    assert.equal(r.ok,status===200);if(!r.ok)assert.equal(r.response.status,status)
  })
}
test('negative remaining capacity clamps at zero and still reconciles diagnostics',()=>{
  const rows=[booking('raw1',{status:'unmatched_lpr',lpr:{isInside:true}}),booking('raw2',{status:'unmatched_lpr',lpr:{isInside:true}})]
  const r=forecast.calculateOccupancyForecast(rows,1,now,input)
  assert.equal(r.simulator.totalSpots,0);assert.equal(r.simulator.available,false);assert.equal(r.simulator.diagnostics.unmatched.length,2)
})
test('excluded malformed records preserve Expo behavior',()=>{
  const rows=[booking('excluded',{status:'cancelled',startTime:'bad',endTime:'bad'}),booking('missing',{startDate:undefined})]
  const r=forecast.calculateOccupancyForecast(rows,1,now,input)
  assert.equal(r.simulator.available,true);assert.equal(r.simulator.diagnostics.excluded.length,2)
})
