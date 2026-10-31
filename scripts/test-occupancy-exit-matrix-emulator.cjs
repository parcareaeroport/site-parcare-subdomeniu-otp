// End-to-end local HTTP matrix for every application exit writer and its no-op paths.
// Cryptographic identity and commercial transport are fixtures; routes and Firestore are real.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const projectId = 'demo-parking-exit-matrix', app = initializeApp({ projectId }, 'exit-matrix'), db = getFirestore(app)
const root = path.resolve(__dirname, '..'), cache = new Map()
let now = '2026-07-16T12:00:00.000Z', failExitCommit = false, failDeleteCommit = false, cancelOutcome = 'success'
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
        if (failExitCommit && ref.path.startsWith('bookings/') && data.lpr?.isInside === false) {
          failExitCommit = false; throw Error('Injected booking-exit write failure')
        }
        return t[k](ref, data, ...args)
      }
      if (k === 'delete') return ref => {
        if (failDeleteCommit && ref.path.startsWith('bookings/')) { failDeleteCommit = false; throw Error('Injected deletion failure') }
        return t.delete(ref)
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
    if (name === '@/app/actions/booking-actions') return { cancelBooking: async () => ({ success: cancelOutcome === 'success', outcomeUnknown: cancelOutcome === 'unknown', message: 'Fixture cancellation refused' }) }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)) + '.ts')
    return require(name)
  }, mod, mod.exports, Clock)
  return mod.exports
}
const { NextRequest } = require('next/server')
const routes = {
  '/api/admin/occupancy': load('app/api/admin/occupancy/route.ts'),
  '/NotificationInfo/TollgateInfo': load('app/NotificationInfo/TollgateInfo/route.ts'),
  '/NotificationInfo/KeepAlive': load('app/NotificationInfo/KeepAlive/route.ts'),
  '/api/admin/manual-lpr-entry': load('app/api/admin/manual-lpr-entry/route.ts'),
  '/api/admin/manual-lpr-exit': load('app/api/admin/manual-lpr-exit/route.ts'),
  '/api/admin/bookings/delete': load('app/api/admin/bookings/delete/route.ts'),
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
const read = async path => (await db.doc(path).get()).data()
let server, origin, scenario, matrix = [], cases = 0
async function request(route, body, status = 200, token = 'admin', method = body === undefined ? 'GET' : 'POST') {
  const form = body instanceof FormData
  const r = await fetch(origin + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }) })
  const raw = await r.text()
  assert.ok((Array.isArray(status) ? status : [status]).includes(r.status), `${r.status}: ${raw}`)
  try { return JSON.parse(raw) } catch { return raw }
}
async function snapshot() {
  const api = await request('/api/admin/occupancy')
  const records = (await db.collection('bookings').get()).docs.map(d => ({ id: d.id, ...d.data() }))
  const effective = records.filter(b => load('lib/lpr-presence.ts').getLprPresenceState(b).isEffectivelyInside)
  assert.equal(api.occupiedCount, api.plates.length)
  assert.deepEqual(api.plates.map(p => p.id).sort(), effective.map(p => p.id).sort())
  assert.equal(load('lib/lpr-occupancy.ts').countEffectiveLprOccupancy(records), api.occupiedCount)
  const presence = records.map(b => ({ id: b.id, lpr: b.lpr || null, incremented: b.occupancyIncremented ?? null, decremented: b.occupancyDecremented ?? null })).sort((a, b) => a.id.localeCompare(b.id))
  const pointers = (await db.collection('lpr_plate_state').get()).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id))
  return { count: api.occupiedCount, ids: api.plates.map(p => p.id).sort(), plates: api.plates.map(p => p.licensePlate).sort(),
    cache: (await read('config/parkingLive')).occupiedCount, records, presence, pointers }
}
async function step(label, delta, run, { cacheDelta = delta, note = '', absentId, unchanged = false, corruptFixture = false } = {}) {
  const before = await snapshot(), row = { scenario, step: label, expectedDelta: delta, cacheExpectedDelta: cacheDelta, note, passed: false }
  matrix.push(row)
  try {
    const result = await run(), after = await snapshot()
    Object.assign(row, { before: before.count, after: after.count, actualDelta: after.count - before.count, cacheBefore: before.cache, cacheAfter: after.cache,
      idsBefore: before.ids, idsAfter: after.ids, platesAfter: after.plates })
    assert.equal(after.count - before.count, delta, label + ': page delta')
    assert.equal(after.cache - before.cache, cacheDelta, label + ': cache delta')
    assert.ok(after.cache >= 0, 'fixture counter must never go negative')
    if (absentId) {
      assert.ok(before.ids.includes(absentId)); assert.ok(!after.ids.includes(absentId))
      const pointer = after.pointers.find(p => p.bookingId === absentId)
      if (pointer) assert.equal(pointer.isInside, false)
      assert.deepEqual(after.ids, before.ids.filter(id => id !== absentId), 'remove precisely the selected stay')
    }
    if (unchanged) {
      assert.deepEqual(after.presence, before.presence, 'no partial presence/flag update')
      assert.deepEqual(after.pointers, before.pointers, 'no unrelated pointer update')
    }
    if (!corruptFixture) {
      assert.equal(new Set(after.plates.map(load('lib/utils.ts').normalizeLicensePlate)).size, after.plates.length)
      for (const record of after.records.filter(b => after.ids.includes(b.id))) {
        const pointer = after.pointers.find(p => p.id === load('lib/utils.ts').normalizeLicensePlate(record.licensePlate))
        assert.equal(pointer?.isInside, true); assert.equal(pointer.bookingId, record.id); assert.equal(pointer.visitId, record.lpr.visitId)
      }
    }
    row.passed = true; return result
  } finally { saveMatrix() }
}
function saveMatrix() {
  if (process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR) fs.writeFileSync(path.join(process.env.OCCUPANCY_ACCEPTANCE_REPORT_DIR, 'exits-matrix.json'), JSON.stringify({ productionWrites: 0, cases, rows: matrix }, null, 2))
}
async function camera(type, time = type === 'entry' ? '10:00:00' : '11:00:00', plate = 'SIM01', device) {
  return request('/NotificationInfo/TollgateInfo', { Picture: { Plate: { PlateNumber: plate }, SnapInfo: {
    DeviceID: device || (type === 'entry' ? 'intrare_1' : 'iesire_1'), Direction: device === 'unknown' ? '?' : type,
    AccurateTime: '2026-07-16 ' + time, SnapTime: '2026-07-16 ' + time, Source: 'Realtime',
  } } }, 200, '')
}
async function arrived(id = 'active', patch = {}) {
  await seed(id, patch)
  await step('setup: actual arrival', 1, () => camera('entry', '10:00:00', patch.licensePlate || 'SIM01'))
}
async function exitInput(id = 'active', patch = {}, role = 'admin') {
  const ctx = await request('/api/admin/manual-lpr-exit', { action: 'prepare', bookingId: id }, 200, role)
  return { action: 'save', bookingId: id, version: ctx.version, requestId: randomUUID(), date: '2026-07-16', time: '11:00:00', ...patch }
}
async function deleteInput(id = 'active', patch = {}) {
  const ctx = await request('/api/admin/bookings/delete', { action: 'prepare', bookingId: id })
  return { action: 'save', bookingId: id, version: ctx.version, requestId: randomUUID(), confirmNotPresent: true, ...patch }
}
async function cron() {
  const due = await db.collection('lpr_events').where('associationStatus', '==', 'pending').get()
  for (const d of due.docs) await d.ref.update({ nextAttemptAt: 0 })
  return request('/api/cron/lpr-retry', undefined, 200, 'fixture-cron')
}
async function check(name, fn) {
  scenario = name; failExitCommit = false; failDeleteCommit = false; cancelOutcome = 'success'; now = '2026-07-16T12:00:00.000Z'
  for (const key of ['LPR_AUTH_SECRET', 'LPR_INGEST_SECRET', 'LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON', 'LPR_TOLLGATE_WHITELIST']) delete process.env[key]
  process.env.CRON_SECRET = 'fixture-cron'; process.env.LPR_ENABLED = 'true'; process.env.LPR_API_ACTIVE = 'false'
  process.env.LPR_DEVICES_JSON = JSON.stringify({ intrare_1: { direction: 'entry', timestampMode: 'romania_wall_clock', maxEventAgeMinutes: 1440 }, iesire_1: { direction: 'exit', timestampMode: 'romania_wall_clock', maxEventAgeMinutes: 1440 } })
  assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok)
  await db.doc('config/parkingLive').set({ occupiedCount: 0 }); await db.doc('config/reservationStats').set({ activeBookingsCount: 0 })
  await db.doc('config/reservationSettings').set({ maxTotalReservations: 290 })
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
    ['website', { source: 'webhook', bookingOrigin: 'web' }], ['Expo', { source: 'webhook', bookingOrigin: 'mobile-app' }],
    ['pay on site', { source: 'pay_on_site', status: 'confirmed_pay_on_site' }], ['manual', { source: 'manual', status: 'confirmed' }],
    ['paid legacy', { status: 'paid' }], ['confirmed test', { status: 'confirmed_test' }],
  ]) await check('Camera departure for ' + name, async () => {
    await arrived('active', patch)
    await step('actual camera departure', -1, () => camera('exit'), { absentId: 'active' })
    const b = await read('bookings/active'); assert.ok(b.lpr.departedAt); assert.equal(b.occupancyDecremented, true)
    await step('same receipt repeated', 0, () => camera('exit'), { unchanged: true })
    await step('another exit frame cannot subtract again', 0, () => camera('exit', '11:01:00'), { unchanged: true })
  })
  await check('Unmatched vehicle departure closes its own stay and calculates duration', async () => {
    const r = await step('setup: unmatched arrival', 1, () => camera('entry'))
    const id = (await db.collection('bookings').get()).docs[0].id
    await step('unmatched departure', -1, () => camera('exit'), { absentId: id })
    assert.equal((await read('bookings/' + id)).durationMinutes, 60)
  })
  for (const status of ['expired', 'cancelled_by_admin']) await check('An overdue or ' + status + ' reservation still needs actual departure', async () => {
    await arrived(); await db.doc('bookings/active').update({ status, endDate: '2026-07-15', endTime: '01:00' })
    assert.equal((await snapshot()).count, 1)
    await step('actual departure despite inactive reservation', -1, () => camera('exit'), { absentId: 'active' })
  })
  for (const role of ['admin', 'employee', 'entriesOperator']) await check('Manual exit endpoint / role ' + role, async () => {
    await arrived()
    const body = await step('prepare dialog only', 0, () => exitInput('active', {}, role), { unchanged: true })
    const result = await step('confirmed manual departure', -1, () => request('/api/admin/manual-lpr-exit', body, 200, role), { absentId: 'active' })
    assert.equal((await read('lpr_events/' + result.lprEventId)).adminUid, role + '-fixture')
    await step('same manual request retried', 0, () => request('/api/admin/manual-lpr-exit', body, 200, role), { unchanged: true })
    await step('camera sees that same departure afterwards', 0, () => camera('exit', '11:01:00'), { unchanged: true })
  })
  await check('Deletion confirmed absent removes one current stay and preserves original clock evidence', async () => {
    await arrived(); const before = await read('bookings/active')
    const body = await step('prepare deletion only', 0, () => deleteInput(), { unchanged: true })
    await step('confirmed absence and archive', -1, () => request('/api/admin/bookings/delete', body), { absentId: 'active' })
    const archive = await read('deleted_bookings/active')
    assert.equal(archive.lpr.departedAt, before.lpr.departedAt); assert.ok(archive.lpr.presenceCorrection)
    assert.equal(await read('bookings/active'), undefined)
    await step('deletion request repeated', 0, () => request('/api/admin/bookings/delete', body), { unchanged: true })
    await step('late camera departure after deletion', 0, () => camera('exit', '11:00:00'), { unchanged: true })
  })
  await check('Deleting an already closed or never-arrived reservation does not subtract', async () => {
    await arrived(); await step('first actual departure', -1, () => camera('exit'), { absentId: 'active' })
    await step('archive closed reservation', 0, async () => request('/api/admin/bookings/delete', await deleteInput()))
    await seed('unused', { licensePlate: 'SIM02' })
    await step('archive reservation without any arrival', 0, async () => request('/api/admin/bookings/delete', await deleteInput('unused')))
  })
  await check('Historical departure correction never subtracts again or closes a later stay', async () => {
    await arrived(); await step('real departure', -1, () => camera('exit'))
    await step('setup: later physical stay', 1, () => camera('entry', '12:00:00'))
    // A different closed historical document is deliberately present for the correction.
    await seed('history', { startDate: '2026-07-15', endDate: '2026-07-15', lpr: { isInside: false, visitId: 'history', arrivedAt: '2026-07-15T09:00:00Z', departedAt: '2026-07-15T10:00:00Z', lastSeenAt: '2026-07-15T10:00:00Z', lastEventType: 'exit' } })
    const pointer = await read('lpr_plate_state/SIM01')
    const body = await exitInput('history', { date: '2026-07-15', time: '10:01:00', confirmOverwrite: true, confirmDuplicates: true })
    await step('correct only historical departure clock', 0, () => request('/api/admin/manual-lpr-exit', body))
    assert.deepEqual(await read('lpr_plate_state/SIM01'), pointer); assert.equal((await snapshot()).count, 1)
  })
  await check('One failed camera exit is recovered through cron exactly once', async () => {
    await arrived(); failExitCommit = true
    const result = await step('exit receipt persists but transaction fails', 0, () => camera('exit'), { unchanged: true })
    assert.equal(result.status, 'pending')
    await step('cron applies saved physical departure', -1, cron, { absentId: 'active' })
    await step('cron repeated', 0, cron, { unchanged: true })
  })
  await check('ADMIN retry schedules an exit but the worker is what subtracts', async () => {
    await arrived(); failExitCommit = true; await step('temporary camera failure', 0, () => camera('exit'), { unchanged: true })
    const receipt = (await db.collection('lpr_events').where('associationStatus', '==', 'pending').get()).docs[0]
    const ctx = await request('/api/admin/lpr-review', { action: 'prepare', eventId: receipt.id })
    await step('ADMIN retry request', 0, () => request('/api/admin/lpr-review', { action: 'retry', eventId: receipt.id, version: ctx.version }), { unchanged: true })
    await step('worker applies actual exit', -1, cron, { absentId: 'active' })
  })
  await check('Manual exit transaction failure leaves no partial presence changes', async () => {
    await arrived(); const body = await exitInput(); failExitCommit = true
    await step('manual save fails before commit', 0, () => request('/api/admin/manual-lpr-exit', body, 503), { unchanged: true })
    assert.equal(await read('lpr_events/manual_exit_' + body.requestId), undefined)
    await step('same request retried successfully', -1, () => request('/api/admin/manual-lpr-exit', body), { absentId: 'active' })
  })
  await check('Deletion rollback and lost-response retry cannot double-decrement', async () => {
    await arrived(); const body = await deleteInput(); failDeleteCommit = true
    await step('archive transaction aborts', 0, () => request('/api/admin/bookings/delete', body, 500), { unchanged: true })
    assert.equal(await read('deleted_bookings/active'), undefined)
    await step('retry commits deletion', -1, () => request('/api/admin/bookings/delete', body), { absentId: 'active' })
    await step('response lost: repeat identical request', 0, () => request('/api/admin/bookings/delete', body), { unchanged: true })
  })
  await check('External cancellation refusal or uncertainty never removes physical presence', async () => {
    await arrived('active', { source: 'webhook', apiBookingNumber: 'fixture' })
    for (const outcome of ['reject', 'unknown']) {
      cancelOutcome = outcome; const body = await deleteInput()
      await step('external result: ' + outcome, 0, () => request('/api/admin/bookings/delete', body, outcome === 'reject' ? 502 : 409), { unchanged: true })
    }
  })
  await check('Parallel camera/manual exit removes only one vehicle', async () => {
    await arrived(); const body = await exitInput()
    await step('same physical exit through both channels', -1, async () => {
      await Promise.all([camera('exit'), request('/api/admin/manual-lpr-exit', body, [200, 409])])
    }, { absentId: 'active' })
    await step('any remaining camera retry is a no-op', 0, cron, { unchanged: true })
  })
  await check('Two different cars departing simultaneously remove two distinct stays', async () => {
    await arrived('one'); await arrived('two', { licensePlate: 'SIM02' })
    await step('two independent departures', -2, async () => {
      await Promise.all([camera('exit'), camera('exit', '11:00:00', 'SIM02')]); await cron()
    })
  })
  await check('A stale manual exit cannot remove a car that exited and reentered', async () => {
    await arrived(); const old = await exitInput()
    await step('first departure', -1, () => camera('exit')); await step('physical reentry', 1, () => camera('entry', '12:00:00'))
    await step('stale dialog rejected', 0, () => request('/api/admin/manual-lpr-exit', old, 409), { unchanged: true })
    await step('late old camera exit rejected', 0, () => camera('exit', '11:30:00'), { unchanged: true })
  })
  await check('Duplicate legacy presence blocks automatic exit/deletion and requires selected manual confirmation', async () => {
    await arrived(); const b = await read('bookings/active')
    await seed('duplicate', { licensePlate: 'sim-01', lpr: { ...b.lpr, visitId: 'duplicate' }, occupancyIncremented: true })
    await db.doc('config/parkingLive').update({ occupiedCount: 2 })
    const options = { unchanged: true, corruptFixture: true }
    await step('camera does not choose between duplicate stays', 0, () => camera('exit'), options)
    const body = await exitInput()
    await step('manual exit without duplicate confirmation', 0, () => request('/api/admin/manual-lpr-exit', body, 400), options)
    await step('deletion cannot bypass duplicates', 0, async () => request('/api/admin/bookings/delete', await deleteInput(), 409), options)
    // Dedicated exit-protection suite tests confirmed selection; this matrix keeps
    // the contradictory fixture unchanged instead of guessing a departure.
  })
  await check('Whitelist added during an occupied stay must not suppress its departure', async () => {
    await arrived(); await db.doc('lpr_whitelist/SIM01').set({ enabled: true })
    await step('exit still closes counted visit', -1, () => camera('exit'), { absentId: 'active' })
  })
  await check('Invalid clocks, missing confirmation and unauthorized operators cannot remove a place', async () => {
    await arrived()
    for (const [patch, status] of [[{ time: '09:00:00' }, 400], [{ date: '2099-01-01' }, 400], [{ date: '2026-02-30' }, 400]]) {
      const body = await exitInput('active', patch)
      await step('invalid manual clock ' + JSON.stringify(patch), 0, () => request('/api/admin/manual-lpr-exit', body, status), { unchanged: true })
    }
    await step('future camera departure', 0, () => camera('exit', '23:00:00'), { unchanged: true })
    await step('unknown device/direction', 0, () => camera('exit', '11:00:00', 'SIM01', 'unknown'), { unchanged: true })
    await step('manual authorization missing', 0, () => request('/api/admin/manual-lpr-exit', { action: 'save', bookingId: 'active' }, 401, ''), { unchanged: true })
    await step('delete physical confirmation missing', 0, async () => request('/api/admin/bookings/delete', await deleteInput('active', { confirmNotPresent: false }), 400), { unchanged: true })
  })
  for (const flags of [{ occupancyIncremented: false, occupancyDecremented: false }, { occupancyIncremented: true, occupancyDecremented: true }]) {
    await check('Legacy flags: close presence without subtracting an unowned cache increment ' + JSON.stringify(flags), async () => {
      await arrived(); await db.doc('bookings/active').update(flags); await db.doc('config/parkingLive').update({ occupiedCount: 0 })
      await step('actual exit removes page row without negative cache', -1, () => camera('exit'), { cacheDelta: 0, absentId: 'active', note: 'Legacy flag inconsistency: page loses its one effective presence; existing cache flags do not authorize another decrement. No global counter repair is inferred.' })
    })
  }
  await check('Cancellation, number correction, heartbeat and recalculation do not mean departure', async () => {
    await arrived(); await step('cancel booking while car is still present', 0, () => request('/api/admin/bookings/cancel', { bookingId: 'active' }), { unchanged: true })
    const ctx = await request('/api/admin/bookings/plate', { action: 'prepare', bookingId: 'active', plate: 'SIM02' })
    await step('correct number while car remains present', 0, () => request('/api/admin/bookings/plate', { action: 'save', bookingId: 'active', plate: 'SIM02', version: ctx.version, confirmPresent: true }))
    await step('camera heartbeat', 0, () => request('/NotificationInfo/KeepAlive', {}, 200, ''), { unchanged: true })
    await step('recalculate same internal counter', 0, () => request('/api/admin/occupancy', { action: 'recalculate' }), { unchanged: true })
    for (const action of ['reset', 'set_all_outside', 'reverse_set_all_outside_window', 'reverse_set_all_outside_window_preview'])
      await step('disabled destructive global operation: ' + action, 0, () => request('/api/admin/occupancy', { action }, 410), { unchanged: true })
  })
  await check('ANPR/Hikvision/Metrici report receipt is not an applied departure', async () => {
    await arrived()
    for (const route of ['/api/anpr', '/lpr/cameras/hikvision/results'])
      await step(route + ' departure report only', 0, () => request(route, { plate: 'SIM01', direction: 'exit' }, 200, ''), { unchanged: true })
    const f = new FormData(); f.set('number', 'SIM01'); f.set('direction', '2')
    await step('Metrici reporting only', 0, () => request('/api/metrici-lpr-oprit', f, 200, ''), { unchanged: true })
    await step('Metrici legacy disabled', 0, () => request('/api/metrici-legacy/check', f, 204, ''), { unchanged: true })
  })
  for (const channel of ['camera', 'manual']) await check('Confirmed deletion racing ' + channel + ' exit subtracts once', async () => {
    await arrived(); const removal = await deleteInput(), departure = await exitInput()
    await step('two competing removal channels', -1, async () => {
      await Promise.all([
        request('/api/admin/bookings/delete', removal, [200, 409]),
        // Deletion may commit before the manual request reads its booking.
        channel === 'camera' ? camera('exit') : request('/api/admin/manual-lpr-exit', departure, [200, 404, 409]),
      ])
      await cron()
    }, { absentId: 'active' })
  })
  await check('Missing arrival requires explicit manual confirmation before decrement', async () => {
    await seed('active', { lpr: { isInside: true, visitId: 'legacy' }, occupancyIncremented: true })
    await db.doc('lpr_plate_state/SIM01').set({ bookingId: 'active', visitId: 'legacy', isInside: true })
    await db.doc('config/parkingLive').update({ occupiedCount: 1 })
    const body = await exitInput()
    await step('missing-arrival confirmation absent', 0, () => request('/api/admin/manual-lpr-exit', body, 400), { unchanged: true })
    await step('explicitly confirmed actual departure', -1, () => request('/api/admin/manual-lpr-exit', { ...body, confirmMissingArrival: true }), { absentId: 'active' })
  })
  await check('Stale raw presence and counter repair cannot subtract twice from page', async () => {
    await seed('active', { lpr: { isInside: true, arrivedAt: '2026-07-16T10:00:00Z', departedAt: '2026-07-16T11:00:00Z', lastSeenAt: '2026-07-16T11:00:00Z', lastEventType: 'exit' }, occupancyIncremented: true, occupancyDecremented: true })
    await db.doc('config/parkingLive').update({ occupiedCount: 1 })
    assert.equal((await snapshot()).count, 0)
    const body = await exitInput('active', { time: '11:01:00', confirmOverwrite: true })
    await step('correct departure already excluded from page', 0, () => request('/api/admin/manual-lpr-exit', body))
    await step('repair stale internal cache only', 0, () => request('/api/admin/occupancy', { action: 'recalculate' }), {
      cacheDelta: -1, unchanged: true, note: 'Recalculation can reduce the separate cache without removing any additional physical presence from the page.',
    })
  })
  await check('Automatic no-show worker never removes an observed vehicle', async () => {
    await arrived('active', { source: 'pay_on_site', status: 'confirmed_pay_on_site' })
    await db.doc('config/reservationSettings').update({ payOnSiteAutoCancelEnabled: true, payOnSiteAutoCancelMinutes: 1 })
    const { cancelNoShow } = require('../functions/pay-on-site-no-show.js')
    const { FieldValue } = require('firebase-admin/firestore')
    await step('worker skips present vehicle', 0, async () => {
      assert.equal(await cancelNoShow(dbProxy, db.doc('bookings/active'), FieldValue, new Clock()), false)
    }, { unchanged: true })
    await seed('unused', { licensePlate: 'SIM02', source: 'pay_on_site', status: 'confirmed_pay_on_site' })
    await step('worker cancels only unobserved no-show reservation', 0, async () => {
      assert.equal(await cancelNoShow(dbProxy, db.doc('bookings/unused'), FieldValue, new Clock()), true)
    }, { unchanged: true })
  })
  console.log(`PASS ${cases} exit matrix cases, ${matrix.length} page-delta checkpoints`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  saveMatrix()
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await deleteApp(app)
})
