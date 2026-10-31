// End-to-end local HTTP matrix for every application entry writer and its no-op paths.
// Cryptographic identity and commercial transport are fixtures; routes and Firestore are real.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const projectId = 'demo-parking-entry-matrix', app = initializeApp({ projectId }, 'entry-matrix'), db = getFirestore(app)
const root = path.resolve(__dirname, '..'), cache = new Map()
let now = '2026-07-16T12:00:00.000Z', failEntryCommit = false, parkingStatus = 200, externalCalls = 0
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])) }
  static now() { return Date.parse(now) }
}
const auth = { verifyIdToken: async token => {
  if (!['admin', 'employee', 'entriesOperator'].includes(token)) throw Error('Invalid fixture token')
  return { uid: token + '-fixture', email: token + '@example.invalid', role: token }
} }
const dbProxy = new Proxy(db, { get(target, key) {
  if (key === 'runTransaction') return fn => target.runTransaction(async tx => {
    const wrapped = new Proxy(tx, { get(t, k) {
      if (['create', 'update'].includes(k)) return (ref, data, ...args) => {
        if (failEntryCommit && ref.path.startsWith('bookings/') && data.lpr?.isInside === true) {
          failEntryCommit = false; throw Error('Injected booking-entry write failure')
        }
        return t[k](ref, data, ...args)
      }
      const value = t[k]; return typeof value === 'function' ? value.bind(t) : value
    } })
    return fn(wrapped)
  })
  const value = target[key]; return typeof value === 'function' ? value.bind(target) : value
} })
function load(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText
  new Function('require', 'module', 'exports', 'Date', js)(name => {
    if (name === 'server-only') return {}
    if (name === '@/lib/firebase-admin') return { adminDb: dbProxy, adminAuth: auth }
    if (name === '@/app/actions/booking-actions') return { cancelBooking: async () => ({ success: true }) }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)) + '.ts')
    return require(name)
  }, mod, mod.exports, Clock)
  return mod.exports
}
// Extract complete, unmodified function bodies from the server-action module. Loading
// its unrelated payment/mail dependencies would mask the real persistence boundary.
const actionSource = ts.createSourceFile('actions.ts', fs.readFileSync(path.join(root, 'app/actions/booking-actions.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
function action(name, dependencies) {
  const node = actionSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(node, 'server action exists: ' + name)
  const exports = {}
  const declaration = node.getText(actionSource).replace(/^async function /, 'export async function ')
  const js = ts.transpileModule(declaration, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  new Function('exports', 'Date', ...Object.keys(dependencies), js)(exports, Clock, ...Object.values(dependencies))
  return exports[name]
}
const quiet = { log() {}, error() {}, warn() {} }
const firestore = load('lib/server-firestore.ts')
const createManualBooking = action('createManualBooking', {
  ...firestore, normalizeLicensePlate: load('lib/utils.ts').normalizeLicensePlate,
  authorizeAdminRequest: load('lib/admin-api-auth.ts').authorizeAdminRequest,
  createManualBookingRecord: load('lib/manual-lpr-entry.server.ts').createManualBookingRecord,
  API_CONFIG: { url: 'https://fixture.invalid/parking', username: 'fixture', password: 'fixture', multiparkId: 'fixture' },
  fetch: async url => { assert.equal(url, 'https://fixture.invalid/parking'); externalCalls++
    return new Response('<ErrorCode>1</ErrorCode><Message>Fixture success</Message>', { status: parkingStatus }) },
  console: quiet,
})
const persistReservation = action('saveCompleteBookingToFirestore', { ...firestore, console: quiet })
const { NextRequest } = require('next/server')
const occupancyRoute = load('app/api/admin/occupancy/route.ts')
const routes = {
  '/api/admin/occupancy': occupancyRoute,
  '/NotificationInfo/TollgateInfo': load('app/NotificationInfo/TollgateInfo/route.ts'),
  '/NotificationInfo/KeepAlive': load('app/NotificationInfo/KeepAlive/route.ts'),
  '/api/admin/manual-lpr-entry': load('app/api/admin/manual-lpr-entry/route.ts'),
  '/api/admin/manual-lpr-exit': load('app/api/admin/manual-lpr-exit/route.ts'),
  '/api/admin/bookings/plate': load('app/api/admin/bookings/plate/route.ts'),
  '/api/admin/bookings/cancel': load('app/api/admin/bookings/cancel/route.ts'),
  '/api/admin/lpr-review': load('app/api/admin/lpr-review/route.ts'),
  '/api/cron/lpr-retry': load('app/api/cron/lpr-retry/route.ts'),
  '/api/anpr': load('app/api/anpr/route.ts'),
  '/lpr/cameras/hikvision/results': load('app/lpr/cameras/hikvision/results/route.ts'),
  '/api/metrici-lpr-oprit': load('app/api/metrici-lpr-oprit/route.ts'),
  '/api/metrici-legacy/check': load('app/api/metrici-lpr-oprit(elimina-oprit-pt-functionare)/[type]/route.ts'),
}
const base = { licensePlate: 'SIM01', status: 'confirmed_paid', startDate: '2026-07-16', startTime: '00:00', endDate: '2026-07-16', endTime: '23:59' }
const seed = (id = 'active', patch = {}) => db.doc('bookings/' + id).set({ ...base, ...patch })
const read = async id => (await db.doc(id).get()).data()
let server, origin, scenario, matrix = [], cases = 0
async function request(route, body, status = 200, token = 'admin', method = body === undefined ? 'GET' : 'POST') {
  const form = body instanceof FormData
  const r = await fetch(origin + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) })
  const raw = await r.text(); assert.equal(r.status, status, raw)
  try { return JSON.parse(raw) } catch { return raw }
}
async function snapshot() {
  const api = await request('/api/admin/occupancy')
  const records = (await db.collection('bookings').get()).docs.map(d => ({ id: d.id, ...d.data() }))
  const effective = records.filter(b => load('lib/lpr-presence.ts').getLprPresenceState(b).isEffectivelyInside)
  assert.equal(api.occupiedCount, api.plates.length)
  assert.deepEqual(api.plates.map(p => p.id).sort(), effective.map(p => p.id).sort())
  assert.equal(load('lib/lpr-occupancy.ts').countEffectiveLprOccupancy(records), api.occupiedCount)
  const cache = (await read('config/parkingLive')).occupiedCount
  return { count: api.occupiedCount, ids: api.plates.map(p => p.id).sort(), plates: api.plates.map(p => p.licensePlate).sort(), cache, records }
}
async function step(label, delta, run, { cacheDelta = delta, note = '', expectedPlate, expectedBookingId } = {}) {
  const before = await snapshot(), row = { scenario, step: label, expectedDelta: delta, cacheExpectedDelta: cacheDelta, note, passed: false }
  matrix.push(row)
  try {
    const result = await run(), after = await snapshot()
    Object.assign(row, { before: before.count, after: after.count, actualDelta: after.count - before.count, cacheBefore: before.cache, cacheAfter: after.cache,
      idsBefore: before.ids, idsAfter: after.ids, platesAfter: after.plates })
    assert.equal(after.count - before.count, delta, label + ': page delta')
    assert.equal(after.cache - before.cache, cacheDelta, label + ': internal cache delta')
    if (expectedPlate) assert.ok(after.plates.includes(expectedPlate))
    if (expectedBookingId) assert.ok(after.ids.includes(expectedBookingId))
    assert.equal(new Set(after.plates.map(load('lib/utils.ts').normalizeLicensePlate)).size, after.plates.length, 'no duplicate physical plate')
    for (const record of after.records.filter(b => after.ids.includes(b.id))) {
      const pointer = await read('lpr_plate_state/' + load('lib/utils.ts').normalizeLicensePlate(record.licensePlate))
      assert.equal(pointer?.isInside, true); assert.equal(pointer.bookingId, record.id)
      assert.equal(pointer.visitId, record.lpr.visitId)
    }
    row.passed = true
    return result
  } finally { saveMatrix() }
}
function saveMatrix() {
  if (!process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR) return
  fs.writeFileSync(path.join(process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR, 'entries-matrix.json'), JSON.stringify({ productionWrites: 0, cases, rows: matrix }, null, 2))
}
async function camera(type, time = '10:00:00', plate = 'SIM01', device) {
  return request('/NotificationInfo/TollgateInfo', { Picture: { Plate: { PlateNumber: plate }, SnapInfo: {
    DeviceID: device || (type === 'entry' ? 'intrare_1' : 'iesire_1'), Direction: device === 'unknown' ? '?' : type,
    AccurateTime: '2026-07-16 ' + time, SnapTime: '2026-07-16 ' + time, Source: 'Realtime',
  } } }, 200, '')
}
async function entryInput(id = 'active', patch = {}, role = 'admin') {
  const ctx = await request('/api/admin/manual-lpr-entry', { action: 'prepare', bookingId: id }, 200, role)
  return { action: 'save', bookingId: id, version: ctx.version, requestId: randomUUID(), entryMode: 'new_visit', date: '2026-07-16', time: '10:00:00', ...patch }
}
function form(inside, patch = {}, token = 'admin') {
  const f = new FormData()
  for (const [key, value] of Object.entries({ ...base, manualIsInside: String(inside), adminToken: token, ...patch })) f.set(key, value)
  return f
}
async function cron() {
  const due = await db.collection('lpr_events').where('associationStatus', '==', 'pending').get()
  for (const d of due.docs) await d.ref.update({ nextAttemptAt: 0 })
  return request('/api/cron/lpr-retry', undefined, 200, 'fixture-cron')
}
async function check(name, fn) {
  scenario = name; failEntryCommit = false; parkingStatus = 200; externalCalls = 0; now = '2026-07-16T12:00:00.000Z'
  for (const key of ['LPR_AUTH_SECRET', 'LPR_INGEST_SECRET', 'LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON', 'LPR_TOLLGATE_WHITELIST']) delete process.env[key]
  process.env.CRON_SECRET = 'fixture-cron'
  process.env.LPR_ENABLED = 'true'; process.env.LPR_API_ACTIVE = 'false'
  process.env.LPR_DEVICES_JSON = JSON.stringify({ intrare_1: { direction: 'entry', timestampMode: 'romania_wall_clock', maxEventAgeMinutes: 1440 }, iesire_1: { direction: 'exit', timestampMode: 'romania_wall_clock', maxEventAgeMinutes: 1440 } })
  assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok)
  await db.doc('config/parkingLive').set({ occupiedCount: 0 })
  await db.doc('config/reservationSettings').set({ maxTotalReservations: 290 })
  await db.doc('config/reservationStats').set({ activeBookingsCount: 0, totalBookingsCount: 0 })
  await fn(); cases++; saveMatrix(); console.log('PASS', name)
}
async function main() {
  server = http.createServer(async (req, res) => {
    try {
      const url = origin + req.url, route = routes[new URL(url).pathname]
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      if (!route?.[req.method]) { res.writeHead(404); res.end('{}'); return }
      const response = await route[req.method](new NextRequest(url, { method: req.method, headers: req.headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) }), { params: Promise.resolve({ type: 'check' }) })
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text())
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port

  for (const [name, patch] of [
    ['online paid', { source: 'webhook', bookingOrigin: 'web' }],
    ['Expo paid', { source: 'webhook', bookingOrigin: 'mobile-app' }],
    ['pay on site', { source: 'pay_on_site', status: 'confirmed_pay_on_site' }],
    ['manual reservation', { source: 'manual', status: 'confirmed' }],
    ['paid legacy', { status: 'paid' }], ['test confirmed', { status: 'confirmed_test' }],
  ]) await check('Camera entry for ' + name, async () => {
    await seed('active', patch)
    await step('actual camera arrival', 1, () => camera('entry'), { expectedPlate: 'SIM01', expectedBookingId: 'active' })
    await step('same receipt delivered again', 0, () => camera('entry'))
    await step('different frame, same stay', 0, () => camera('entry', '10:01:00'))
    await step('same vehicle normalized from a different camera', 0, () => camera('entry', '10:02:00', 'sim-01', 'intrare_2'))
  })
  await check('Camera entry without any reservation creates one unmatched presence', async () => {
    await step('unmatched arrival', 1, () => camera('entry'), { expectedPlate: 'SIM01' })
    const rows = (await db.collection('bookings').get()).docs
    assert.equal(rows.length, 1); assert.equal(rows[0].data().status, 'unmatched_lpr')
  })
  await check('A historical reservation is not reopened by a new camera entry', async () => {
    await seed('old', { startDate: '2025-01-01', endDate: '2025-01-02' })
    await step('new unmatched stay', 1, () => camera('entry'))
    assert.equal((await read('bookings/old')).lpr, undefined)
  })
  await check('Exit followed by reentry creates a new visit and exactly one new place', async () => {
    await seed(); await step('first arrival', 1, () => camera('entry'))
    const visit = (await read('bookings/active')).lpr.visitId
    await step('real departure', -1, () => camera('exit', '11:00:00'))
    await step('real reentry', 1, () => camera('entry', '12:00:00'))
    assert.notEqual((await read('bookings/active')).lpr.visitId, visit)
  })
  for (const role of ['admin', 'employee', 'entriesOperator']) await check('Manual entry endpoint / role ' + role, async () => {
    await seed(); const body = await entryInput('active', {}, role)
    await step('confirmed manual arrival', 1, () => request('/api/admin/manual-lpr-entry', body, 200, role))
    await step('same request retried', 0, () => request('/api/admin/manual-lpr-entry', body, 200, role))
    const event = await read('lpr_events/manual_entry_' + body.requestId)
    assert.equal(event.adminUid, role + '-fixture')
  })
  await check('Manual reentry through the API creates a distinct stay', async () => {
    await seed(); await step('camera arrival', 1, () => camera('entry'))
    await step('camera departure', -1, () => camera('exit', '11:00:00'))
    const body = await entryInput('active', { time: '12:00:00', confirmReentry: true })
    await step('confirmed physical reentry', 1, () => request('/api/admin/manual-lpr-entry', body))
  })
  await check('Manual creation: present, absent and external API failure', async () => {
    await step('create with physical presence', 1, async () => { const r = await createManualBooking(form(true)); assert.equal(r.success, true) })
    await step('create reservation without presence', 0, async () => { const r = await createManualBooking(form(false, { licensePlate: 'SIM02' })); assert.equal(r.success, true) })
    parkingStatus = 503
    await step('external failure after physical presence was saved', 1, async () => { const r = await createManualBooking(form(true, { licensePlate: 'SIM03' })); assert.equal(r.success, true); assert.ok(r.apiError) })
    assert.equal(externalCalls, 3)
  })
  await check('Failed manual creation cannot add an unauthorized or duplicate presence', async () => {
    await step('unauthenticated creation', 0, async () => { const r = await createManualBooking(form(true, {}, 'invalid')); assert.equal(r.success, false) })
    await seed(); await step('initial vehicle', 1, () => camera('entry'))
    await step('duplicate normalized manual creation', 0, async () => { const r = await createManualBooking(form(true, { licensePlate: 'sim-01' })); assert.equal(r.success, false) })
    assert.equal(externalCalls, 0)
  })
  await check('A failed camera transaction is recovered by cron only once', async () => {
    await seed(); failEntryCommit = true
    const result = await step('receipt saved, transaction rolled back', 0, () => camera('entry'))
    assert.equal(result.status, 'pending')
    await step('cron applies actual arrival', 1, cron)
    await step('cron repeats without a new arrival', 0, cron)
  })
  await check('ADMIN retry requests work; only processing the receipt adds a vehicle', async () => {
    await seed(); failEntryCommit = true
    const result = await step('temporary failure', 0, () => camera('entry'))
    const receipts = (await db.collection('lpr_events').get()).docs; assert.equal(receipts.length, 1)
    const eventId = receipts[0].id
    const ctx = await request('/api/admin/lpr-review', { action: 'prepare', eventId })
    await step('ADMIN schedules retry', 0, () => request('/api/admin/lpr-review', { action: 'retry', eventId, version: ctx.version }))
    await step('worker processes retried entry', 1, cron)
  })
  await check('Ambiguous and whitelisted camera entries do not manufacture presence', async () => {
    await seed('a'); await seed('b')
    await step('ambiguous reservation association', 0, () => camera('entry'))
    await db.doc('bookings/a').delete(); await db.doc('bookings/b').delete()
    await db.doc('lpr_whitelist/SIM02').set({ enabled: true })
    await step('whitelist arrival', 0, () => camera('entry', '10:00:00', 'SIM02'))
    await step('unknown direction', 0, () => camera('entry', '10:00:00', 'SIM03', 'unknown'))
    await step('future camera time', 0, () => camera('entry', '23:00:00', 'SIM04'))
  })
  await check('Old entry cannot reopen a car after its known departure', async () => {
    await seed(); await step('arrival', 1, () => camera('entry'))
    await step('departure', -1, () => camera('exit', '12:00:00'))
    await step('late entry delivery', 0, () => camera('entry', '11:00:00'))
  })
  await check('Camera and manual entry racing for the same vehicle add exactly one place', async () => {
    await seed(); const body = await entryInput()
    await step('parallel entry channels', 1, async () => {
      const results = await Promise.allSettled([camera('entry'), request('/api/admin/manual-lpr-entry', body)])
      assert.ok(results.some(r => r.status === 'fulfilled'))
    })
  })
  await check('Two different vehicles arriving concurrently occupy two distinct places', async () => {
    await seed('one'); await seed('two', { licensePlate: 'SIM02' })
    await step('two independent arrivals', 2, async () => {
      await Promise.all([camera('entry'), camera('entry', '10:00:00', 'SIM02')])
      const pending = (await db.collection('lpr_events').where('associationStatus', '==', 'pending').get()).size
      if (pending) await cron()
    })
  })
  await check('Corrections, preparation and cancellation do not create additional vehicles', async () => {
    await seed(); await step('arrival', 1, () => camera('entry'))
    const ctx = await request('/api/admin/manual-lpr-entry', { action: 'prepare', bookingId: 'active' })
    await step('correct arrival time only', 0, () => request('/api/admin/manual-lpr-entry', { action: 'save', bookingId: 'active', version: ctx.version, requestId: randomUUID(), entryMode: 'correct_arrival', confirmOverwrite: true, date: '2026-07-16', time: '10:01:00' }))
    const plateCtx = await request('/api/admin/bookings/plate', { action: 'prepare', bookingId: 'active', plate: 'SIM02' })
    await step('correct physical plate', 0, () => request('/api/admin/bookings/plate', { action: 'save', bookingId: 'active', plate: 'SIM02', version: plateCtx.version, confirmPresent: true }), { expectedPlate: 'SIM02' })
    await step('cancel reservation while vehicle stays present', 0, () => request('/api/admin/bookings/cancel', { bookingId: 'active' }))
    for (const action of ['reset', 'set_all_outside', 'reverse_set_all_outside_window', 'reverse_set_all_outside_window_preview'])
      await step('disabled global operation: ' + action, 0, () => request('/api/admin/occupancy', { action }, 410))
    await step('recalculate internal cache', 0, () => request('/api/admin/occupancy', { action: 'recalculate' }))
  })
  await check('Heartbeat, ANPR/Hikvision and Metrici reporting endpoints do not add presence', async () => {
    await step('camera heartbeat', 0, () => request('/NotificationInfo/KeepAlive', {}, 200, ''))
    for (const route of ['/api/anpr', '/lpr/cameras/hikvision/results']) {
      await step(route + ' JSON receipt', 0, () => request(route, { plate: 'SIM01', direction: 'entry' }, 200, ''))
      const f = new FormData(); f.set('plate', 'SIM01'); f.set('direction', 'entry')
      await step(route + ' multipart receipt', 0, () => request(route, f, 200, ''))
    }
    const f = new FormData(); f.set('number', 'SIM01'); f.set('direction', '1')
    await step('Metrici reporting response', 0, () => request('/api/metrici-lpr-oprit', f, 200, ''))
    await step('disabled Metrici legacy route', 0, () => request('/api/metrici-legacy/check', f, 204, ''))
    assert.equal((await db.collection('lpr_events').get()).size, 0)
  })
  for (const [name, patch] of [
    ['website', { source: 'webhook', bookingOrigin: 'web', paymentStatus: 'paid' }],
    ['Expo', { source: 'webhook', bookingOrigin: 'mobile-app', paymentStatus: 'paid' }],
    ['pay on site', { source: 'pay_on_site', status: 'confirmed_pay_on_site', paymentStatus: 'not_paid' }],
  ]) await check('Reservation persistence: ' + name + ' is not a physical entry', async () => {
    const created = await step('reservation saved before arrival', 0, () => persistReservation({ ...base, apiSuccess: true, ...patch }), {
      cacheDelta: 1, note: 'Existing reservation writer pre-counts the separate cache; the Occupancy page remains 0. Physical entry must add one to the page without incrementing that cache again.',
    })
    assert.equal(created.success, true)
    await step('actual arrival of pre-counted reservation', 1, () => camera('entry'), { cacheDelta: 0, expectedBookingId: created.firestoreId })
    await step('actual departure balances pre-counted cache', -1, () => camera('exit', '11:00:00'))
  })
  console.log(`PASS ${cases} entry matrix cases, ${matrix.length} page-delta checkpoints`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  saveMatrix()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await deleteApp(app)
})
