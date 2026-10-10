/** Isolated browser test of the production dialog + real handlers with in-memory Firestore/Multipark.
 * No production credentials are loaded; no real cancellations or emails are sent.
 * Run: node scripts/test-cancel-preview-browser.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const mobileRequire = createRequire(path.join(root, '../expo-mobile-app/package.json'));
const { chromium } = mobileRequire('@playwright/test');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'parking-cancel-preview-'));
const screenshots = path.join(temp, 'screenshots');
fs.mkdirSync(screenshots);
function write(file, content) {
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
write('package.json', JSON.stringify({ name: 'parking-cancel-preview-test', private: true }));
write('tsconfig.json', JSON.stringify({ compilerOptions: { jsx: 'preserve', moduleResolution: 'bundler', module: 'esnext', target: 'es2020', esModuleInterop: true, paths: { '@/*': [root + '/*'] } }, include: ['**/*.tsx', '**/*.ts'] }));
write('next.config.mjs', `export default { experimental: { externalDir: true }, devIndicators: false, webpack(config) { config.resolve.alias['@'] = ${JSON.stringify(root)}; config.externals.push(({request}, callback) => request?.endsWith('booking-loyalty-fixture.cjs') ? callback(null, 'commonjs ' + request) : callback()); return config; } };`);
write('postcss.config.js', 'module.exports = {plugins: {tailwindcss:{}}};');
const tailwindSource = fs.readFileSync(path.join(root, 'tailwind.config.ts'), 'utf8');
write('tailwind.config.ts', tailwindSource.replace('  content: [', `  content: [${JSON.stringify(root + '/components/**/*.{ts,tsx}')},`));
write('app/globals.css', fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8'));
write('app/layout.tsx', `import './globals.css'; export default function Layout({children}) {return <html lang="ro"><body>{children}</body></html>}`);
write('app/page.tsx', `"use client"
import {useCallback,useState} from 'react';
import {BookingCancellationDialog} from '@/components/admin/booking-cancellation-dialog';
import {formatCancellationLoyaltyResult} from '@/lib/booking-cancellation-types';
export default function Page(){
 const [open,setOpen]=useState(false),[scenario,setScenario]=useState('standard'),[message,setMessage]=useState('');
 const request=useCallback((url,init={})=>fetch(url,{...init,headers:{'Content-Type':'application/json','x-test-scenario':scenario,...init.headers}}),[scenario]);
 return <main className="p-8"><h1 className="mb-6 text-xl font-bold">Rezervări — verificare locală</h1>
 <div className="flex flex-wrap gap-3">{['standard','no-award','debt','returned','ambiguous','unknown','preview-error','rejected','slow'].map(value=><button className="rounded border px-4 py-2" key={value} onClick={()=>{setScenario(value);setMessage('');setOpen(true)}}>{value}</button>)}</div>
 <div role="status" className="mt-6 rounded bg-green-50 p-4">{message}</div>
 {open&&<BookingCancellationDialog key={scenario} open={open} onOpenChange={setOpen} booking={{id:'b',apiBookingNumber:'TEST-123',licensePlate:'B1TEST',clientEmail:'ion@example.test'}} request={request} onCancelled={result=>setMessage(formatCancellationLoyaltyResult(result.loyalty))}/>}</main>
}`);
write('app/api/[...segments]/route.ts', `
import {NextResponse} from 'next/server';
import {createRequire} from 'node:module';
const requireFixture=createRequire(${JSON.stringify(path.join(root, 'package.json'))});
const {fixture}=requireFixture(${JSON.stringify(path.join(root, 'scripts/booking-loyalty-fixture.cjs'))});
const testGlobal=globalThis as any;
const state=testGlobal.__parkingPreviewTest ||= new Map();
export const dynamic='force-dynamic';
function getFixture(scenario){
 if(state.has(scenario))return state.get(scenario);
 let overrides:any={clientName:'Ion Popescu'},opts:any={};
 if(scenario==='no-award')overrides.loyaltyRecord={profileCollection:'users',userId:'u',pointsAwarded:0,freeDaysUsed:0};
 if(scenario==='debt')opts.rows={'users/u':{loyalty:{points:4,reservationsCount:0,freeDaysAvailable:0}}};
 if(scenario==='returned'){overrides.loyaltyRecord={profileCollection:'users',userId:'u',pointsAwarded:1,freeDaysUsed:1,reservationsPerFreeDay:4};opts.rows={'users/u':{loyalty:{points:5,reservationsCount:1,freeDaysAvailable:0}}};}
 if(scenario==='ambiguous'){overrides.loyaltyRecord=undefined;opts.rows={'guests/u':{loyalty:{points:4}}};}
 if(scenario==='rejected')opts.failMultipark=true;
 const f=fixture(overrides,opts);
 if(scenario==='unknown')f.db.failMarkerWrite=true;
 const entry={f,previews:0};state.set(scenario,entry);return entry;
}
async function handle(req:Request){
 const url=new URL(req.url),scenario=req.headers.get('x-test-scenario')||'standard';
 const entry=getFixture(scenario),{f}=entry;
 if(url.pathname==='/api/test/balance'){
  const {points}=await req.json();await f.db.runTransaction(async tx=>tx.update(f.db.collection('users').doc('u'),{loyalty:{points,reservationsCount:1,freeDaysAvailable:1}}));return NextResponse.json({ok:true});
 }
 if(url.pathname==='/api/test/allow-preview'){entry.previewRecovered=true;return NextResponse.json({ok:true});}
 if(url.pathname==='/api/test/state')return NextResponse.json({booking:f.db.row('bookings/b'),profile:f.db.row('users/u'),calls:f.calls(),writes:f.db.writeCount});
 let result;
 if(url.pathname.endsWith('cancel-preview')){
  entry.previews++;
  if(scenario==='preview-error'&&!entry.previewRecovered)return NextResponse.json({error:'Eroare simulată la citirea punctelor.'},{status:503});
  if(scenario==='slow')await new Promise(r=>setTimeout(r,800));
  result=await f.previewRoute(req);
 }else if(url.pathname.endsWith('/cancel')){await new Promise(r=>setTimeout(r,150));result=await f.cancelRoute(req);}
 else return NextResponse.json({error:'Unknown test route'},{status:404});
 return NextResponse.json(result.body,{status:result.status,headers:result.headers});
}
export const GET=handle;export const POST=handle;
`);
(async () => {
  const net = require('node:net');
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const log = fs.openSync(path.join(temp, 'server.log'), 'a');
  const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: temp, env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', log, log],
  });
  let browser;
  const failures = [];
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null) throw Error('Test server exited; see ' + temp);
      let response;
      try { response = await fetch(base, {signal: AbortSignal.timeout(30000)}); } catch {}
      if (response?.ok) { ready = true; break; }
      if (response?.status >= 500) throw Error('Test server compilation failed; see ' + temp + '/server.log');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'test server started');
    browser = await chromium.launch({ headless: true, ...(fs.existsSync('/Applications/Google Chrome.app') ? { channel: 'chrome' } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(base);
    const { expect } = mobileRequire('@playwright/test');
    const dialog = page.getByRole('alertdialog');
    const confirm = dialog.getByRole('button', { name: 'Anulează', exact: true });
    async function scenario(name) { await page.getByRole('button', { name, exact: true }).click(); await expect(dialog).toBeVisible(); }
    async function leave() { await dialog.getByRole('button', { name: 'Renunță' }).click(); await expect(dialog).toHaveCount(0); }
    await scenario('standard');
    await expect(dialog).toContainText('Ion Popescu are 4 puncte. După anularea acestei rezervări va avea 3 puncte.');
    await expect(dialog).toContainText('Zile gratuite disponibile: 1 → 0');
    await expect(confirm).toBeEnabled();
    await page.screenshot({ path: path.join(screenshots, 'before-cancellation.png') });
    const untouched = await (await page.request.get(base + '/api/test/state')).json();
    assert.equal(untouched.writes, 0);
    await page.request.post(base + '/api/test/balance', { data: { points: 5 } });
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Ion Popescu: 5 → 4 puncte.');
    const applied = await (await page.request.get(base + '/api/test/state')).json();
    assert.equal(applied.profile.loyalty.points, 4);
    await page.screenshot({ path: path.join(screenshots, 'actual-result.png') });
    await scenario('no-award');
    await expect(dialog).toContainText('va avea 4 puncte');
    await expect(dialog).toContainText('Soldul de puncte nu scade');
    await leave();
    await scenario('debt');
    await expect(dialog).toContainText('Se va recupera 1 punct din rezervările viitoare.');
    await leave();
    await scenario('returned');
    await expect(dialog).toContainText('Ziua gratuită folosită pentru această rezervare va fi returnată');
    await expect(dialog).toContainText('Zile gratuite disponibile: 0 → 1');
    await leave();
    await scenario('ambiguous');
    await expect(dialog).toContainText('Punctele necesită verificare manuală');
    await expect(dialog).not.toContainText('va avea');
    await leave();
    await scenario('preview-error');
    await expect(dialog).toContainText('Verificarea punctelor a eșuat');
    await expect(confirm).toBeDisabled();
    await page.request.post(base + '/api/test/allow-preview', { headers: { 'x-test-scenario': 'preview-error' } });
    await dialog.getByRole('button', { name: 'Reîncearcă' }).click();
    await expect(confirm).toBeEnabled();
    await leave();
    await scenario('rejected');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toContainText('Multipark failed');
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeEnabled();
    await leave();
    await scenario('unknown');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toContainText('Anularea necesită verificare');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button', { name: 'Reverifică' }).click();
    await expect(dialog).toContainText('Anularea necesită verificare');
    const unknown = await (await page.request.get(base + '/api/test/state', { headers: { 'x-test-scenario': 'unknown' } })).json();
    assert.equal(unknown.calls, 1);
    await page.screenshot({ path: path.join(screenshots, 'uncertain-result.png') });
    await leave();
    await scenario('slow');
    await expect(dialog).toContainText('Se verifică punctele clientului');
    await expect(confirm).toBeDisabled();
    await expect(confirm).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(screenshots, 'mobile-width.png') });
    const box = await dialog.boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= 391, 'dialog fits narrow screen');
    await leave();
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ success: true, scenarios: 9, screenshots, data: 'in-memory only', browserErrors: failures }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    fs.closeSync(log);
    console.log('Test artifacts: ' + temp);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
