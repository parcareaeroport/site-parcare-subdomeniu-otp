// VN87YLT schema regression. Synthetic records only; real route handlers and emulator transactions.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const ts = require('typescript'), { randomUUID } = require('node:crypto')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/)
const { initializeApp, deleteApp } = require('firebase-admin/app'), { getFirestore } = require('firebase-admin/firestore')
const project = 'demo-parking-legacy-manual-exit', app = initializeApp({ projectId: project }, 'legacy-manual-exit'), db = getFirestore(app)
const root = path.resolve(__dirname, '..'), cache = new Map()
// Freeze application time; old camera fixtures must not age into stale_event_time.
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-01T18:00:00Z'])) }
  static now() { return Date.parse('2026-11-01T18:00:00Z') }
}
let failWrite = false
const proxy = new Proxy(db, { get(t, k) {
  if (k === 'runTransaction') return fn => t.runTransaction(tx => fn(new Proxy(tx, { get(tr, field) {
    if (field === 'update') return (ref, data, ...rest) => {
      if (failWrite && ref.path === 'bookings/active' && data.lpr?.isInside === false) { failWrite = false; throw Error('Injected exit commit failure') }
      return tr.update(ref, data, ...rest)
    }
    const value = tr[field]; return typeof value === 'function' ? value.bind(tr) : value
  } })))
  const value = t[k]; return typeof value === 'function' ? value.bind(t) : value
} })
function load(relative) {
  const full = path.resolve(root, relative); if (cache.has(full)) return cache.get(full).exports
  const m = { exports: {} }; cache.set(full, m)
  const js = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', 'Date', js)(name => {
    if (name === 'server-only') return {}
    if (name === '@/lib/firebase-admin') return { adminDb: proxy, adminAuth: { verifyIdToken: async token => {
      if (!['admin', 'employee', 'entriesOperator'].includes(token)) throw Error('Invalid fixture identity')
      return { uid: token + '-fixture', email: token + '@example.invalid', role: token }
    } } }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(full), name)) + '.ts')
    return require(name)
  }, m, m.exports, FixtureDate)
  return m.exports
}
const { POST: manual } = load('app/api/admin/manual-lpr-exit/route.ts')
const { POST: camera } = load('app/NotificationInfo/TollgateInfo/route.ts')
const { GET: occupancy } = load('app/api/admin/occupancy/route.ts')
const { receiptLprTime, lprTimeCandidates, lprTime, compareLprTimes } = load('lib/lpr-time.ts')
const { NextRequest } = require('next/server')
const plate = 'VN87YLT', date = '2026-11-01'
const booking = { licensePlate: plate, originalLicensePlate: 'VNYLT', source: 'webhook', status: 'confirmed_paid',
  startDate: '2026-10-29', startTime: '04:30', endDate: date, endTime: '15:00', occupancyIncremented: true, occupancyReserved: true,
  lpr: { isInside: true, visitId: 'legacy-manual', arrivedAt: '2026-10-29T04:30:00Z', departedAt: null,
    lastSeenAt: '2026-10-29T04:30:00Z', lastEventType: 'entry', lastSeenDeviceId: 'manual_admin', manualOverride: true } }
const legacyManual = { normalizedPlate: plate, plateNumber: plate, eventType: 'entry', deviceId: 'manual_admin', direction: 'manual',
  snapTime: '2026-10-29T04:30:00Z', accurateTime: '2026-10-29T04:30:00Z', associationStatus: 'manual', matchedBookingId: 'active' }
const read = async p => (await db.doc(p).get()).data()
const post = async (body, role = 'admin', status = 200) => {
  const response = await manual(new Request('http://localhost/api/admin/manual-lpr-exit', { method: 'POST', headers: { Authorization: 'Bearer ' + role }, body: JSON.stringify(body) }))
  const json = await response.json(); assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${response.status}: ${JSON.stringify(json)}`); return json
}
const cameraAt = async (type, at) => {
  const response = await camera(new NextRequest('http://localhost/NotificationInfo/TollgateInfo', { method: 'POST', body: JSON.stringify({
    Picture: { Plate: { PlateNumber: plate }, SnapInfo: { DeviceID: type === 'entry' ? 'intrare_1' : 'iesire_1', AccurateTime: at, SnapTime: at, Direction: type } },
  }) }))
  const json = await response.json(); assert.equal(response.status, 200, JSON.stringify(json)); return json
}
async function totals(n) {
  const response = await occupancy(new Request('http://localhost/api/admin/occupancy', { headers: { Authorization: 'Bearer admin' } }))
  assert.equal(response.status, 200); const json = await response.json()
  assert.equal(json.occupiedCount, n); assert.equal(json.plates.length, n)
  assert.equal((await read('config/parkingLive')).occupiedCount, n)
  assert.deepEqual(json.plates.map(p => p.id), n ? ['active'] : [])
}
async function context(role = 'admin') { return post({ action: 'prepare', bookingId: 'active' }, role) }
const input = (ctx, patch = {}) => ({ action: 'save', bookingId: 'active', requestId: randomUUID(), version: ctx.version, date, time: '15:20:00', ...patch })
async function fixture() {
  await db.doc('bookings/active').set(booking)
  await db.doc('lpr_plate_state/' + plate).set({ bookingId: 'archived', visitId: 'legacy-camera', isInside: true,
    lastEventAt: '2026-10-29T04:57:42.329Z', lastEventType: 'entry', lastDeviceId: 'intrare_1' })
  await db.doc('deleted_bookings/archived').set({ licensePlate: plate, originalBookingId: 'archived', status: 'unmatched_lpr', source: 'lpr',
    deletedReason: 'admin_delete', deletedAt: new Date('2026-10-29T06:30:23Z'),
    lpr: { isInside: false, visitId: 'legacy-camera', arrivedAt: '2026-10-29T04:57:42.329Z', lastSeenAt: '2026-10-29T04:57:42.329Z',
      lastEventType: 'exit_deleted', departedAt: '2026-10-29T06:30:22.920Z' } })
  await db.doc('lpr_events/legacy-manual').set(legacyManual)
  for (const [id, associationStatus] of [['legacy-camera', 'unmatched_visit'], ['legacy-duplicate', 'duplicate']]) {
    await db.doc('lpr_events/' + id).set({ normalizedPlate: plate, plateNumber: plate, eventType: 'entry', deviceId: 'intrare_1', direction: 'Obverse',
      accurateTime: '2026-10-29 04:57:42.329', snapTime: '2026-10-29 04:57:42', matchedBookingId: 'archived', associationStatus,
      ...(id === 'legacy-camera' ? { visitId: 'legacy-camera' } : {}) })
  }
  await db.doc('config/parkingLive').set({ occupiedCount: 1 }); await totals(1)
}
const snapshots = async () => ({ b: await read('bookings/active'), p: await read('lpr_plate_state/' + plate), a: await read('deleted_bookings/archived'), count: await read('config/parkingLive') })
let passed = 0
async function check(name, fn) {
  failWrite = false
  for (const key of ['LPR_AUTH_SECRET', 'LPR_INGEST_SECRET', 'LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON', 'LPR_DEVICES_JSON']) delete process.env[key]
  assert.ok((await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' })).ok)
  await fn(); passed++; console.log('PASS ' + name)
}
// CT30WWK legacy schema: manual correction changed booking observation only.
async function correctedArrivalFixture() {
  await fixture()
  const corrected = new Date('2026-10-29T09:13:18.823Z'), observed = new Date('2026-10-29T09:13:09.375Z')
  await db.doc('bookings/active').update({ lpr: { isInside: true, visitId: 'legacy-camera',
    arrivedAt: '2026-10-29T11:12:00Z', departedAt: null, lastSeenAt: '2026-10-29T11:12:00Z',
    lastEventType: 'entry', lastSeenDeviceId: 'manual_admin', manualOverride: true, manualOverrideAt: corrected } })
  await db.doc('lpr_plate_state/' + plate).set({ bookingId: 'active', visitId: 'legacy-camera', isInside: true,
    lastEventType: 'entry', lastDeviceId: 'intrare_1', lastEventAt: '2026-10-29T12:05:37.707Z', updatedAt: observed })
  await db.doc('lpr_events/legacy-camera').set({ normalizedPlate: plate, eventType: 'entry', deviceId: 'intrare_1',
    accurateTime: '2026-10-29 12:05:37.707', snapTime: '2026-10-29 12:05:37', matchedBookingId: 'active',
    visitId: 'legacy-camera', associationStatus: 'matched', receivedAt: new Date('2026-10-29T09:13:08.119Z') })
  await db.doc('lpr_events/legacy-manual').set({ ...legacyManual, accurateTime: '2026-10-29T11:12:00Z',
    snapTime: '2026-10-29T11:12:00Z', receivedAt: corrected })
  await db.doc('lpr_events/legacy-duplicate').delete()
}
async function main() {
  await check('strict read-time clock compatibility for proven linked manual receipt', async () => {
    assert.equal(receiptLprTime(legacyManual).wall, '2026-10-29T04:30:00.000Z')
    assert.equal(lprTimeCandidates(receiptLprTime(legacyManual)).length, 1)
    assert.equal(compareLprTimes(receiptLprTime(legacyManual), lprTime('2026-11-01T15:20:00Z')), -1)
    for (const patch of [{ manual: false }, { associationStatus: 'needs_review' }, { deviceId: 'intrare_1' }, { direction: 'Obverse' },
      { matchedBookingId: '' }, { matchedBookingId: 'invalid/path' }, { accurateTime: '2026-02-30T04:30:00Z' },
      { timestampMode: 'instant' }, { clockOffsetSeconds: 0 }, { accurateTime: '2026-10-29 04:30:00' }]) {
      assert.equal(lprTimeCandidates(receiptLprTime({ ...legacyManual, ...patch })).length, 0, JSON.stringify(patch))
    }
    assert.equal(lprTimeCandidates(receiptLprTime({ ...legacyManual, eventTime: 'invalid' })).length, 0)
    assert.equal(lprTimeCandidates(receiptLprTime({ ...legacyManual, eventInstant: '2026-10-29T10:30:00Z' })).length, 0)
  })
  for (const role of ['admin', 'employee', 'entriesOperator']) await check('VN87YLT manual exit / ' + role + ': 1 -> 0 with archived pointer reconciled', async () => {
    await fixture(); const archive = await read('deleted_bookings/archived'), oldReceipt = await read('lpr_events/legacy-manual')
    const body = input(await context(role)), result = await post(body, role)
    assert.equal(result.occupancyChanged, 'decremented'); await totals(0)
    const b = await read('bookings/active'), pointer = await read('lpr_plate_state/' + plate), audit = await read('lpr_events/' + result.lprEventId)
    assert.equal(b.lpr.departedAt, '2026-11-01T15:20:00.000Z'); assert.equal(b.lpr.visitId, 'legacy-manual')
    assert.equal(pointer.bookingId, 'active'); assert.equal(pointer.isInside, false); assert.equal(pointer.visitId, 'legacy-manual')
    assert.equal(audit.adminUid, role + '-fixture'); assert.equal(audit.manual, true); assert.ok(audit.eventTime); assert.ok(audit.eventInstant)
    assert.equal(audit.pointerReconciliation.previousBookingId, 'archived')
    assert.deepEqual(await read('deleted_bookings/archived'), archive); assert.deepEqual(await read('lpr_events/legacy-manual'), oldReceipt)
    await post(body, role); await totals(0)
    await cameraAt('exit', '2026-11-01 15:21:39.521'); await totals(0)
  })
  await check('VN87YLT camera exit with deployed offset: 1 -> 0, same validated repair', async () => {
    await fixture(); process.env.LPR_CAMERA_CLOCK_OFFSETS_SECONDS_JSON = JSON.stringify({ iesire_1: 3206 })
    const result = await cameraAt('exit', '2026-11-01 16:15:05.521')
    await totals(0); const b = await read('bookings/active'), p = await read('lpr_plate_state/' + plate)
    assert.equal(b.lpr.departedAt, '2026-11-01T15:21:39.521Z'); assert.equal(p.bookingId, 'active'); assert.equal(p.isInside, false)
    const event = (await db.collection('lpr_events').where('eventType', '==', 'exit').get()).docs[0].data()
    assert.ok(event.pointerReconciliation)
  })
  await check('manual exit remains safe when an already-refused camera exit is in history', async () => {
    await fixture(); await db.doc('lpr_events/previous-camera-exit').set({ normalizedPlate: plate, eventType: 'exit', deviceId: 'iesire_1', eventTime: '2026-11-01T15:21:39.521Z', eventInstant: '2026-11-01T13:21:39.521Z', associationStatus: 'needs_review', associationReason: 'ambiguous_exit_order' })
    await post(input(await context())); await totals(0)
  })
  await check('new arrival after legacy exit creates one new visit; replay cannot close it', async () => {
    await fixture(); const body = input(await context()); await post(body); await totals(0)
    await cameraAt('entry', '2026-11-01 15:40:00'); await totals(1)
    const b = await read('bookings/active'), p = await read('lpr_plate_state/' + plate)
    assert.notEqual(b.lpr.visitId, 'legacy-manual'); assert.equal(b.lpr.departedAt, null)
    await post(body); await totals(1); assert.deepEqual(await read('lpr_plate_state/' + plate), p)
    await cameraAt('exit', '2026-11-01 15:21:39.521'); await totals(1)
    await cameraAt('exit', '2026-11-01 15:50:00'); await totals(0)
  })
  for (const [name, patch] of [
    ['wrong archive plate', { licensePlate: 'OTHER01' }], ['archive still marked inside', { 'lpr.isInside': true }],
    ['different archive visit', { 'lpr.visitId': 'another-visit' }], ['archive without deletion proof', { deletedReason: 'unknown' }],
    ['archive already restored elsewhere', { restoredLprToBookingId: 'other' }],
    ['archive with later known observation', { 'lpr.lastSeenAt': '2026-11-01T15:30:00Z' }],
  ]) await check(name + ' blocks pointer takeover and leaves all occupancy data unchanged', async () => {
    await fixture(); await db.doc('deleted_bookings/archived').update(patch)
    const before = await snapshots(); await post(input(await context()), 'admin', 409); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('missing archive is not proof permitting a pointer repair', async () => {
    await fixture(); await db.doc('deleted_bookings/archived').delete(); const before = await snapshots()
    await post(input(await context()), 'admin', 409); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('existing live referenced document is never silently replaced', async () => {
    await fixture(); await db.doc('bookings/archived').set({ licensePlate: plate, lpr: { isInside: false } })
    const before = await snapshots(); await post(input(await context()), 'admin', 409); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('archive modification after dialog opening invalidates context', async () => {
    await fixture(); const body = input(await context()); await db.doc('deleted_bookings/archived').update({ restoredLprToBookingId: 'other' })
    const before = await snapshots(); const response = await post(body, 'admin', 409)
    assert.equal(response.code, 'CONTEXT_CHANGED'); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('a later entry receipt still blocks both manual and camera exits', async () => {
    await fixture(); await db.doc('lpr_events/newer-entry').set({ normalizedPlate: plate, eventType: 'entry', eventTime: '2026-11-01T15:30:00Z', eventInstant: '2026-11-01T13:30:00Z', associationStatus: 'needs_review' })
    const before = await snapshots(); await post(input(await context()), 'admin', 409); await totals(1)
    await cameraAt('exit', '2026-11-01 15:21:39.521'); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('unproven manual provenance still blocks exit rather than ignoring the receipt', async () => {
    await fixture(); await db.doc('lpr_events/legacy-manual').update({ direction: 'unknown' })
    const before = await snapshots(); await post(input(await context()), 'admin', 409); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('transaction failure rolls back pointer reconciliation, exit, audit and decrement', async () => {
    await fixture(); const body = input(await context()), before = await snapshots(); failWrite = true
    await post(body, 'admin', 503); await totals(1); assert.deepEqual(await snapshots(), before)
    assert.equal(await read('lpr_events/manual_exit_' + body.requestId), undefined)
    await post(body); await totals(0)
  })
  await check('camera/manual concurrency closes the one legacy stay at most once', async () => {
    await fixture(); const body = input(await context())
    await Promise.all([post(body, 'admin', [200, 409]), cameraAt('exit', '2026-11-01 15:21:39.521')])
    await totals(0); const p = await read('lpr_plate_state/' + plate); assert.equal(p.bookingId, 'active'); assert.equal(p.isInside, false)
  })
  await check('missing pointer is created closed without changing the archive', async () => {
    await fixture(); await db.doc('lpr_plate_state/' + plate).delete(); const archive = await read('deleted_bookings/archived')
    await post(input(await context())); await totals(0); assert.equal((await read('lpr_plate_state/' + plate)).isInside, false)
    assert.deepEqual(await read('deleted_bookings/archived'), archive)
  })
  for (const role of ['admin', 'employee', 'entriesOperator']) await check('CT30WWK corrected legacy arrival / ' + role + ': exit once and audit reconciliation', async () => {
    await correctedArrivalFixture(); const old = await read('lpr_events/legacy-manual')
    const request = input(await context(role)), result = await post(request, role); await totals(0)
    const audit = await read('lpr_events/' + result.lprEventId)
    assert.equal(audit.legacyArrivalReconciliation.reason, 'legacy_manual_arrival_correction')
    assert.equal(audit.legacyArrivalReconciliation.previousPointerAt, '2026-10-29T12:05:37.707Z')
    assert.equal((await read('lpr_plate_state/' + plate)).isInside, false)
    assert.deepEqual(await read('lpr_events/legacy-manual'), old)
    await post(request, role); await totals(0)
  })
  await check('CT30WWK camera exit and repeated exit: 1 -> 0 -> 0', async () => {
    await correctedArrivalFixture(); await cameraAt('exit', '2026-11-01 15:20:00'); await totals(0)
    const exits = await db.collection('lpr_events').where('eventType', '==', 'exit').get()
    assert.ok(exits.docs.some(d => d.data().legacyArrivalReconciliation))
    await cameraAt('exit', '2026-11-01 15:21:00'); await totals(0)
  })
  for (const [name, target, patch] of [
    ['different pointer visit', 'lpr_plate_state/' + plate, { visitId: 'new-stay' }],
    ['pointer already exited', 'lpr_plate_state/' + plate, { isInside: false }],
    ['missing manual provenance', 'lpr_events/legacy-manual', { direction: 'unknown' }],
    ['correction belongs to another booking', 'lpr_events/legacy-manual', { matchedBookingId: 'another' }],
    ['correction belongs to another visit', 'lpr_events/legacy-manual', { visitId: 'new-stay' }],
    ['correction timestamp does not match', 'lpr_events/legacy-manual', { receivedAt: new Date('2026-10-29T09:13:19Z') }],
    ['camera receipt does not match pointer', 'lpr_events/legacy-camera', { accurateTime: '2026-10-29 12:06:37.707' }],
    ['modern inconsistent pointer', 'lpr_plate_state/' + plate, { lastEventId: 'modern-entry' }],
  ]) await check('CT30WWK rejects ' + name + ' without occupancy changes', async () => {
    await correctedArrivalFixture(); await db.doc(target).update(patch); const before = await snapshots()
    await post(input(await context()), 'admin', 409); await totals(1)
    await cameraAt('exit', '2026-11-01 15:20:00'); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('CT30WWK cannot exit before original camera observation or after a later entry receipt', async () => {
    await correctedArrivalFixture(); const before = await snapshots()
    await post(input(await context(), { date: '2026-10-29', time: '11:30:00' }), 'admin', 409)
    await totals(1); assert.deepEqual(await snapshots(), before)
    await db.doc('lpr_events/new-entry').set({ normalizedPlate: plate, eventType: 'entry', eventTime: '2026-11-01T15:30:00Z',
      eventInstant: '2026-11-01T13:30:00Z', associationStatus: 'needs_review' })
    await post(input(await context()), 'admin', 409); await totals(1)
    await cameraAt('exit', '2026-11-01 15:20:00'); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('CT30WWK concurrent edit invalidates context; rollback writes nothing', async () => {
    await correctedArrivalFixture(); const request = input(await context())
    await db.doc('lpr_plate_state/' + plate).update({ visitId: 'reentry' })
    assert.equal((await post(request, 'admin', 409)).code, 'CONTEXT_CHANGED'); await totals(1)
    await correctedArrivalFixture(); failWrite = true; const before = await snapshots()
    await post(input(await context()), 'admin', 503); await totals(1); assert.deepEqual(await snapshots(), before)
  })
  await check('CT30WWK camera/manual race and new stay cannot be closed by replay', async () => {
    await correctedArrivalFixture(); const request = input(await context())
    await Promise.all([post(request, 'admin', [200, 409]), cameraAt('exit', '2026-11-01 15:20:00')]); await totals(0)
    await cameraAt('entry', '2026-11-01 15:40:00'); await totals(1)
    await post(request, 'admin', [200, 409]); await totals(1)
    await cameraAt('exit', '2026-11-01 15:50:00'); await totals(0)
  })
  console.log(`PASS ${passed} legacy manual exit scenarios`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => deleteApp(app))
