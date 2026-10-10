const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, state, plain, zero, config, load } = require('./booking-loyalty-fixture.cjs');
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

test('preview is read-only, no-store and agrees with the applied result', async () => {
    const f = fixture({ clientName: 'Ion Popescu' });
    const before = f.db.row('bookings/b');
    const preview = await f.preview();
    assert.equal(preview.status, 200);
    assert.match(preview.headers['Cache-Control'], /no-store/);
    assert.equal(f.db.writeCount, 0);
    assert.equal(f.calls(), 0);
    assert.deepEqual(f.db.row('bookings/b'), before);
    assert.equal(preview.body.loyalty.clientLabel, 'Ion Popescu');
    assert.equal(preview.body.loyalty.before.points, 4);
    assert.equal(preview.body.loyalty.after.points, 3);
    const applied = await f.cancel();
    assert.deepEqual(plain(applied.body.loyalty), plain(preview.body.loyalty));
});

test('confirmation recalculates if balance changed since preview', async () => {
    const f = fixture();
    assert.equal((await f.preview()).body.loyalty.after.points, 3);
    await f.db.runTransaction(async tx => tx.update(f.db.collection('users').doc('u'), {
        loyalty: { points: 5, reservationsCount: 1, freeDaysAvailable: 1 },
    }));
    const applied = await f.cancel();
    assert.equal(applied.body.loyalty.before.points, 5);
    assert.equal(applied.body.loyalty.after.points, 4);
    assert.equal(f.db.row('users/u').loyalty.points, 4);
});

test('preview represents debt, returned days, zero awards and ambiguous profiles truthfully', async () => {
    const debt = fixture({}, { rows: { 'users/u': { loyalty: { points: 4, reservationsCount: 0, freeDaysAvailable: 0 } } } });
    assert.equal((await debt.preview()).body.loyalty.pointsToRecoverAdded, 1);
    const returned = fixture({ loyaltyRecord: { profileCollection: 'users', userId: 'u', pointsAwarded: 1, freeDaysUsed: 1, reservationsPerFreeDay: 4 } }, {
        rows: { 'users/u': { loyalty: { points: 5, reservationsCount: 1, freeDaysAvailable: 0 } } },
    });
    assert.equal((await returned.preview()).body.loyalty.freeDaysReturned, 1);
    assert.equal((await returned.preview()).body.loyalty.after.freeDaysAvailable, 1);
    const noAward = fixture({ loyaltyRecord: { profileCollection: 'users', userId: 'u', pointsAwarded: 0, freeDaysUsed: 0 } });
    assert.equal((await noAward.preview()).body.loyalty.after.points, 4);
    const ambiguous = fixture({ loyaltyRecord: undefined }, { rows: { 'guests/u': { loyalty: zero } } });
    const unknown = (await ambiguous.preview()).body.loyalty;
    assert.equal(unknown.status, 'needs_review');
    assert.equal(unknown.before, null);
    assert.equal(unknown.after, null);
    assert.equal(ambiguous.db.writeCount, 0);
});

test('noneligible booking reports unchanged known balance and email fallback', async () => {
    const f = fixture({ bookingOrigin: 'web', loyaltyRecord: undefined, clientEmail: 'client@example.test' });
    const impact = (await f.preview()).body.loyalty;
    assert.equal(impact.status, 'not_eligible');
    assert.equal(impact.clientLabel, 'client@example.test');
    assert.equal(impact.before.points, 4);
    assert.equal(impact.after.points, 4);
});

test('lost Multipark success marker blocks cancel and delete retries instead of replaying', async () => {
    const f = fixture();
    f.db.failMarkerWrite = true;
    assert.equal((await f.cancel()).body.code, 'MULTIPARK_CANCELLATION_UNCERTAIN');
    assert.equal(f.db.row('bookings/b').adminCancellation.multiparkStatus, 'requested');
    assert.equal((await f.cancel()).status, 409);
    assert.equal((await f.delete()).status, 409);
    assert.equal(f.calls(), 1);
    assert.equal(f.db.row('users/u').loyalty.points, 4);
    const preview = await f.preview();
    assert.equal(preview.body.canConfirm, false);
    assert.match(preview.body.blockingMessage, /incert/);
});

test('transport interruption or unknown response preserves intent and blocks replay', async () => {
    for (const opts of [{ throwMultipark: true }, { failMultipark: true, outcomeUnknown: true }]) {
        const f = fixture({}, opts);
        assert.equal((await f.cancel()).status, 409);
        assert.equal((await f.cancel()).status, 409);
        assert.equal(f.calls(), 1);
        assert.equal(f.db.row('users/u').loyalty.points, 4);
    }
});

test('definitive rejection allows retry, but timed-out lease with unconfirmed intent does not', async () => {
    const f = fixture({}, { failMultipark: true });
    assert.equal((await f.cancel()).status, 502);
    assert.equal(f.db.row('bookings/b').adminCancellation.multiparkStatus, 'rejected');
    assert.equal((await f.preview()).body.canConfirm, true);
    assert.equal((await f.cancel()).status, 502);
    assert.equal(f.calls(), 2);
    const interrupted = fixture({ adminCancellation: { multiparkStatus: 'requested', expiresAt: 0 } });
    assert.equal((await interrupted.cancel()).status, 409);
    assert.equal(interrupted.calls(), 0);
});

test('preview rejects non-admins, invalid identifiers and missing records without writes', async () => {
    const denied = fixture({}, { denied: true });
    assert.equal((await denied.preview()).status, 403);
    assert.equal(denied.db.writeCount, 0);
    const f = fixture();
    assert.equal((await f.preview('missing')).status, 404);
    assert.equal((await f.preview('')).status, 400);
    assert.equal((await f.preview('a/b')).status, 400);
    assert.equal(f.db.writeCount, 0);
});

test('success wording uses the actual returned balance, including changed rewards', async () => {
    const wording = load('lib/booking-cancellation-types.ts', {});
    const f = fixture({ clientName: 'Ion Popescu' });
    const result = await f.cancel();
    assert.match(wording.formatCancellationLoyaltyResult(result.body.loyalty), /Ion Popescu: 4 → 3 puncte/);
    assert.match(wording.formatCancellationLoyaltyResult(result.body.loyalty), /1 → 0/);
});

test('Multipark adapter distinguishes rejection from timeout, HTTP failure and malformed XML', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const vm = require('node:vm');
    const ts = require('typescript');
    const source = fs.readFileSync(path.join(__dirname, '../app/actions/booking-actions.ts'), 'utf8');
    const start = source.indexOf('export async function cancelBooking(');
    const code = ts.transpileModule(source.slice(start, source.indexOf('\n/**', start)), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    for (const [reply, expectedUnknown, success] of [
        [{ ok: true, text: async () => '<ErrorCode>1</ErrorCode>' }, undefined, true],
        [{ ok: true, text: async () => '<ErrorCode>9</ErrorCode><Message>Rejected</Message>' }, false, false],
        [{ ok: true, text: async () => '<invalid/>' }, true, false],
        [{ ok: false, status: 503, statusText: 'Unavailable' }, true, false],
        [new Error('Timeout'), true, false],
    ]) {
        const exports = {};
        vm.runInNewContext(code, {
            exports, API_CONFIG: { url: 'http://test.invalid', username: 'test', password: 'test', multiparkId: 'test' },
            Buffer, AbortController, setTimeout, clearTimeout,
            console: { error() {} },
            fetch: async () => { if (reply instanceof Error) throw reply; return reply; },
        });
        const result = await exports.cancelBooking('test');
        assert.equal(result.success, success);
        assert.equal(result.outcomeUnknown, expectedUnknown);
    }
});
