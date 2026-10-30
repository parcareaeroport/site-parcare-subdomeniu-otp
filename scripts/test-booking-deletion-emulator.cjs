// Real admin/camera/occupancy routes + disposable Firestore emulator; no production.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const projectId = 'demo-parking-deletion', app = initializeApp({ projectId }, 'deletion-tests'), db = getFirestore(app)
const root = path.resolve(__dirname, '..'), cache = new Map()
let now = '2026-07-16T12:00:00.000Z', mode = 'success', externalCalls = 0, externalHook, failCommit = false
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return Date.parse(now) } }
const auth = { verifyIdToken: async token => {
  if (!['admin', 'employee'].includes(token)) throw Error('Invalid fixture token')
  return { uid: token + '-test', email: token + '@example.invalid', role: token }
} }
const proxy = new Proxy(db, { get(target, key) {
  if (key === 'runTransaction') return fn => target.runTransaction(async tx => {
    const wrapped = new Proxy(tx, { get(t, k) {
      if (k === 'delete') return ref => { if (failCommit && ref.path.startsWith('bookings/')) { failCommit = false; throw Error('Injected pre-commit failure') } return t.delete(ref) }
      const v = t[k]; return typeof v === 'function' ? v.bind(t) : v
    } })
    return fn(wrapped)
  })
  const v = target[key]; return typeof v === 'function' ? v.bind(target) : v
} })
function load(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', 'Date', js)(name => {
    if (name === 'server-only') return {}
    if (name === '@/lib/firebase-admin') return { adminDb: proxy, adminAuth: auth }
    if (name === '@/app/actions/booking-actions') return { cancelBooking: async () => {
      externalCalls++; if (externalHook) await externalHook()
      if (mode === 'throw') throw Error('External network interruption')
      return { success: mode === 'success', outcomeUnknown: mode === 'unknown', message: 'External cancellation refused' }
    } }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)) + '.ts')
    return require(name)
  }, mod, mod.exports, Clock)
  return mod.exports
}
process.env.LPR_DEVICES_JSON = JSON.stringify({ intrare_1: { direction: 'entry', timestampMode: 'romania_wall_clock', maxEventAgeMinutes: 1440 }, iesire_1: { direction: 'exit', timestampMode: 'romania_wall_clock', maxEventAgeMinutes: 1440 } })
const { POST } = load('app/api/admin/bookings/delete/route.ts')
const { POST: cameraPost } = load('app/NotificationInfo/TollgateInfo/route.ts')
const { GET: occupancyGet } = load('app/api/admin/occupancy/route.ts')
const { NextRequest } = require('next/server')
async function post(body, expected = 200, token = 'admin') {
  const r = await POST(new Request('http://localhost/api/admin/bookings/delete', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) }))
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); return data
}
async function camera(type, time) {
  const r = await cameraPost(new NextRequest('http://localhost/NotificationInfo/TollgateInfo', { method: 'POST', body: JSON.stringify({ Picture: { Plate: { PlateNumber: 'SIM01' }, SnapInfo: { DeviceID: type === 'entry' ? 'intrare_1' : 'iesire_1', AccurateTime: '2026-07-16 ' + time, SnapTime: '2026-07-16 ' + time, Direction: 'Obverse', Source: 'Realtime' } } }) }))
  assert.equal(r.status, 200); return r.json()
}
const base = { licensePlate: 'SIM01', source: 'lpr', status: 'confirmed_paid', startDate: '2026-07-16', startTime: '00:00', endDate: '2026-07-16', endTime: '23:59' }
const seed = (id = 'active', patch = {}) => db.doc('bookings/' + id).set({ ...base, ...patch })
const read = async p => (await db.doc(p).get()).data()
const prepare = (bookingId = 'active') => post({ action: 'prepare', bookingId })
const input = (ctx, patch = {}) => ({ action: 'save', bookingId: ctx.booking.id, version: ctx.version, requestId: randomUUID(), confirmNotPresent: true, ...patch })
async function inspect(expected) {
  const response = await occupancyGet(new Request('http://localhost/api/admin/occupancy', { headers: { Authorization: 'Bearer admin' } }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).occupiedCount, expected)
  assert.equal((await read('config/parkingLive')).occupiedCount, expected)
}
async function arrived() { await seed(); await camera('entry', '10:00:00'); await inspect(1) }
let passed = 0
async function check(name, fn) {
  assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })).ok)
  now = '2026-07-16T12:00:00.000Z'; mode = 'success'; externalCalls = 0; externalHook = undefined; failCommit = false
  await db.doc('config/parkingLive').set({ occupiedCount: 0 })
  await db.doc('config/reservationSettings').set({ maxTotalReservations: 290 })
  await fn(); passed++; console.log('PASS', name)
}
async function main() {
  await check('prepare and denied auth do not mutate or contact external system', async () => {
    await seed(); const before = await read('bookings/active')
    await prepare(); await post({ action: 'prepare', bookingId: 'active' }, 403, 'employee'); await post({ action: 'prepare', bookingId: 'active' }, 401, '')
    assert.deepEqual(await read('bookings/active'), before); assert.equal(externalCalls, 0)
  })
  await check('nonpresent deletion, legacy caller and no-plate record leave occupancy alone', async () => {
    await seed(); await post(input(await prepare())); await inspect(0)
    await seed('legacy', { licensePlate: '' }); await post({ bookingId: 'legacy' }); await inspect(0)
    await seed('no-plate', { licensePlate: '' }); await post(input(await prepare('no-plate'))); await inspect(0)
  })
  await check('present confirmed deletion atomically archives, closes pointer and decrements once', async () => {
    await arrived(); const before = await read('bookings/active'), ctx = await prepare()
    assert.equal(ctx.inside, true); assert.equal(ctx.blockedReason, null)
    const body = input(ctx), result = await post(body)
    assert.equal(result.presenceCorrected, true); assert.equal(result.decremented, true); await inspect(0)
    assert.equal(await read('bookings/active'), undefined)
    const archive = await read('deleted_bookings/active'), pointer = await read('lpr_plate_state/SIM01')
    assert.equal(archive.lpr.isInside, false); assert.equal(pointer.isInside, false)
    assert.equal(archive.lpr.departedAt, before.lpr.departedAt); assert.equal(archive.lpr.arrivedAt, before.lpr.arrivedAt)
    assert.equal(archive.lpr.lastSeenAt, before.lpr.lastSeenAt)
    assert.equal(archive.lpr.presenceCorrection.adminUid, 'admin-test')
    assert.equal(pointer.lastEventType, 'presence_correction')
    const audit = await read('lpr_events/delete_absence_' + body.requestId)
    assert.equal(audit.eventType, 'presence_correction'); assert.equal(audit.presenceAfter, false); assert.equal(audit.occupancyDelta, -1)
    assert.deepEqual(await post(body), result); await inspect(0)
    await post({ ...body, confirmNotPresent: false }, 409)
  })
  await check('confirmation absent and legacy present deletion are refused without partial writes', async () => {
    await arrived(); const ctx = await prepare(), before = await read('bookings/active')
    await post(input(ctx, { confirmNotPresent: false }), 400)
    await post({ bookingId: 'active' }, 409)
    assert.deepEqual(await read('bookings/active'), before); await inspect(1)
  })
  await check('closed booking deletion preserves another current stay and does not decrement twice', async () => {
    await arrived(); await camera('exit', '11:00:00'); await inspect(0)
    await seed('new', { lpr: { isInside: true, visitId: 'new' }, occupancyIncremented: true })
    await db.doc('config/parkingLive').update({ occupiedCount: 1 })
    await db.doc('lpr_plate_state/SIM01').set({ bookingId: 'new', visitId: 'new', isInside: true })
    await post(input(await prepare())); await inspect(1)
    assert.equal((await read('bookings/new')).lpr.isInside, true); assert.equal((await read('lpr_plate_state/SIM01')).bookingId, 'new')
  })
  await check('normalized duplicates block deletion of either live document', async () => {
    await arrived(); await seed('duplicate', { licensePlate: 'sim-01', lpr: { isInside: true, visitId: 'duplicate' } })
    const ctx = await prepare(); assert.match(ctx.blockedReason, /ADMIN/)
    await post(input(ctx), 409); assert.ok(await read('bookings/active')); assert.ok(await read('bookings/duplicate'))
  })
  await check('new duplicate appearing or disappearing invalidates prepared context', async () => {
    await arrived(); const ctx = await prepare()
    await seed('duplicate', { lpr: { isInside: true } }); await post(input(ctx), 409)
    const blocked = await prepare(); await db.doc('bookings/duplicate').delete(); await post(input(blocked), 409); await inspect(1)
  })
  await check('camera exit/reentry invalidates dialog, including legacy visit without ID', async () => {
    await arrived(); const ctx = await prepare(); await camera('exit', '11:00:00'); await camera('entry', '12:00:00')
    await post(input(ctx), 409); await inspect(1)
    await db.doc('bookings/active').update({ 'lpr.visitId': null }); const legacy = await prepare()
    await db.doc('bookings/active').update({ 'lpr.lastSeenAt': '2026-07-16T12:01:00.000Z' }); await post(input(legacy), 409)
  })
  await check('contradictory pointer, future receipt and raw/effective mismatch require ADMIN', async () => {
    await arrived(); await db.doc('lpr_plate_state/SIM01').update({ isInside: false })
    assert.ok((await prepare()).blockedReason)
    await db.doc('lpr_plate_state/SIM01').update({ isInside: true })
    await db.doc('lpr_events/future-entry').set({ normalizedPlate: 'SIM01', eventType: 'entry', eventTime: '2026-07-16T16:00:00Z', eventInstant: '2026-07-16T13:00:00Z', associationStatus: 'pending' })
    assert.ok((await prepare()).blockedReason)
    await db.doc('lpr_events/future-entry').delete()
    await db.doc('bookings/active').update({ 'lpr.departedAt': '2026-07-16T11:00:00Z' })
    const ctx = await prepare(); assert.ok(ctx.blockedReason); await post(input(ctx), 409)
    await db.doc('bookings/active').update({ lpr: { isInside: true, arrivedAt: '2099-01-01T10:00:00Z' } })
    const futureArrival = await prepare(); assert.ok(futureArrival.blockedReason); await post(input(futureArrival), 409)
  })
  await check('commit failure rolls back correction, audit, pointer, counter and archive', async () => {
    await arrived(); const ctx = await prepare(), body = input(ctx), pointer = await read('lpr_plate_state/SIM01')
    failCommit = true; await post(body, 500); await inspect(1)
    assert.equal(await read('deleted_bookings/active'), undefined)
    assert.equal(await read('lpr_events/delete_absence_' + body.requestId), undefined)
    assert.deepEqual(await read('lpr_plate_state/SIM01'), pointer)
    await post(body); await inspect(0)
  })
  await check('definitive and uncertain external refusal leave physical evidence unchanged', async () => {
    await arrived(); await db.doc('bookings/active').update({ source: 'online', apiBookingNumber: 'fixture' })
    const before = (await read('bookings/active')).lpr
    mode = 'reject'; await post(input(await prepare()), 502); await inspect(1)
    assert.deepEqual((await read('bookings/active')).lpr, before)
    mode = 'unknown'; await post(input(await prepare()), 409); await inspect(1)
    const calls = externalCalls; mode = 'success'; await post(input(await prepare()), 409); assert.equal(externalCalls, calls)
    assert.equal(await read('deleted_bookings/active'), undefined)
  })
  await check('camera crossing during external cancellation prevents local deletion', async () => {
    await arrived(); await db.doc('bookings/active').update({ source: 'online', apiBookingNumber: 'fixture' })
    externalHook = async () => { await camera('exit', '11:00:00'); await camera('entry', '12:00:00') }
    await post(input(await prepare()), 409); await inspect(1); assert.ok(await read('bookings/active'))
  })
  await check('concurrent identical deletions adjust at most once and replay after completion', async () => {
    await arrived(); const body = input(await prepare())
    const results = await Promise.all([POST(new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: JSON.stringify(body) })), POST(new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: JSON.stringify(body) }))])
    assert.ok(results.some(r => r.status === 200)); assert.ok(results.every(r => [200, 409].includes(r.status)))
    await post(body); await inspect(0)
  })
  await check('old camera receipt after deletion cannot reopen; genuine later arrival creates a new stay', async () => {
    await arrived(); await post(input(await prepare())); await inspect(0)
    await camera('entry', '10:05:00'); await inspect(0)
    now = '2026-07-16T13:00:00.000Z'; await camera('entry', '15:30:00'); await inspect(1)
    const rows = (await db.collection('bookings').get()).docs
    assert.equal(rows.length, 1); assert.notEqual(rows[0].id, 'active')
    await camera('exit', '15:45:00'); await inspect(0)
    await camera('entry', '10:06:00'); await inspect(0)
  })
  await check('counter already decremented or uncounted legacy presence is never decremented again', async () => {
    await seed('active', { lpr: { isInside: true, visitId: 'legacy' }, occupancyIncremented: true, occupancyDecremented: true })
    const r = await post(input(await prepare())); assert.equal(r.decremented, false); await inspect(0)
    await seed('uncounted', { licensePlate: 'SIM02', lpr: { isInside: true } }); const u = await post(input(await prepare('uncounted'))); assert.equal(u.decremented, false); await inspect(0)
  })
  await check('successful external cancellation is not repeated after local commit failure', async () => {
    await arrived(); await db.doc('bookings/active').update({ source: 'online', apiBookingNumber: 'fixture' })
    const body = input(await prepare()); failCommit = true
    await post(body, 500); await inspect(1); assert.equal(externalCalls, 1)
    await post(body); await inspect(0); assert.equal(externalCalls, 1)
  })
  await check('new deletion flow reverses loyalty once and retains balance audit', async () => {
    await arrived()
    await db.doc('users/fixture').set({ loyalty: { points: 4, reservationsCount: 0, freeDaysAvailable: 1, pointsToRecover: 0 } })
    await db.doc('bookings/active').update({ loyaltyRecord: { version: 1, profileCollection: 'users', userId: 'fixture', pointsAwarded: 1, freeDaysUsed: 0, reservationsPerFreeDay: 4 } })
    const body = input(await prepare()); await post(body); await inspect(0)
    assert.equal((await read('users/fixture')).loyalty.points, 3)
    assert.equal((await read('deleted_bookings/active')).loyaltyRecord.reversalStatus, 'reversed')
    await post(body); assert.equal((await read('users/fixture')).loyalty.points, 3)
  })
  await check('legacy visit without visitId can be corrected after physical confirmation', async () => {
    await seed('active', { status: 'unmatched_lpr', lpr: { isInside: true, arrivedAt: '2026-07-16T10:00:00Z' }, occupancyIncremented: true })
    await db.doc('config/parkingLive').update({ occupiedCount: 1 })
    await post(input(await prepare())); await inspect(0)
    assert.equal((await read('deleted_bookings/active')).lpr.departedAt, undefined)
  })
  await check('later closed historical evidence blocks deleting an older live stay', async () => {
    await arrived()
    await seed('later-history', { lpr: { isInside: false, arrivedAt: '2026-07-16T09:00:00Z', departedAt: '2026-07-16T11:00:00Z', lastSeenAt: '2026-07-16T11:00:00Z', lastEventType: 'exit' } })
    const ctx = await prepare(); assert.ok(ctx.blockedReason); await post(input(ctx), 409); await inspect(1)
    assert.ok(await read('bookings/later-history'))
  })
  console.log(`PASS ${passed} booking deletion scenarios`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => deleteApp(app))
