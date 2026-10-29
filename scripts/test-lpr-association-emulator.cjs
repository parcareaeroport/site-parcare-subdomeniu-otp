/* Run ONLY against a local Firestore emulator:
 * FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node scripts/test-lpr-association-emulator.cjs
 * Creates synthetic bookings in demo-parking-lpr; never loads production credentials.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Local emulator required')
process.env.LPR_AUTH_SECRET = 'fixture-camera-secret'
process.env.LPR_DEVICES_JSON = JSON.stringify({intrare_1:{direction:'entry',timestampMode:'romania_wall_clock',maxEventAgeMinutes:525600},iesire_1:{direction:'exit',timestampMode:'romania_wall_clock',maxEventAgeMinutes:525600}})
process.env.TZ = 'UTC' // Current deployment/camera convention, not a timezone migration.
const projectId = 'demo-parking-lpr'
const { initializeApp: adminInit, deleteApp: adminDelete } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const adminApp = adminInit({ projectId }, 'lpr-regression')
const adminDb = getFirestore(adminApp)
const { initializeApp, deleteApp } = require('firebase/app')
const sdk = require('firebase/firestore')
const clientApp = initializeApp({ projectId, apiKey: 'emulator-only', appId: 'emulator-only' }, 'lpr-regression')
const clientDb = sdk.getFirestore(clientApp)
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
sdk.connectFirestoreEmulator(clientDb, host, Number(port))
const root = path.resolve(__dirname, '..'), cache = new Map()
function load(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', js)(name => {
    if (name === 'server-only') return {}
    if (name === '@/lib/firebase-admin') return { adminDb }
    if (name === '@/lib/firebase' || name === './firebase') return { db: clientDb }
    if (name === '@/lib/admin-api-auth') return { authorizeAdminRequest: async () => ({ ok: true }) }
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)) + '.ts')
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const { handleLprEvent } = load('lib/lpr-service.ts')
const { prepareManualExit, saveManualExit } = load('lib/manual-lpr-exit.server.ts')
const { saveManualEntry } = load('lib/manual-lpr-entry.server.ts')
async function writeManualLprEvent({bookingId,eventType,eventTimeIsoZ}, context) {
  const ctx = context || await prepareManualExit(bookingId)
  return (eventType === 'entry' ? saveManualEntry : saveManualExit)({entryMode:ctx.inside?"correct_arrival":"new_visit",confirmReentry:!ctx.inside&&!!(ctx.arrival||ctx.departure),bookingId, version:ctx.version,
    requestId:require('node:crypto').randomUUID(), date:eventTimeIsoZ.slice(0,10), time:eventTimeIsoZ.slice(11,19)}, {uid:'fixture',email:'fixture@example.invalid'})
}
function assertOnlyContextConflicts(results) {
  assert.ok(results.some(r => r.status === 'fulfilled'))
  for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 'CONTEXT_CHANGED')
}
const { getDailyExits } = load('lib/admin-stats.ts')
const { getLprPresenceState } = load('lib/lpr-presence.ts')
const { GET: occupancy } = load('app/api/admin/occupancy/route.ts')
const { POST: cameraPost } = load('app/NotificationInfo/TollgateInfo/route.ts')
const { NextRequest } = require('next/server')
let passed = 0
async function check(name, run) { await reset(); await run(); passed++; console.log('PASS', name) }
async function reset() {
  const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' })
  assert.equal(response.ok, true)
  await adminDb.doc('config/parkingLive').set({ occupiedCount: 0 })
  await adminDb.doc('config/reservationSettings').set({ maxTotalReservations: 310 })
}
const base = { licensePlate: 'TEST01', status: 'confirmed_test', startDate: '2026-07-16', startTime: '10:00', endDate: '2026-07-21', endTime: '20:00' }
const seed = (id, patch = {}) => adminDb.doc('bookings/' + id).set({ ...base, ...patch })
const read = async id => (await adminDb.doc('bookings/' + id).get()).data()
const count = async () => (await adminDb.doc('config/parkingLive').get()).data().occupiedCount
const event = (type, at, plate = 'TEST01') => handleLprEvent({ plateNumber: plate, laneNo: 1, snapTime: at, accurateTime: at, deviceId: type === 'entry' ? 'intrare_1' : 'iesire_1', direction: type, raw: { test: true } })
const inside = b => getLprPresenceState(b).isEffectivelyInside
const occupied = async () => (await (await occupancy(new Request('http://localhost/api/admin/occupancy'))).json())
const audit = async r => (await adminDb.doc('lpr_events/' + r.savedEventId).get()).data()
async function main() {
  await check('camera HTTP → July booking → occupancy → overdue exit; old May booking unchanged', async () => {
    await seed('may', { licensePlate: 'B804CTN', startDate: '2026-05-22', endDate: '2026-05-28', lpr: { isInside: false, arrivedAt: '2026-05-22T10:00:00Z', departedAt: '2026-05-28T10:00:00Z' } })
    await seed('july', { licensePlate: 'B804CTN' })
    const old = await read('may')
    const response = await cameraPost(new NextRequest('http://localhost/NotificationInfo/TollgateInfo', { method: 'POST', headers:{Authorization:'Bearer fixture-camera-secret'}, body: JSON.stringify({ Picture: { Plate: { PlateNumber: 'B804CTN' }, SnapInfo: { DeviceID: 'intrare_1', AccurateTime: '2026-07-16T11:00:00Z' } } }) }))
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.matchedBookingId, 'july')
    assert.equal(await count(), 1); assert.equal((await occupied()).occupiedCount, 1)
    assert.equal((await adminDb.doc('lpr_plate_state/B804CTN').get()).data().bookingId, 'july')
    const exit = await event('exit', '2026-07-25T12:00:00Z', 'B804CTN'); assert.equal(exit.matchedBookingId, 'july')
    assert.equal(inside(await read('july')), false); assert.equal(await count(), 0); assert.equal((await occupied()).occupiedCount, 0)
    assert.deepEqual(await read('may'), old)
    assert.equal((await adminDb.collection('bookings/july/gateEvents').get()).size, 2)
  })
  await check('old reservation alone never reopened; unmatched visit closes with duration', async () => {
    await seed('old', { startDate: '2026-05-01', endDate: '2026-05-08' })
    const r = await event('entry', '2026-07-16T10:00:00Z'); assert.notEqual(r.matchedBookingId, 'old')
    assert.equal((await read(r.matchedBookingId)).status, 'unmatched_lpr'); assert.equal((await read('old')).lpr, undefined)
    const x = await event('exit', '2026-07-16T12:00:00Z'); assert.equal(x.matchedBookingId, r.matchedBookingId)
    assert.equal((await read(x.matchedBookingId)).durationMinutes, 120); assert.equal(await count(), 0)
  })
  await check('parallel duplicate entries/exits count exactly once and retain first arrival', async () => {
    await seed('active')
    const rs = await Promise.all(Array.from({ length: 5 }, () => event('entry', '2026-07-16T10:00:00Z')))
    assert.ok(rs.every(r => r.matchedBookingId === 'active' && !r.degraded)); assert.equal(await count(), 1)
    assert.equal((await adminDb.collection('bookings/active/gateEvents').get()).size, 1)
    await event('entry', '2026-07-16T10:01:00Z'); assert.equal((await read('active')).lpr.arrivedAt, '2026-07-16T10:00:00.000Z'); assert.equal(await count(), 1)
    const exits = await Promise.all(Array.from({ length: 4 }, () => event('exit', '2026-07-21T20:00:00Z')))
    assert.ok(exits.every(r => !r.degraded)); assert.equal(await count(), 0)
  })
  await check('out-of-order entry cannot reopen a closed booking', async () => {
    await seed('active'); await event('entry', '2026-07-16T10:00:00Z'); await event('exit', '2026-07-17T10:00:00Z')
    const r = await event('entry', '2026-07-16T10:05:00Z'); assert.equal(r.warning, 'out_of_order_event'); assert.equal(inside(await read('active')), false); assert.equal(await count(), 0)
  })
  await check('reentry in same reservation creates a new visit and clears old departure', async () => {
    await seed('active'); await event('entry', '2026-07-16T10:00:00Z'); const first = (await read('active')).lpr.visitId
    await event('exit', '2026-07-17T10:00:00Z'); await event('entry', '2026-07-18T10:00:00Z')
    const b = await read('active'); assert.notEqual(b.lpr.visitId, first); assert.equal(b.lpr.departedAt, null); assert.equal(inside(b), true); assert.equal(await count(), 1)
    await event('exit', '2026-07-21T20:00:00Z'); assert.equal((await read('active')).lpr.departedAt, '2026-07-21T20:00:00.000Z'); assert.equal(await count(), 0)
  })
  await check('ambiguous reservations stay unchanged with review audit', async () => {
    await seed('a'); await seed('b'); const r = await event('entry', '2026-07-16T10:00:00Z')
    assert.equal(r.warning, 'ambiguous_reservations'); assert.equal((await read('a')).lpr, undefined); assert.equal(await count(), 0); assert.equal((await audit(r)).candidateBookingIds.length, 2)
  })
  await check('multiple legacy inside rows do not choose an arbitrary exit', async () => {
    const lpr = { isInside: true, arrivedAt: '2026-07-16T10:00:00Z' }; await seed('a', { lpr }); await seed('b', { lpr })
    const r = await event('exit', '2026-07-21T20:00:00Z'); assert.equal(r.warning, 'multiple_open_visits'); assert.equal(inside(await read('a')), true)
  })
  await check('unique legacy overdue visit can exit without a pointer', async () => {
    await seed('a', { lpr: { isInside: true, arrivedAt: '2026-07-16T10:00:00Z' }, occupancyIncremented: true }); await adminDb.doc('config/parkingLive').set({ occupiedCount: 1 })
    const r = await event('exit', '2026-08-01T10:00:00Z'); assert.equal(r.matchedBookingId, 'a'); assert.equal(await count(), 0)
  })
  await check('new reservation does not silently take over an existing open visit', async () => {
    await seed('a'); await event('entry', '2026-07-16T10:00:00Z'); await seed('b', { startDate: '2026-08-01', endDate: '2026-08-05' })
    const r = await event('entry', '2026-08-01T10:00:00Z'); assert.equal(r.warning, 'open_visit_conflicts_with_reservation'); assert.equal((await read('b')).lpr, undefined)
  })
  await check('manual exit and camera replay stay outside; manual entry then camera exit closes same row', async () => {
    await seed('active'); await event('entry', '2026-07-16T10:00:00Z')
    const m = await writeManualLprEvent({ bookingId: 'active', plateNumber: 'TEST01', eventType: 'exit', eventTimeIsoZ: '2026-07-17T10:00:00Z' })
    assert.equal(m.occupancyChanged, 'decremented'); assert.equal(await count(), 0)
    assert.equal((await event('entry', '2026-07-16T10:01:00Z')).warning, 'out_of_order_event')
    await writeManualLprEvent({ bookingId: 'active', plateNumber: 'TEST01', eventType: 'entry', eventTimeIsoZ: '2026-07-18T10:00:00Z' })
    assert.equal(await count(), 1); const r = await event('exit', '2026-07-19T10:00:00Z'); assert.equal(r.matchedBookingId, 'active'); assert.equal(await count(), 0)
  })
  await check('manual duplicate concurrent exits decrement once', async () => {
    await seed('active'); await event('entry', '2026-07-16T10:00:00Z')
    const ctx = await prepareManualExit('active')
    assertOnlyContextConflicts(await Promise.allSettled(Array.from({ length: 3 }, () => writeManualLprEvent({ bookingId: 'active', eventType: 'exit', eventTimeIsoZ: '2026-07-17T10:00:00Z' }, ctx))))
    assert.equal(await count(), 0); assert.equal(inside(await read('active')), false)
  })
  await check('daily exits and occupancy agree when old departure precedes latest entry', async () => {
    await seed('legacy', { lpr: { isInside: true, arrivedAt: '2026-05-01T10:00:00Z', departedAt: '2026-05-05T10:00:00Z', lastEventType: 'entry', lastSeenAt: '2026-07-16T10:00:00Z' } })
    const rows = await getDailyExits('2026-07-21'); assert.equal(rows.length, 1); assert.equal(rows[0].actualTime, undefined); assert.equal(rows[0].hasArrived, true); assert.equal((await occupied()).occupiedCount, 1)
  })
  await check('plate normalization supports legacy spaces and lowercase', async () => {
    await seed('active', { licensePlate: 'Test-01' }); const r = await event('entry', '2026-07-16T10:00:00Z', 'test 01'); assert.equal(r.matchedBookingId, 'active')
    assert.equal((await event('exit', '2026-07-21T20:00:00Z')).matchedBookingId, 'active')
  })
  await check('cancelled booking excluded; unknown event and invalid timestamp never change occupancy', async () => {
    await seed('cancelled', { status: 'cancelled' }); const r = await event('entry', '2026-07-16T10:00:00Z'); assert.notEqual(r.matchedBookingId, 'cancelled')
    const invalid = await event('exit', 'bad'); assert.equal(invalid.warning, 'invalid_event_time'); assert.equal(await count(), 1)
    const unknown = await handleLprEvent({ plateNumber: 'TEST01', deviceId: 'camera', direction: null, snapTime: '2026-07-17T10:00:00Z', accurateTime: null, laneNo: null }); assert.equal(unknown.warning, 'unknown_direction'); assert.equal(await count(), 1)
  })
  await check('whitelist creates neither visit nor occupancy', async () => {
    await adminDb.doc('lpr_whitelist/TEST01').set({}); const r = await event('entry', '2026-07-16T10:00:00Z'); assert.equal((await audit(r)).associationStatus, 'whitelist_skip'); assert.equal(await count(), 0)
  })
  await check('two-hour tolerance includes previous calendar day and rejects beyond boundary', async () => {
    await seed('midnight', { startDate: '2026-07-17', startTime: '00:30', endDate: '2026-07-17', endTime: '01:00' })
    assert.equal((await event('entry', '2026-07-16T22:30:00Z')).matchedBookingId, 'midnight')
    await event('exit', '2026-07-17T01:00:00Z')
    assert.notEqual((await event('entry', '2026-07-17T03:00:01Z')).matchedBookingId, 'midnight')
  })
  await check('failed transaction leaves booking, counter and gate audit unchanged', async () => {
    await seed('active')
    const original = adminDb.runTransaction.bind(adminDb)
    adminDb.runTransaction = callback => original(async tx => { await callback(tx); throw new Error('injected commit abort') })
    let r
    try { r = await event('entry', '2026-07-16T10:00:00Z') } finally { adminDb.runTransaction = original }
    assert.equal(r.degraded, true); assert.equal((await read('active')).lpr, undefined); assert.equal(await count(), 0)
    assert.equal((await adminDb.collection('bookings/active/gateEvents').get()).size, 0)
    assert.equal((await audit(r)).associationStatus, 'pending') // A total outage can also prevent the failure annotation.
    assert.equal((await event('entry', '2026-07-16T10:00:00Z')).matchedBookingId, 'active')
    assert.equal(await count(), 1)
  })
  await check('manual and camera exits racing decrement once', async () => {
    await seed('active'); await event('entry', '2026-07-16T10:00:00Z')
    const ctx = await prepareManualExit('active')
    assertOnlyContextConflicts(await Promise.allSettled([event('exit', '2026-07-17T10:00:00Z'), writeManualLprEvent({ bookingId: 'active', eventType: 'exit', eventTimeIsoZ: '2026-07-17T10:00:00Z' }, ctx)]))
    assert.equal(await count(), 0); assert.equal(inside(await read('active')), false)
  })
  await check('legacy reopened old reservation is quarantined on repeated entry', async () => {
    await seed('may', { startDate: '2026-05-01', endDate: '2026-05-08', lpr: { isInside: true, arrivedAt: '2026-05-01T10:00:00Z', departedAt: '2026-05-08T10:00:00Z', lastSeenAt: '2026-07-01T10:00:00Z', lastEventType: 'entry' } })
    const before = await read('may'); const r = await event('entry', '2026-07-16T10:00:00Z')
    assert.equal(r.warning, 'legacy_open_visit_outside_period'); assert.deepEqual(await read('may'), before)
  })
  await check('naive camera timestamps are stable across host timezone', async () => {
    await seed('active'); process.env.TZ = 'Europe/Bucharest'
    try { const r = await event('entry', '2026-07-16 08:00:00'); assert.equal(r.matchedBookingId, 'active'); assert.equal((await read('active')).lpr.arrivedAt, '2026-07-16T08:00:00.000Z') } finally { process.env.TZ = 'UTC' }
  })
  await check('equal-time opposing event is reviewed without changing state', async () => {
    await seed('active'); await event('entry', '2026-07-16T10:00:00Z')
    assert.equal((await event('exit', '2026-07-16T10:00:00Z')).warning, 'simultaneous_event_requires_review'); assert.equal(await count(), 1)
  })
  await check('unknown exit never edits an unused reservation', async () => {
    await seed('active'); assert.equal((await event('exit', '2026-07-21T20:00:00Z')).warning, 'exit_without_open_visit'); assert.equal((await read('active')).lpr, undefined)
  })
  await check('different plates arriving concurrently keep their own booking and total occupancy', async () => {
    await Promise.all(['ONE', 'TWO', 'THREE'].map(plate => seed(plate, { licensePlate: plate })))
    const results = await Promise.all(['ONE', 'TWO', 'THREE'].map(plate => event('entry', '2026-07-16T10:00:00Z', plate)))
    assert.deepEqual(results.map(r => r.matchedBookingId), ['ONE', 'TWO', 'THREE']); assert.equal(await count(), 3)
    await Promise.all(['ONE', 'TWO', 'THREE'].map(plate => event('exit', '2026-07-21T20:00:00Z', plate)))
    assert.equal(await count(), 0)
  })
  await check('concurrent unmatched entries create only one visit', async () => {
    const results = await Promise.all(Array.from({ length: 3 }, () => event('entry', '2026-07-16T10:00:00Z')))
    assert.ok(results.every(r => !r.degraded && r.matchedBookingId === results[0].matchedBookingId)); assert.equal((await adminDb.collection('bookings').get()).size, 1); assert.equal(await count(), 1)
  })
  console.log(`\n${passed} emulator flow scenarios passed (real Admin/client SDKs, synthetic reservations).`)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { await sdk.terminate(clientDb); await deleteApp(clientApp); await adminDelete(adminApp) })
