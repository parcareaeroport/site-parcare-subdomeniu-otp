// Isolated diagnostics contract tests; no Firebase or network access.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map(),logs=[]
const original={...console}
for(const level of ['info','warn','error']) console[level]=line=>logs.push({level,...JSON.parse(line)})
function load(relative){
 const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports
 const mod={exports:{}};cache.set(file,mod)
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText
 new Function('require','module','exports',js)(name=>{
  if(name==='server-only')return {}
  if(name==='@/lib/lpr-service')return {retryPendingLprEvents:async()=>({processed:0,results:[]})}
  if(name.startsWith('@/'))return load(name.slice(2)+'.ts')
  if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name))+'.ts')
  return require(name)
 },mod,mod.exports);return mod.exports
}
async function main(){
 const {withLprRequest,lprLog,lprFields,lprTransaction,lprError}=load('lib/lpr-log.server.ts')
 const request=()=>new Request('http://localhost/test',{method:'POST',headers:{Authorization:'SECRET_SENTINEL'}})
 let attempts=0
 const db={runTransaction:async cb=>{await cb({});return cb({})}}
 const run=withLprRequest(async req=>{
  lprFields({plate:'TEST01',authorization:'SECRET_SENTINEL',email:'SECRET_SENTINEL'})
  await lprTransaction(db,async()=>{attempts++;lprLog('visit_committed',{occupancyDelta:1,bookingId:'booking-'+attempts,raw:'SECRET_SENTINEL'});return 42})
  return new Response('unchanged',{status:200})
 })
 const response=await run(request());assert.equal(await response.text(),'unchanged')
 assert.equal(logs.filter(l=>l.stage==='visit_committed').length,1)
 assert.equal(logs.find(l=>l.stage==='visit_committed').bookingId,'booking-2')
 assert.equal(new Set(logs.map(l=>l.requestId)).size,1)
 assert.equal(JSON.stringify(logs).includes('SECRET_SENTINEL'),false)
 logs.length=0
 await assert.rejects(lprTransaction({runTransaction:async cb=>{await cb({});throw Error('aborted')}},async()=>lprLog('must_not_commit',{occupancyDelta:-1})))
 assert.equal(logs.length,0)
 await Promise.all(['ONE','TWO'].map(plate=>withLprRequest(async()=>{lprFields({plate});await Promise.resolve();lprLog('isolated');return new Response()})(request())))
 assert.equal(new Set(logs.filter(l=>l.stage==='isolated').map(l=>l.requestId)).size,2)
 assert.deepEqual(logs.filter(l=>l.stage==='isolated').map(l=>l.plate).sort(),['ONE','TWO'])
 logs.length=0
 lprLog('bounded',{plate:'x'.repeat(10000),candidateBookingIds:Array(100).fill('y'.repeat(1000)),raw:'SECRET_SENTINEL'})
 assert.equal(logs[0].plate.length,240);assert.equal(logs[0].candidateBookingIds.length,20)
 lprError('error',new Error('SECRET_SENTINEL'));assert.equal(JSON.stringify(logs).includes('SECRET_SENTINEL'),false)
 console.info=()=>{throw Error('console unavailable')};assert.doesNotThrow(()=>lprLog('safe'));console.info=line=>logs.push(JSON.parse(line))
 logs.length=0
 const keepalive=load('app/NotificationInfo/KeepAlive/route.ts')
 assert.equal((await keepalive.POST(new Request('http://localhost/NotificationInfo/KeepAlive',{method:'POST'}))).status,200)
 assert.equal(logs.length,1);assert.equal(logs[0].outcome,'alive')
 const cron=load('app/api/cron/lpr-retry/route.ts');delete process.env.CRON_SECRET
 assert.equal((await cron.GET(new Request('http://localhost/api/cron/lpr-retry'))).status,503)
 assert.equal(logs.at(-1).reason,'worker_not_configured')
 process.env.CRON_SECRET='SECRET_SENTINEL'
 assert.equal((await cron.GET(new Request('http://localhost/api/cron/lpr-retry'))).status,401)
 const anpr=load('app/api/anpr/route.ts')
 assert.equal((await anpr.POST(new Request('http://localhost/api/anpr',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'SECRET_SENTINEL',image:'SECRET_SENTINEL',email:'SECRET_SENTINEL'})}))).status,200)
 for(const route of ['app/api/metrici-lpr-oprit/route.ts','app/api/metrici-lpr-oprit(elimina-oprit-pt-functionare)/[type]/route.ts']){
  const api=load(route);process.env.LPR_ENABLED='false'
  await api.POST(new Request('http://localhost/metrici',{method:'POST'}),{params:Promise.resolve({type:'check'})})
  assert.equal(logs.at(-1).reason,'disabled')
 }
 delete process.env.LPR_ENABLED;delete process.env.LPR_API_ACTIVE;delete process.env.LPR_AUTH_SECRET
 process.env.LPR_DEBUG_MODE='true'
 for(const route of ['app/api/metrici-lpr-oprit/route.ts','app/api/metrici-lpr-oprit(elimina-oprit-pt-functionare)/[type]/route.ts']){
  const form=new FormData();form.set('number','TEST01');form.set('direction','1');form.set('auth','SECRET_SENTINEL');form.set('email','SECRET_SENTINEL');form.set('image',new Blob(['SECRET_SENTINEL']),'secret.jpg')
  const response=await load(route).POST(new Request('http://localhost/metrici',{method:'POST',headers:{Authorization:'SECRET_SENTINEL'},body:form}),{params:Promise.resolve({type:'check'})})
  assert.equal(response.status,200);assert.ok((await response.text()).includes('open_barrier'))
  assert.equal(logs.at(-1).plate,'TEST01')
 }
 assert.equal(JSON.stringify(logs).includes('SECRET_SENTINEL'),false)
 original.log('PASS logging: transaction retry/abort, correlation/concurrency, redaction/bounds, logger failure, KeepAlive, cron refusals, ANPR, disabled Metrici')
}
main().catch(e=>{original.error(e);process.exitCode=1}).finally(()=>Object.assign(console,original))
