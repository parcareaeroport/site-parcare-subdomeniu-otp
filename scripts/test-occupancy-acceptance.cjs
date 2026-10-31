// One command owns a new local emulator and runs all suites sequentially.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto')
const root=path.resolve(__dirname,'..')
const entriesOnly=process.argv.includes('--entries')
const exitsOnly=process.argv.includes('--exits')
if(entriesOnly&&exitsOnly)throw Error('Choose --entries or --exits, not both')
const entrySuites=[
 'test-occupancy-entry-matrix-emulator.cjs','test-occupancy-http-ledger-emulator.cjs',
 'test-lpr-association-emulator.cjs','test-lpr-entry-protections-emulator.cjs',
 'test-manual-lpr-entry-emulator.cjs','test-lpr-ordering-corrections-emulator.cjs',
 'test-unified-occupancy-emulator.cjs','test-lpr-camera-compatibility.cjs','test-occupancy-network-guard.cjs',
]
const exitSuites=[
 'test-occupancy-exit-matrix-emulator.cjs','test-occupancy-http-ledger-emulator.cjs',
 'test-lpr-association-emulator.cjs','test-lpr-exit-protections-emulator.cjs',
 'test-manual-lpr-exit-emulator.cjs','test-booking-deletion-emulator.cjs',
 'test-lpr-ordering-corrections-emulator.cjs','test-occupancy-integrity-emulator.cjs',
 'test-unified-occupancy-emulator.cjs','test-occupancy-network-guard.cjs',
]
const suites=entriesOnly?entrySuites:exitsOnly?exitSuites:[
 'test-occupancy-exit-matrix-emulator.cjs',
 'test-occupancy-entry-matrix-emulator.cjs',
 'test-occupancy-http-ledger-emulator.cjs','test-booking-deletion-emulator.cjs','test-booking-delete-feedback.cjs','test-lpr-association-emulator.cjs',
 'test-lpr-entry-protections-emulator.cjs','test-lpr-exit-protections-emulator.cjs',
 'test-lpr-ordering-corrections-emulator.cjs','test-manual-lpr-entry-emulator.cjs',
 'test-manual-lpr-exit-emulator.cjs','test-occupancy-integrity-emulator.cjs','test-unified-occupancy-emulator.cjs',
 'test-lpr-clock-offset.cjs','test-lpr-camera-compatibility.cjs','test-lpr-logging.cjs',
 'test-lpr-attention.cjs','test-occupancy-lpr-display.cjs','test-occupancy-network-guard.cjs',
]
function run(command,args,options={}){return new Promise(resolve=>{const child=spawn(command,args,{cwd:root,...options});let done=false;const timer=setTimeout(()=>child.kill('SIGTERM'),options.timeout||300000);child.on('error',error=>{if(!done){done=true;clearTimeout(timer);resolve({code:1,error:error.message})}});child.on('exit',(code,signal)=>{if(!done){done=true;clearTimeout(timer);resolve({code:code??1,signal})}})})}
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
async function childRun(dir){
 if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only local Firestore emulator allowed')
 const results=[]
 for(const suite of suites){
  const file=path.join(dir,suite+'.log'),fd=fs.openSync(file,'w'),started=Date.now()
  const result=await run(process.execPath,[path.join('scripts',suite)],{env:{...process.env,OCCUPANCY_ACCEPTANCE_REPORT_DIR:dir,NODE_OPTIONS:'--require '+path.join(__dirname,'occupancy-network-guard.cjs')},stdio:['ignore',fd,fd],timeout:180000});fs.closeSync(fd)
  const log=fs.readFileSync(file,'utf8'),checks=log.split(/\r?\n/).filter(l=>/^PASS(?: |:)/.test(l)&&!/^PASS \d+ .*scenarios/.test(l) && !/^PASS [\d/]+ HTTP ledger/.test(l) && !/^PASS \d+ (entry|exit) matrix cases/.test(l))
  results.push({suite,passed:result.code===0,durationMs:Date.now()-started,checks,log:file,...result})
  fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify({productionWrites:0,nodeVersion:process.version,nodeExecutable:process.execPath,suites:results},null,2))
  console.log(`${result.code===0?'PASS':'FAIL'} ${suite} (${checks.length} checkpoints)`)
  if(result.code!==0)console.log(log.split('\n').slice(-16).join('\n'))
 }
 const timelineFile=path.join(dir,'timeline.json'),timeline=fs.existsSync(timelineFile)?JSON.parse(fs.readFileSync(timelineFile,'utf8')):[]
 const failures=results.filter(r=>!r.passed)
 const entriesFile=path.join(dir,'entries-matrix.json')
 const entries=fs.existsSync(entriesFile)?JSON.parse(fs.readFileSync(entriesFile,'utf8')).rows:[]
 const lines=[entriesOnly?'# Raport acceptare intrari (+1)':exitsOnly?'# Raport acceptare iesiri (-1)':'# Raport acceptare ocupare','',`Rezultat: ${failures.length?'FAIL':'PASS'}`,`Suite: ${results.length-failures.length}/${results.length} trecute`,`Pași HTTP cu ocupare verificată: ${timeline.filter(s=>!s.settling).length}`,'','Exclusiv emulator local și proiecte demo. Autentificarea criptografică și transporturile comerciale sunt simulate.','Nu confirmă citirea camerelor fizice, livrarea Vercel sau corectitudinea istoricului de producție.','','| Scenariu / pas | Așteptat | API Ocupare | Contor | Rezultat |','|---|---:|---:|---:|---|',...timeline.map(s=>`| ${s.scenario} / ${s.step} | ${s.expected} | ${s.api} | ${s.counter} | ${s.settling?'RECOVERY (pending: '+s.pending+')':s.passed?'PASS':'FAIL'} |`),'','## Suite',...results.map(r=>`- ${r.passed?'PASS':'FAIL'} ${r.suite}: ${r.checks.length} checkpoints (${Math.round(r.durationMs/1000)}s)`)]
 for(const [kind,rows] of [['intrari',entries],['iesiri',fs.existsSync(path.join(dir,'exits-matrix.json'))?JSON.parse(fs.readFileSync(path.join(dir,'exits-matrix.json'),'utf8')).rows:[]]]) {
  if(!rows.length)continue
  lines.push('',`## Matrice ${kind}: efect pe pagina Ocupare`,'','Numaratoarea paginii si cache-ul intern sunt verificate separat.','',
   '| Flux / pas | Delta asteptata in pagina | Delta obtinuta | Delta cache intern | Rezultat |',
   '|---|---:|---:|---:|---|',...rows.map(r=>`| ${r.scenario} / ${r.step} | ${r.expectedDelta} | ${r.actualDelta??'?'} | ${r.cacheAfter===undefined?'?':r.cacheAfter-r.cacheBefore} | ${r.passed?'PASS':'FAIL'} |`),
   '',...[...new Set(rows.filter(r=>r.note).map(r=>r.note))].map(note=>`- ${note}`))
 }
 fs.writeFileSync(path.join(dir,'report.md'),lines.join('\n')+'\n');console.log(`REPORT ${path.join(dir,'report.md')}`)
 process.exitCode=failures.length?1:0
}
async function main(){
 if(process.argv[2]==='--child')return childRun(process.argv[3])
 if(process.env.FIRESTORE_EMULATOR_HOST)throw Error('Unset FIRESTORE_EMULATOR_HOST: this command starts its own disposable emulator')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'parking-occupancy-acceptance-'))
 const revision=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
 const sources=require('node:child_process').execFileSync('git',['diff','HEAD','--','app','lib','scripts'],{cwd:root})
 const fileList=require('node:child_process').execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z','--','app','lib','scripts','functions','package.json','package-lock.json'],{cwd:root,encoding:'utf8'}).split('\0').filter(f=>f && !f.includes('.env'))
 const sourceHashes=Object.fromEntries([...new Set(fileList)].sort().filter(f=>fs.existsSync(path.join(root,f))&&fs.statSync(path.join(root,f)).isFile()).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))
 fs.writeFileSync(path.join(dir,'source-hashes.json'),JSON.stringify(sourceHashes,null,2))
 fs.writeFileSync(path.join(dir,'source.json'),JSON.stringify({revision,nodeVersion:process.version,nodeExecutable:process.execPath,workingDiffSha256:createHash('sha256').update(sources).digest('hex'),startedAt:new Date().toISOString()},null,2))
 const ports=[];while(ports.length<4){const p=await port();if(!ports.includes(p))ports.push(p)}
 const config=path.join(dir,'firebase.json');fs.writeFileSync(config,JSON.stringify({emulators:{firestore:{host:'127.0.0.1',port:ports[0],websocketPort:ports[1]},hub:{host:'127.0.0.1',port:ports[2]},logging:{host:'127.0.0.1',port:ports[3]},ui:{enabled:false},singleProjectMode:false}}))
 // Don't pass application/production credentials or endpoint overrides to fixtures.
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','JAVA_HOME','SystemRoot'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
 env.FIREBASE_EMULATORS_PATH=process.env.FIREBASE_EMULATORS_PATH||path.join(os.tmpdir(),'parking-occupancy-emulator-cache')
 console.log('Raport și loguri: '+dir)
 const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'"
 const command=`${quote(process.execPath)} ${quote(__filename)} --child ${quote(dir)}${entriesOnly?' --entries':exitsOnly?' --exits':''}`
 const result=await run('firebase',['emulators:exec','--only','firestore','--project','demo-parking-acceptance','--config',config,command],{cwd:dir,env,stdio:'inherit',timeout:1800000})
 if(result.error)console.error('Firebase CLI required in PATH; Java required for emulator. '+result.error)
 process.exitCode=result.code
}
main().catch(e=>{console.error(e);process.exitCode=1})
