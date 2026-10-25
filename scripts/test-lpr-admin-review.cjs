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
  new Function('require', 'module', 'exports', js)(name => name.startsWith('./') ? load(name.slice(2)) : require(name), mod, mod.exports)
  return mod.exports
}
const { lprAdminReviewReason: review, LPR_ADMIN_REVIEW_LABEL } = load('lpr-admin-review')
const base = {
  startDate: '2026-05-22', startTime: '16:30', endDate: '2026-05-28', endTime: '01:40',
  lpr: { isInside: true, lastEventType: 'entry', arrivedAt: '2026-05-22T16:15:00Z', lastSeenAt: '2026-05-22T16:15:00Z' },
}
// Legitimate overdue stay: no review just because the scheduled departure was months ago.
assert.equal(review(base), undefined)
const stale = { ...base, lpr: { ...base.lpr, departedAt: '2026-05-28T01:25:00Z', lastSeenAt: '2026-07-16T11:10:00Z' } }
assert.match(review(stale), /după ieșirea/)
assert.match(review({ ...base, lpr: { ...base.lpr, lastSeenAt: '2026-07-16T11:10:00Z' } }), /în afara perioadei/)
assert.equal(review({ ...stale, lpr: { ...stale.lpr, isInside: false } }), undefined)
assert.equal(review({ ...stale, lpr: { ...stale.lpr, lastEventType: 'exit' } }), undefined)
assert.equal(review({ ...base, lpr: { ...base.lpr, lastSeenAt: '2026-05-22T14:30:00Z' } }), undefined)
assert.match(review({ ...base, lpr: { ...base.lpr, lastSeenAt: '2026-05-22T14:29:59Z' } }), /în afara perioadei/)
assert.equal(review({ ...base, lpr: { ...base.lpr, arrivedAt: 'invalid', lastSeenAt: 'invalid' } }), undefined)
assert.equal(review({ ...base, startDate: '2026-02-30' }), undefined)
assert.equal(LPR_ADMIN_REVIEW_LABEL, 'Necesită verificare ADMIN')
console.log('10 LPR admin review checks passed')
