// Route regression tests: no network, Firebase, or production credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
const calls = []
let result = { savedEventId: 'fixture' }, fail = false
function load(relative) {
  const filename = path.resolve(root, relative)
  const mod = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  new Function('require','module','exports',js)(name => {
    if (name === 'server-only') return {}
    if (name === '@/lib/lpr-service') return { handleLprEvent: async input => { calls.push(input); if (fail) throw Error('fixture failure'); return result } }
    if (name.startsWith('@/')) return load(name.slice(2)+'.ts')
    if (name.startsWith('.')) return load(path.relative(root,path.resolve(path.dirname(filename),name))+'.ts')
    return require(name)
  },mod,mod.exports)
  return mod.exports
}
const { POST, GET } = load('app/NotificationInfo/TollgateInfo/route.ts')
const { NextRequest } = require('next/server')
function post(device, direction, raw) {
  return POST(new NextRequest('http://localhost/NotificationInfo/TollgateInfo', { method:'POST', body:raw ?? JSON.stringify({Picture:{Plate:{PlateNumber:'TEST01'},SnapInfo:{DeviceID:device,Direction:direction,AccurateTime:'2026-10-30T08:00:00Z'}}}) }))
}
async function main() {
  delete process.env.LPR_AUTH_SECRET; delete process.env.LPR_DEVICES_JSON
  for (const device of ['intrare_1','iesire_1']) {
    assert.equal((await post(device)).status,200)
    assert.equal(calls.at(-1).deviceId,device)
    assert.equal(calls.at(-1).timestampMode,'romania_wall_clock')
  }
  assert.equal((await post('camera-custom','exit')).status,200)
  assert.equal(calls.at(-1).direction,'exit')
  process.env.LPR_AUTH_SECRET='unused-fixture'
  process.env.LPR_DEVICES_JSON='{invalid'
  assert.equal((await post('intrare_1')).status,200)
  process.env.LPR_DEVICES_JSON=JSON.stringify({known:{direction:'entry',timestampMode:'instant'}})
  assert.equal((await post('unknown','exit')).status,200)
  assert.equal(calls.at(-1).direction,'exit')
  assert.equal((await post('known','exit')).status,200)
  assert.equal(calls.at(-1).direction,'entry')
  assert.equal(calls.at(-1).timestampMode,'instant')
  const count=calls.length
  assert.equal((await post(null,null,'{broken')).status,400)
  assert.equal(calls.length,count)
  result={degraded:true,savedEventId:'degraded_no_persist'}
  assert.equal((await post('intrare_1')).status,503)
  result={degraded:true,savedEventId:'saved-pending'}
  assert.equal((await (await post('intrare_1')).json()).status,'pending')
  fail=true
  assert.equal((await post('intrare_1')).status,503)
  assert.equal((await GET()).status,405)
  console.log('PASS: 11 camera route compatibility and error-handling scenarios')
}
main().catch(e=>{console.error(e);process.exitCode=1})
