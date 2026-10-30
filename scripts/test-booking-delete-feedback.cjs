// Execute the component's actual save handler; synthetic responses only.
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), assert = require('node:assert/strict')
const source = fs.readFileSync(path.join(__dirname, '../components/admin/booking-deletion-dialog.tsx'), 'utf8')
const ast = ts.createSourceFile('dialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handler
function walk(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'save') handler = n.initializer.getText(ast)
  ts.forEachChild(n, walk)
}
walk(ast)
assert.ok(handler)
const body = ts.transpileModule('const handler = ' + handler, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
async function run(response, overrides = {}) {
  let error = '', saving = false, conflict = false, completed = false, closed = false, refreshed = false, calls = 0
  const deps = {
    context: { version: 'v1', inside: true, blockedReason: null }, confirmed: true, conflict: false, completed: false,
    inFlight: { current: false }, requestId: { current: 'same-retry-key' }, bookingId: 'fixture',
    setSaving: v => saving = v, setError: v => error = v, setConflict: v => conflict = v, setCompleted: v => completed = v,
    request: async input => {
      calls++; assert.equal(input.requestId, 'same-retry-key'); assert.equal(input.confirmNotPresent, true)
      if (response instanceof Error) throw response
      return response
    },
    onDeleted: async () => { refreshed = true }, onClose: () => closed = true, ...overrides,
  }
  const fn = new Function(...Object.keys(deps), body + ';return handler')(...Object.values(deps))
  await fn()
  return { error, saving, conflict, completed, closed, refreshed, calls }
}
async function main() {
  for (const [code, message] of [['DELETE_REQUIRES_REVIEW', 'Necesită verificare ADMIN'], ['CONTEXT_CHANGED', 'Datele s-au schimbat.']]) {
    const r = await run({ ok: false, json: async () => ({ code, error: message }) })
    assert.equal(r.error, message); assert.equal(r.closed, false); assert.equal(r.refreshed, false); assert.equal(r.conflict, true); assert.equal(r.saving, false)
  }
  const network = await run(new Error('Conexiune întreruptă'))
  assert.equal(network.closed, false); assert.equal(network.error, 'Conexiune întreruptă'); assert.equal(network.conflict, false)
  const ok = { ok: true, json: async () => ({ success: true }) }
  const success = await run(ok)
  assert.equal(success.closed, true); assert.equal(success.completed, true); assert.equal(success.refreshed, true)
  for (const overrides of [{ confirmed: false }, { context: { inside: true, blockedReason: 'ADMIN' } }, { inFlight: { current: true } }, { conflict: true }, { completed: true }]) {
    assert.equal((await run(ok, overrides)).calls, 0)
  }
  const refreshFailure = await run(ok, { onDeleted: async () => { throw Error('refresh failed') } })
  assert.equal(refreshFailure.completed, true); assert.equal(refreshFailure.closed, false); assert.match(refreshFailure.error, /a fost ștearsă/)
  assert.ok(source.includes('role="alert"'))
  assert.ok(source.includes('Confirm că mașina nu mai este fizic în parcare.'))
  assert.ok(source.includes('Scoate din evidență și șterge'))
  assert.ok(!source.includes('AlertDialogAction'))
  console.log('PASS booking delete dialog: confirmations, conflicts, network retry, completed state and error visibility')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
