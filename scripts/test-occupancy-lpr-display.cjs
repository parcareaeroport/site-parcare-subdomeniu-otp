const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file) {
  const filename = path.resolve(__dirname, '../lib', file + '.ts')
  const mod = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  new Function('require', 'module', 'exports', js)(name => name === './lpr-presence' ? load('lpr-presence') : require(name), mod, mod.exports)
  return mod.exports
}
const { occupancyLprTimestamp: timestamp, formatOccupancyLprTime: format, occupancyEventOutsidePeriod: outside, occupancyEventLabel: label } = load('occupancy-lpr-display')
const plate = { startDate: '2026-05-22', startTime: '16:30', endDate: '2026-05-28', endTime: '01:40' }
const event = iso => ({ ...plate, lpr: { lastSeenAt: iso } })
assert.equal(outside(event('2026-07-16T11:10:35.713Z')), true) // B804CTN
assert.equal(outside(event('2026-05-24T10:00:00Z')), false)
assert.equal(outside(event('2026-05-22T13:30:00Z')), false) // exact start, UTC+3
assert.equal(outside(event('2026-05-27T22:40:00Z')), false) // exact end
assert.equal(outside(event('2026-05-22T13:29:59Z')), true)
assert.equal(outside(event('2026-05-27T22:40:01Z')), true)
assert.equal(outside(event('bad')), false)
assert.equal(outside({ ...event('2026-07-16T11:00:00Z'), endDate: null }), false)
assert.equal(outside({ ...event('2026-07-16T11:00:00Z'), startDate: '2026-02-30' }), false)
assert.equal(format('2026-07-16T11:10:35Z'), '16.07.2026, 14:10:35')
assert.equal(format('2026-10-25T00:30:00Z'), '25.10.2026, 03:30:00')
assert.equal(format('2026-10-25T01:30:00Z'), '25.10.2026, 03:30:00') // DST fallback
assert.equal(format('bad'), 'Necunoscut')
assert.equal(format(null), 'Necunoscut')
assert.equal(timestamp(undefined), undefined)
assert.equal(timestamp('bad'), null)
assert.equal(timestamp('2026-07-16 11:10:35'), null) // no timezone assumption
assert.equal(timestamp({ seconds: 0 }), '1970-01-01T00:00:00.000Z')
assert.equal(timestamp({ toDate: () => new Date('2026-05-22T13:30:00Z') }), '2026-05-22T13:30:00.000Z')
assert.equal(label('entry'), 'Intrare')
assert.equal(label('exit'), 'Ieșire')
assert.equal(label('other'), 'Necunoscut')
console.log('22 occupancy LPR display checks passed')
