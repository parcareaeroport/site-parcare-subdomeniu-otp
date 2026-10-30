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

const {correctedCameraTime:correct, cameraClockOffsetSeconds:offset}=load('lib/lpr-camera-config.server.ts')
delete process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON
assert.equal(offset('intrare_1'),0)
process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON=JSON.stringify({intrare_1:3149,iesire_1:3206})
assert.equal(offset('intrare_1'),3149); assert.equal(offset('iesire_1'),3206)
assert.equal(offset('other'),0); assert.equal(offset('__proto__'),0)
let c=correct('2026-10-30 10:04:51.829','romania_wall_clock',offset('intrare_1'))
assert.equal(c.wall,'2026-10-30T09:12:22.829Z');assert.equal(c.instant,'2026-10-30T07:12:22.829Z')
assert.equal(c.originalWall,'2026-10-30T10:04:51.829Z')
assert.equal(correct('2026-10-30 10:11:06.468','romania_wall_clock',offset('iesire_1')).wall,'2026-10-30T09:17:40.468Z')
// No implicit use of receipt time, including old/queued events and day rollover.
assert.equal(correct('2026-07-16 00:20:00','romania_wall_clock',3600).wall,'2026-07-15T23:20:00.000Z')
assert.equal(correct('2026-07-16T10:00:00Z','instant',3600).instant,'2026-07-16T09:00:00.000Z')
assert.equal(correct('2026-07-16 10:00:00','romania_wall_clock',-60).wall,'2026-07-16T10:01:00.000Z')
assert.equal(correct('2026-10-25 04:30:00','romania_wall_clock',3600).instant,null)
assert.equal(correct('2026-03-29 04:30:00','romania_wall_clock',3600).instant,null)
assert.equal(correct('2026-10-25T02:30:00Z','instant',3600).instant,'2026-10-25T01:30:00.000Z')
for(const json of ['bad','null','[]','1']) {process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON=json;assert.equal(offset('intrare_1'),null)}
for(const value of ['3149',1.5,86401,null]) {process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON=JSON.stringify({intrare_1:value});assert.equal(offset('intrare_1'),null)}
assert.equal(correct('invalid','romania_wall_clock',3149).wall,null)
assert.equal(correct('2026-02-30 10:00:00','romania_wall_clock',3149).wall,null)
assert.equal(correct('2026-10-30 10:00:00','romania_wall_clock',null).wall,null)
const {isTrustedLprReceipt}=load('lib/lpr-entry-evidence.ts')
assert.equal(isTrustedLprReceipt({associationStatus:'needs_review',associationReason:'invalid_clock_offset_config'}),false)
delete process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON
console.log('PASS: clock offset configuration, per-device correction, original timestamps, timezone/DST, invalid dates and invalid configuration')
