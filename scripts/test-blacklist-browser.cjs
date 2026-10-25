/** Real admin UI and handlers, isolated in a temporary Next app with in-memory Firestore.
 * No production credentials, database writes, payment calls or deployments.
 * Run: node scripts/test-blacklist-browser.cjs
 * Or use installed Chrome: PLAYWRIGHT_CHANNEL=chrome node scripts/test-blacklist-browser.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const { chromium, expect } = createRequire(path.join(root, '../expo-mobile-app/package.json'))('@playwright/test');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parking-blacklist-'));
function write(file, content) {
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, content);
}
fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
fs.symlinkSync(path.join(root, 'public'), path.join(temp, 'public'), 'dir');
write('package.json', JSON.stringify({ name: 'parking-blacklist-test', private: true }));
write('tsconfig.json', JSON.stringify({compilerOptions:{jsx:'preserve',moduleResolution:'bundler',module:'esnext',target:'es2020',esModuleInterop:true,paths:{'@/*':[root+'/*']}},include:['**/*.tsx','**/*.ts']}));
write('next.config.mjs', `export default {experimental:{externalDir:true},devIndicators:false,webpack(config){
 config.resolve.alias['@/context/auth-context$']=${JSON.stringify(path.join(temp, 'auth.tsx'))};
 config.resolve.alias['@']=${JSON.stringify(root)};
 config.externals.push(({request},callback)=>request?.endsWith('blacklist-fixture.cjs')?callback(null,'commonjs '+request):callback());
 return config;
}};`);
write('auth.tsx', `"use client";
const user={uid:'test-admin',email:'admin@example.test',getIdToken:async()=> 'fixture-token'};
export const useAuth=()=>({user,loading:false,role:'admin',isAdmin:true,defaultRoute:'/admin/dashboard',signOut:async()=>{}});
export const AuthProvider=({children})=>children;`);
write('postcss.config.js','module.exports={plugins:{tailwindcss:{}}};');
write('tailwind.config.ts', fs.readFileSync(path.join(root, 'tailwind.config.ts'),'utf8').replace('  content: [',`  content: [${JSON.stringify(root+'/app/admin/**/*.tsx')},${JSON.stringify(root+'/components/**/*.tsx')},`));
write('app/globals.css',fs.readFileSync(path.join(root,'app/globals.css'),'utf8'));
write('app/layout.tsx',`import './globals.css';import {Toaster} from '@/components/ui/toaster';export default function Layout({children}){return <html lang="ro"><body>{children}<Toaster/></body></html>}`);
write('app/admin/layout.tsx',`export {default} from ${JSON.stringify(path.join(root,'app/admin/layout.tsx'))};`);
write('app/admin/dashboard/blacklist/page.tsx',`export {default} from ${JSON.stringify(path.join(root,'app/admin/dashboard/blacklist/page.tsx'))};`);
write('app/api/[...segments]/route.ts',`
import {NextResponse} from 'next/server';
import {createRequire} from 'node:module';
const requireFixture=createRequire(${JSON.stringify(path.join(root,'package.json'))});
const {fixture}=requireFixture(${JSON.stringify(path.join(root,'scripts/blacklist-fixture.cjs'))});
const state=(globalThis as any).__blacklistBrowserState ||= {fixture:fixture(),failList:false};
export const dynamic='force-dynamic';
async function handle(request:Request){
 const pathname=new URL(request.url).pathname;
 if(pathname==='/api/test/check'){
  const result=await state.fixture.helper.getMobileBookingBlacklistRejection(await request.json());
  return NextResponse.json(result?.body||{success:true}, {status:result?.status||200});
 }
 if(pathname==='/api/test/fail-next-list'){state.failList=true;return NextResponse.json({success:true});}
 if(pathname==='/api/admin/blacklist'){
  if(request.headers.get('authorization')!=='Bearer fixture-token')return NextResponse.json({}, {status:401});
  if(request.method==='GET'&&state.failList){state.failList=false;return NextResponse.json({}, {status:503});}
  const result=await state.fixture.api[request.method](request);
  return NextResponse.json(result.body,{status:result.status});
 }
 return NextResponse.json({}, {status:404});
}
export const GET=handle;export const POST=handle;export const DELETE=handle;
`);

(async () => {
  const log = fs.openSync(path.join(temp,'server.log'),'w');
  const server = spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev','--port','3138'],{cwd:temp,stdio:['ignore',log,log]});
  let browser;
  try {
    const base='http://localhost:3138', url=base+'/admin/dashboard/blacklist';
    for(let attempt=0;attempt<90;attempt++){
      try {const response=await fetch(url);if(response.ok)break;} catch {}
      if(attempt===89)throw new Error('Fixture server did not start; see '+temp+'/server.log');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url);
    await expect(page.getByText('Nu există clienți blocați.')).toBeVisible();
    await expect(page.getByRole('link',{name:'Clienți blocați'})).toBeVisible();
    const fill=async()=>{
      await page.getByLabel('Nume persoană',{exact:true}).fill('Ion Popescu');
      await page.getByLabel('Email',{exact:true}).fill('CLIENT@EXAMPLE.TEST');
      await page.getByLabel('Număr înmatriculare',{exact:true}).fill('b-123 abc');
    };
    await fill();
    await page.getByRole('button',{name:'Adaugă',exact:true}).click();
    await expect(page.getByRole('cell',{name:'client@example.test',exact:true})).toBeVisible();
    await expect(page.getByRole('cell',{name:'B123ABC',exact:true})).toBeVisible();
    await page.screenshot({path:path.join(temp,'desktop.png'),fullPage:true});
    for(const input of [{licensePlate:'B123ABC',emails:['other@example.test']},{licensePlate:'OTHER',emails:['client@example.test']}]){
      const response=await page.request.post(base+'/api/test/check',{data:input});
      assert.equal(response.status(),409);
      assert.equal((await response.json()).code,'MOBILE_BOOKING_BLOCKED');
    }
    await fill();
    await page.getByRole('button',{name:'Adaugă',exact:true}).click();
    await expect(page.getByText('Acest email și număr de înmatriculare sunt deja în listă.',{exact:true})).toBeVisible();
    assert.equal(await page.getByRole('row').count(),2);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(temp,'mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'page fits narrow viewport');
    const inputBox=await page.getByLabel('Nume persoană',{exact:true}).boundingBox();
    assert.ok(inputBox.x>=0&&inputBox.x+inputBox.width<=390,'form fits narrow viewport');
    await page.getByRole('button',{name:'Șterge Ion Popescu (B123ABC)',exact:true}).click();
    await expect(page.getByText('Nu există clienți blocați.')).toBeVisible();
    assert.equal((await page.request.post(base+'/api/test/check',{data:{licensePlate:'B123ABC',emails:['client@example.test']}})).status(),200);
    await page.request.post(base+'/api/test/fail-next-list');
    await page.reload();
    await expect(page.getByRole('alert').filter({hasText:'Nu s-a putut încărca'})).toBeVisible();
    await page.getByRole('button',{name:'Încearcă din nou',exact:true}).click();
    await expect(page.getByText('Nu există clienți blocați.')).toBeVisible();
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({success:true,scenarios:8,viewports:[1440,390],screenshots:temp,data:'in-memory only',browserErrors:errors},null,2));
  } finally {
    if(browser)await browser.close();
    server.kill('SIGTERM');
    fs.closeSync(log);
    console.log('Test artifacts: '+temp);
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
