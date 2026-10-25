// Actual UI → actual API → actual snapshot loader, with in-memory Firestore/auth fixtures only.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const {spawn} = require('node:child_process'), {createRequire} = require('node:module')
const root = path.resolve(__dirname,'..')
const {chromium,expect} = createRequire(path.join(root,'../expo-mobile-app/package.json'))('@playwright/test')
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'forecast-browser-'))
function write(file,content){fs.mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});fs.writeFileSync(path.join(temp,file),content)}
fs.symlinkSync(root+'/node_modules',temp+'/node_modules','dir')
write('package.json','{"private":true}')
write('tsconfig.json',JSON.stringify({compilerOptions:{jsx:'preserve',module:'esnext',moduleResolution:'bundler',target:'es2020',esModuleInterop:true,paths:{'@/*':[root+'/*']}}}))
write('next.config.mjs',`export default {devIndicators:false,experimental:{externalDir:true},webpack(c){c.resolve.alias['@/context/auth-context$']=${JSON.stringify(temp+'/auth.tsx')};c.resolve.alias['@/lib/firebase-admin$']=${JSON.stringify(temp+'/db.ts')};c.resolve.alias['@']=${JSON.stringify(root)};return c}}`)
write('auth.tsx',`'use client';const user={uid:'fixture',getIdToken:async()=> 'fixture'};export const useAuth=()=>({user});`)
write('db.ts',`
const base={status:'confirmed_paid',licensePlate:'B1TEST',startDate:'2030-03-30',startTime:'00:00',endDate:'2030-03-31',endTime:'00:00'};
const rows=Array.from({length:30},(_,i)=>({id:'booking-'+String(i).padStart(2,'0'),booking:{...base,licensePlate:'B'+i+'TEST'}}));
rows.push({id:'late',booking:{...base,endDate:'2020-03-20',lpr:{isInside:true}}});
rows.push({id:'raw',booking:{...base,status:'unmatched_lpr',lpr:{isInside:true,lastEventType:'exit'}}});
rows.push({id:'pay',booking:{...base,status:'confirmed_pay_on_site'}});
rows.push({id:'cancelled',booking:{...base,status:'cancelled'}});
export const adminAuth={verifyIdToken:async(token)=>{if(token!=='fixture')throw Error('invalid');return {uid:'fixture',role:'admin',email:'fixture@example.invalid'}}};
export const adminDb={collection(name) {
  if(name==='config') return {doc:()=>({get:async()=>({data:()=>({maxTotalReservations:100})})})};
  return {select:()=>({get:async()=>({docs:rows.map(row=>({id:row.id,data:()=>row.booking}))})})};
}};

`)
write('app/page.tsx',`import {OccupancyForecast} from '${root}/components/admin/occupancy-forecast';export default function Page(){return <main className="p-4 min-w-0"><OccupancyForecast/></main>}`)
write('app/api/admin/occupancy-forecast/route.ts',`export {POST} from '${root}/app/api/admin/occupancy-forecast/route';export const dynamic='force-dynamic';export const runtime='nodejs';`)
write('app/layout.tsx',`import './globals.css';export default function Layout({children}){return <html lang="ro"><body>{children}</body></html>}`)
write('app/globals.css',fs.readFileSync(root+'/app/globals.css','utf8'))
write('postcss.config.js','module.exports={plugins:{tailwindcss:{}}};')
write('tailwind.config.ts',fs.readFileSync(root+'/tailwind.config.ts','utf8').replace('  content: [',`  content: [${JSON.stringify(root+'/components/**/*.tsx')},`))
let server,browser,logs=''
;(async()=>{
  server=spawn(process.execPath,[root+'/node_modules/next/dist/bin/next','dev','-p','3187'],{cwd:temp,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']})
  server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x)
  await new Promise((resolve,reject)=>{const deadline=Date.now()+60000;const timer=setInterval(()=>{if(logs.includes('Ready in')){clearInterval(timer);resolve()}else if(Date.now()>deadline||server.exitCode!==null){clearInterval(timer);reject(Error(logs))}},200)})
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true})
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  let requests=0
  page.on('request',r=>{if(r.url().endsWith('/api/admin/occupancy-forecast'))requests++})
  await page.route(/googleapis\.com|firebaseio\.com/,r=>{errors.push('External Firebase request');return r.abort()})
  await page.goto('http://localhost:3187')
  await expect(page.getByText('Rezultatul simulatorului',{exact:true})).toBeVisible({timeout:60000})
  await page.getByLabel('Prima zi',{exact:true}).fill('2030-03-30')
  await page.getByLabel('Ultima zi',{exact:true}).fill('2030-03-30')
  await page.getByLabel('Data intrării',{exact:true}).fill('2030-03-30')
  await page.getByLabel('Data ieșirii',{exact:true}).fill('2030-03-31')
  await page.getByLabel('Ora intrării',{exact:true}).fill('00:00')
  await page.getByLabel('Ora ieșirii',{exact:true}).fill('00:00')
  await expect(page.getByText(/Formular modificat/)).toBeVisible()
  const api=page.waitForResponse(r=>r.url().endsWith('/api/admin/occupancy-forecast')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Recalculează',exact:true}).click()
  const result=await api;assert.equal(result.status(),200);assert.equal(result.headers()['cache-control'],'no-store')
  const body=await result.json();assert.equal(body.simulator.conflictingBookings,30);assert.equal(body.simulator.totalSpots,98);assert.equal(body.days.length,1)
  await expect(page.getByText(/Formular modificat/)).toHaveCount(0)
  await expect(page.getByRole('row')).toHaveCount(4)
  await page.screenshot({path:'/tmp/parking-forecast-desktop.png',fullPage:true})
  const count=requests
  await page.getByRole('button',{name:/Explicație/}).first().click()
  const dialog=page.getByRole('dialog')
  await expect(dialog).toContainText('30 + 1 ≤ 98')
  await expect(dialog.getByRole('listitem')).toHaveCount(25)
  await dialog.getByRole('button',{name:'Pagina următoare',exact:true}).click()
  await expect(dialog.getByRole('listitem')).toHaveCount(5)
  await dialog.getByLabel('Caută număr sau ID rezervare').fill('booking-29')
  await expect(dialog.getByRole('listitem')).toHaveCount(1)
  await expect(dialog).toContainText('B29TEST')
  await dialog.getByLabel('Caută număr sau ID rezervare').fill('')
  await dialog.getByRole('button',{name:'Fără rezervare (1)',exact:true}).click()
  await expect(dialog).toContainText('Date LPR contradictorii')
  await dialog.getByRole('button',{name:/Excluse din termeni/}).click()
  await expect(dialog).toContainText('Plată la parcare')
  assert.equal(requests,count,'Opening/searching/paging details must not read data again')
  await page.screenshot({path:'/tmp/parking-forecast-details-desktop.png',fullPage:true})
  await page.setViewportSize({width:390,height:844})
  await expect(dialog).toBeVisible()
  await expect.poll(async()=>{
    const box=await dialog.boundingBox()
    return box.x>=0&&box.x+box.width<=391&&box.y>=0&&box.y+box.height<=845
  },{message:'Dialog fits narrow viewport'}).toBe(true)
  await page.screenshot({path:'/tmp/parking-forecast-details-mobile.png',fullPage:false})
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Only tables should scroll horizontally')
  await page.screenshot({path:'/tmp/parking-forecast-mobile.png',fullPage:true})
  await page.route('**/api/admin/occupancy-forecast',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Calcul indisponibil'})}))
  await page.getByRole('button',{name:'Recalculează',exact:true}).click()
  await expect(page.getByRole('alert').filter({hasText:'Calcul indisponibil'})).toContainText('Calcul indisponibil')
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.unroute('**/api/admin/occupancy-forecast')
  await page.getByRole('button',{name:'Recalculează',exact:true}).click()
  await expect(page.getByRole('table')).toHaveCount(2)
  let pendingResolve
  const pending=new Promise(resolve=>{pendingResolve=resolve})
  let releaseResolve
  const release=new Promise(resolve=>{releaseResolve=resolve})
  await page.route('**/api/admin/occupancy-forecast',async route=>{
    const response=await route.fetch()
    pendingResolve()
    await release
    await route.fulfill({response})
  })
  await page.getByRole('button',{name:'Recalculează',exact:true}).click()
  await pending
  await page.getByLabel('Ora intrării',{exact:true}).fill('01:00')
  releaseResolve()
  await expect(page.getByText(/Formular modificat/)).toBeVisible()
  await expect(page.getByRole('table').first()).toContainText('2030-03-30 00:00')
  await page.unroute('**/api/admin/occupancy-forecast')
  await page.getByRole('button',{name:'Recalculează',exact:true}).click()
  await expect(page.getByText(/Formular modificat/)).toHaveCount(0)
  await expect(page.getByRole('table').first()).toContainText('2030-03-30 01:00')
  assert.deepEqual(errors,[])
  console.log('PASS desktop 1440px + mobile 390px; actual API/reader/calculation; totals, simulator, dirty state, dialog, search, pagination, no reads on i, 503 clears results, retry, no runtime errors or external Firebase calls')
})().catch(e=>{console.error(e);console.error(logs.slice(-6000));process.exitCode=1}).finally(async()=>{await browser?.close();server?.kill('SIGTERM')})
