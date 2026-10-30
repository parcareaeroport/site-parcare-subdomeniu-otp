// Inspect logs from the emulator suites; no database access.
const assert=require('node:assert/strict'),fs=require('node:fs')
const files=process.argv.slice(2)
assert.ok(files.length,'Provide emulator suite log files')
const logs=files.flatMap(f=>fs.readFileSync(f,'utf8').split('\n').filter(l=>l.startsWith('{"prefix":"LPR"')).map(JSON.parse))
assert.ok(logs.length)
for(const reason of ['invalid_event_time','future_event_time','stale_event_time','unknown_direction','ambiguous_reservations','multiple_open_visits','whitelist_skip','association_failed','duplicate'])
 assert.ok(logs.some(l=>l.reason===reason||l.outcome===reason),`Missing diagnostic coverage: ${reason}`)
for(const stage of ['visit_committed','manual_prepared','manual_saved','manual_replay','retry_result','admin_review'])
 assert.ok(logs.some(l=>l.stage===stage),`Missing stage: ${stage}`)
for(const log of logs){
 for(const key of ['raw','body','headers','authorization','cookie','email','adminEmail','image','token']) assert.equal(key in log,false)
 if(log.stage==='visit_committed'){
  assert.ok([-1,0,1].includes(log.occupancyDelta))
  assert.ok(log.bookingId && log.eventId)
  if(log.occupancyDelta===1){assert.equal(log.insideBefore,false);assert.equal(log.insideAfter,true)}
  if(log.occupancyDelta===-1){assert.equal(log.insideBefore,true);assert.equal(log.insideAfter,false)}
 }
 if(log.stage==='manual_replay') assert.equal(log.occupancyDelta,0)
 if(log.stage==='response')assert.ok(log.requestId && Number.isFinite(log.status) && Number.isFinite(log.durationMs))
}
console.log(`PASS diagnostics assertions across ${logs.length} emulator log entries`)
