const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
function load(file, mocks) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require: id => { if (!(id in mocks))
        throw Error(`Unexpected import ${id}`); return mocks[id]; }, Date, Error, console: { error() { }, warn() { } }, Number, String, Boolean, Promise, URL }); return exports; }
const config = { enabled: true, reservationsPerFreeDay: 4, freeDayHours: 24, maxBillableDaysForAutoRedeem: 1 };
const shared = { DEFAULT_LOYALTY_PROGRAM: config, getLoyaltyProgramFromSettings: x => ({ ...config, ...x?.loyaltyProgram }) };
const state = load('lib/loyalty-state.ts', { '@/lib/mobile-app-settings.shared': shared });
const plain = x => JSON.parse(JSON.stringify(x)), zero = { points: 0, reservationsCount: 0, freeDaysAvailable: 0, pointsToRecover: 0 };
function memoryDb(seed) {
    const rows = new Map(Object.entries(plain(seed)));
    let tail = Promise.resolve();
    const db = { failProfileWrite: false, failMarkerWrite: false, writeCount: 0 };
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
            if (db.failMarkerWrite && changes.some(([, , data]) => data?.['adminCancellation.multiparkCompleted'] === true)) {
                db.failMarkerWrite = false;
                throw Error('marker commit failure');
            }
            db.writeCount += changes.length;
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
                await opts.delay(); if (opts.throwMultipark) throw Error('network interruption'); return { success: !opts.failMultipark, outcomeUnknown: opts.outcomeUnknown === true, message: 'Multipark failed' }; } } });
    const mocks = { 'next/server': { NextResponse: { json: (body, o) => ({ body, status: o?.status || 200, headers: o?.headers || {} }) } }, 'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => new Date(), increment: x => ({ __increment: x }) } }, '@/lib/firebase-admin': { adminDb: db }, '@/lib/admin-api-auth': { authorizeAdminRequest: async () => opts.denied ? { ok: false, response: { status: 403 } } : { ok: true, user: { uid: 'admin' } } }, '@/lib/booking-loyalty-reversal': reversal, '@/lib/admin-booking-cancellation': coordinator };
    const cancel = load('app/api/admin/bookings/cancel/route.ts', mocks), del = load('app/api/admin/bookings/delete/route.ts', mocks);
    const program = load('lib/loyalty-program.ts', { '@/lib/loyalty-state': state, '@/lib/mobile-app-settings.shared': shared, '@/lib/server-firestore': { db, doc: (_db, col, id) => db.collection(col).doc(id), getDoc: async (r) => { const s = await r.get(); return { exists: () => s.exists, data: s.data }; }, runTransaction: (_db, fn) => db.runTransaction(fn) }, '@/lib/booking-pricing': {}, '@/lib/pricing-settings': {}, '@/lib/mobile-app-settings': shared });
    const preview = load('app/api/admin/bookings/cancel-preview/route.ts', mocks);
    const request = { json: async () => ({ bookingId: 'b', reason: 'test' }) };
    return { db, program, previewRoute: preview.GET, cancelRoute: cancel.POST, preview: (id = 'b') => preview.GET({ url: 'http://localhost/api/admin/bookings/cancel-preview?bookingId=' + encodeURIComponent(id) }), cancel: () => cancel.POST(request), delete: () => del.POST(request), calls: () => calls };
}

module.exports = { fixture, state, plain, zero, config, load, memoryDb };
