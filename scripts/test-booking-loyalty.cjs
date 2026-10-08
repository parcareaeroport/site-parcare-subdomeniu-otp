const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
function load(file, mocks) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require: id => { if (!(id in mocks))
        throw Error(`Unexpected import ${id}`); return mocks[id]; }, Date, Error, console: { error() { }, warn() { } }, Number, String, Boolean, Promise }); return exports; }
const config = { enabled: true, reservationsPerFreeDay: 4, freeDayHours: 24, maxBillableDaysForAutoRedeem: 1 };
const shared = { DEFAULT_LOYALTY_PROGRAM: config, getLoyaltyProgramFromSettings: x => ({ ...config, ...x?.loyaltyProgram }) };
const state = load('lib/loyalty-state.ts', { '@/lib/mobile-app-settings.shared': shared });
const plain = x => JSON.parse(JSON.stringify(x)), zero = { points: 0, reservationsCount: 0, freeDaysAvailable: 0, pointsToRecover: 0 };
function memoryDb(seed) {
    const rows = new Map(Object.entries(plain(seed)));
    let tail = Promise.resolve();
    const db = { failProfileWrite: false };
    function ref(key) { return { path: key, id: key.split('/')[1], parent: { id: key.split('/')[0] }, get: async () => snap(key) }; }
    function snap(key) { return { exists: rows.has(key), data: () => plain(rows.get(key) || null), ref: ref(key) }; }
    db.collection = name => ({ doc: id => ref(`${name}/${id}`) });
    db.runTransaction = fn => {
        const run = tail.then(async () => {
            const changes = [];
            const tx = { get: async (r) => { assert.equal(changes.length, 0, 'reads before writes'); return snap(r.path); }, update: (r, d) => { assert.ok(rows.has(r.path)); changes.push(['update', r.path, d]); }, set: (r, d, o) => changes.push([o?.merge ? 'update' : 'set', r.path, d]), delete: r => changes.push(['delete', r.path]) };
            const result = await fn(tx);
            if (db.failProfileWrite && changes.some(([, k]) => /^(users|guests)\//.test(k))) {
                db.failProfileWrite = false;
                throw Error('commit failure');
            }
            for (const [op, key, data] of changes) {
                if (op === 'delete') {
                    rows.delete(key);
                    continue;
                }
                const next = op === 'set' ? {} : plain(rows.get(key) || {});
                for (const [field, value] of Object.entries(data)) {
                    const parts = field.split('.');
                    let target = next;
                    for (const part of parts.slice(0, -1))
                        target = target[part] ||= {};
                    const last = parts.at(-1);
                    target[last] = value?.__increment !== undefined ? (target[last] || 0) + value.__increment : value;
                }
                rows.set(key, plain(next));
            }
            return result;
        });
        tail = run.catch(() => { });
        return run;
    };
    db.row = key => plain(rows.get(key) || null);
    return db;
}
function fixture(overrides = {}, opts = {}) {
    const record = { version: 1, processingStatus: 'processed', profileCollection: 'users', userId: 'u', pointsAwarded: 1, freeDaysUsed: 0, reservationsPerFreeDay: 4 };
    const booking = { bookingOrigin: 'mobile-app', userId: 'u', apiSuccess: true, status: 'confirmed_paid', apiBookingNumber: '123', source: 'webhook', loyaltyRecord: record, ...overrides };
    const db = memoryDb({ 'bookings/b': booking, 'users/u': { loyalty: { points: 4, reservationsCount: 0, freeDaysAvailable: 1 } }, 'config/reservationStats': { activeBookingsCount: 1 }, ...opts.rows });
    let calls = 0;
    const reversal = load('lib/booking-loyalty-reversal.ts', { '@/lib/firebase-admin': { adminDb: db }, '@/lib/loyalty-state': state, '@/lib/mobile-app-settings.shared': shared });
    const coordinator = load('lib/admin-booking-cancellation.ts', { 'node:crypto': require('node:crypto'), '@/lib/firebase-admin': { adminDb: db }, '@/lib/booking-loyalty-reversal': reversal, '@/app/actions/booking-actions': { cancelBooking: async () => { calls++; if (opts.delay)
                await opts.delay(); return { success: !opts.failMultipark, message: 'Multipark failed' }; } } });
    const mocks = { 'next/server': { NextResponse: { json: (body, o) => ({ body, status: o?.status || 200 }) } }, 'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => new Date(), increment: x => ({ __increment: x }) } }, '@/lib/firebase-admin': { adminDb: db }, '@/lib/admin-api-auth': { authorizeAdminRequest: async () => opts.denied ? { ok: false, response: { status: 403 } } : { ok: true, user: { uid: 'admin' } } }, '@/lib/booking-loyalty-reversal': reversal, '@/lib/admin-booking-cancellation': coordinator };
    const cancel = load('app/api/admin/bookings/cancel/route.ts', mocks), del = load('app/api/admin/bookings/delete/route.ts', mocks);
    const program = load('lib/loyalty-program.ts', { '@/lib/loyalty-state': state, '@/lib/mobile-app-settings.shared': shared, '@/lib/server-firestore': { db, doc: (_db, col, id) => db.collection(col).doc(id), getDoc: async (r) => { const s = await r.get(); return { exists: () => s.exists, data: s.data }; }, runTransaction: (_db, fn) => db.runTransaction(fn) }, '@/lib/booking-pricing': {}, '@/lib/pricing-settings': {}, '@/lib/mobile-app-settings': shared });
    const request = { json: async () => ({ bookingId: 'b', reason: 'test' }) };
    return { db, program, cancel: () => cancel.POST(request), delete: () => del.POST(request), calls: () => calls };
}
test('3 → 4 → cancellation restores 3 and removes reward', () => { const fourth = state.advanceLoyaltyAfterBooking({ ...zero, points: 3, reservationsCount: 3 }, config); assert.deepEqual(plain(state.reverseLoyaltyAfterBooking(fourth, 4)), { ...zero, points: 3, reservationsCount: 3 }); });
test('spent reward creates debt and requires five future reservations', () => { let n = state.reverseLoyaltyAfterBooking({ ...zero, points: 4 }, 4); assert.equal(n.pointsToRecover, 1); assert.equal(state.computeLoyaltyProgress(n, config).remaining, 5); for (let i = 0; i < 4; i++)
    n = state.advanceLoyaltyAfterBooking(n, config); assert.equal(n.freeDaysAvailable, 0); assert.equal(n.reservationsCount, 3); assert.equal(state.advanceLoyaltyAfterBooking(n, config).freeDaysAvailable, 1); });
test('multiple cancellations accumulate debt after existing progress is removed', () => { let n = state.reverseLoyaltyAfterBooking({ ...zero, points: 6, reservationsCount: 1 }, 4); assert.equal(n.pointsToRecover, 0); n = state.reverseLoyaltyAfterBooking(n, 4); n = state.reverseLoyaltyAfterBooking(n, 4); assert.equal(state.computeLoyaltyProgress(n, config).remaining, 6); });
test('consumed day returned before reversal; points never negative', () => { const n = state.reverseLoyaltyAfterBooking({ ...zero, points: 5, reservationsCount: 1 }, 4, 1); assert.equal(n.freeDaysAvailable, 1); assert.equal(n.reservationsCount, 0); assert.equal(state.reverseLoyaltyAfterBooking(zero, 4).points, 0); });
test('cancel, repeat and delete reverse only once and archive audit', async () => { const f = fixture(); assert.equal((await f.cancel()).status, 200); assert.equal(f.db.row('users/u').loyalty.reservationsCount, 3); assert.equal(f.db.row('config/reservationStats').activeBookingsCount, 0); assert.equal((await f.cancel()).body.alreadyCancelled, true); assert.equal(f.calls(), 1); assert.equal((await f.delete()).status, 200); assert.equal(f.db.row('users/u').loyalty.points, 3); assert.ok(f.db.row('deleted_bookings/b').loyaltyRecord.reversedAt); assert.equal((await f.delete()).status, 404); });
test('direct delete reverses and archives', async () => { const f = fixture(); assert.equal((await f.delete()).status, 200); assert.equal(f.db.row('users/u').loyalty.freeDaysAvailable, 0); assert.equal(f.db.row('deleted_bookings/b').loyaltyRecord.reversalStatus, 'reversed'); });
test('guests and pay-on-site cancel locally', async () => { const f = fixture({ source: 'pay_on_site', status: 'confirmed_pay_on_site', loyaltyRecord: { profileCollection: 'guests', userId: 'g', pointsAwarded: 1, freeDaysUsed: 0, reservationsPerFreeDay: 4 } }, { rows: { 'guests/g': { loyalty: { points: 4, reservationsCount: 0, freeDaysAvailable: 1 } } } }); assert.equal((await f.cancel()).status, 200); assert.equal(f.calls(), 0); assert.equal(f.db.row('guests/g').loyalty.reservationsCount, 3); assert.equal(f.db.row('bookings/b').payOnSiteStatus, 'cancelled'); });
test('Multipark failure preserves booking and points', async () => { const f = fixture({}, { failMultipark: true }); assert.equal((await f.cancel()).status, 502); assert.equal(f.db.row('bookings/b').status, 'confirmed_paid'); assert.equal(f.db.row('users/u').loyalty.points, 4); });
test('commit failure retries without repeating successful Multipark call', async () => { const f = fixture(); f.db.failProfileWrite = true; assert.equal((await f.cancel()).status, 500); assert.equal(f.db.row('users/u').loyalty.points, 4); assert.equal((await f.cancel()).status, 200); assert.equal(f.calls(), 1); });
test('simultaneous cancel/delete serialized before external call', async () => { let release; const wait = new Promise(r => release = r); const f = fixture({}, { delay: () => wait }), first = f.cancel(); while (!f.calls())
    await new Promise(r => setImmediate(r)); assert.equal((await f.delete()).status, 409); release(); assert.equal((await first).status, 200); assert.equal(f.db.row('users/u').loyalty.points, 3); assert.equal(f.calls(), 1); });
test('legacy unique owner reverses; ambiguous owner flagged', async () => { const f = fixture({ loyaltyRecord: undefined }); assert.equal((await f.cancel()).body.loyaltyStatus, 'reversed'); assert.equal(f.db.row('bookings/b').loyaltyRecord.reversalBasis, 'legacy_eligibility'); const g = fixture({ loyaltyRecord: undefined }, { rows: { 'guests/u': { loyalty: zero } } }); assert.equal((await g.cancel()).body.loyaltyStatus, 'needs_review'); assert.equal(g.db.row('users/u').loyalty.points, 4); });
test('historic cancelled and nonmobile records untouched', async () => { for (const data of [{ status: 'cancelled_by_admin', loyaltyRecord: undefined }, { bookingOrigin: 'web', loyaltyRecord: undefined }]) {
    const f = fixture(data);
    await f.cancel();
    assert.equal(f.db.row('users/u').loyalty.points, 4);
} });
test('award and redemption atomic and idempotent, cancellation returns consumed day', async () => { const f = fixture({ loyaltyRecord: { processingStatus: 'pending', pointsAwarded: 0, freeDaysUsed: 0 } }), args = { userId: 'u', bookingOrigin: 'mobile-app', apiSuccess: true, status: 'confirmed_paid', billableDays: 1, loyaltyFreeDayApplied: true, firestoreId: 'b' }; await Promise.all([f.program.processLoyaltyForCompletedMobileBooking(args), f.program.processLoyaltyForCompletedMobileBooking(args)]); assert.equal(f.db.row('users/u').loyalty.points, 5); assert.equal(f.db.row('users/u').loyalty.freeDaysAvailable, 0); assert.equal(f.db.row('bookings/b').loyaltyRecord.freeDaysUsed, 1); await f.cancel(); assert.equal(f.db.row('users/u').loyalty.points, 4); assert.equal(f.db.row('users/u').loyalty.freeDaysAvailable, 1); });
test('cancellation before deferred award never subtracts an unawarded point', async () => { const f = fixture({ loyaltyRecord: { processingStatus: 'pending', pointsAwarded: 0, freeDaysUsed: 0 } }); await f.cancel(); await f.program.processLoyaltyForCompletedMobileBooking({ userId: 'u', bookingOrigin: 'mobile-app', apiSuccess: true, status: 'confirmed_paid', firestoreId: 'b' }); assert.equal(f.db.row('users/u').loyalty.points, 4); });
test('authorization rejected before external call or writes', async () => { const f = fixture({}, { denied: true }); assert.equal((await f.cancel()).status, 403); assert.equal((await f.delete()).status, 403); assert.equal(f.calls(), 0); assert.equal(f.db.row('bookings/b').adminCancellation, undefined); });

test('award commit failure changes neither profile nor audit, retry succeeds once', async () => {
    const f = fixture({ loyaltyRecord: { processingStatus: 'pending', pointsAwarded: 0, freeDaysUsed: 0 } });
    const args = { userId: 'u', bookingOrigin: 'mobile-app', apiSuccess: true, status: 'confirmed_paid', firestoreId: 'b' };
    f.db.failProfileWrite = true;
    await assert.rejects(f.program.processLoyaltyForCompletedMobileBooking(args));
    assert.equal(f.db.row('users/u').loyalty.points, 4);
    assert.equal(f.db.row('bookings/b').loyaltyRecord.processingStatus, 'pending');
    await f.program.processLoyaltyForCompletedMobileBooking(args);
    assert.equal(f.db.row('users/u').loyalty.points, 5);
});

test('recorded threshold used for reversal; disabled program still reverses past award', async () => {
    const f = fixture({ loyaltyRecord: { profileCollection: 'users', userId: 'u', pointsAwarded: 1, freeDaysUsed: 0, reservationsPerFreeDay: 6 } }, {
        rows: { 'config/mobileAppSettings': { loyaltyProgram: { enabled: false, reservationsPerFreeDay: 4 } } },
    });
    assert.equal((await f.cancel()).status, 200);
    assert.equal(f.db.row('users/u').loyalty.reservationsCount, 5);
});

test('disabled program records no award and cancellation preserves balances', async () => {
    const f = fixture({ loyaltyRecord: { processingStatus: 'pending', pointsAwarded: 0, freeDaysUsed: 0 } }, {
        rows: { 'config/mobileAppSettings': { loyaltyProgram: { enabled: false } } },
    });
    await f.program.processLoyaltyForCompletedMobileBooking({ userId: 'u', bookingOrigin: 'mobile-app', apiSuccess: true, status: 'confirmed_paid', firestoreId: 'b' });
    assert.equal(f.db.row('bookings/b').loyaltyRecord.pointsAwarded, 0);
    await f.cancel();
    assert.equal(f.db.row('users/u').loyalty.points, 4);
});
