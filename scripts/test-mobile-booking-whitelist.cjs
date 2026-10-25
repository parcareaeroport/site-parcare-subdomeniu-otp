const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks, errors = []) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(id) {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`);
    return mocks[id];
  }, console: { info() {}, warn() {}, error(...args) { errors.push(args); } }, performance, Date, Error });
  return exports;
}
const normalizeLicensePlate = value => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
function whitelist({ listed = true, failure = false } = {}) {
  const reads = [], errors = [];
  const api = load('lib/mobile-booking-whitelist.ts', {
    '@/lib/utils': { normalizeLicensePlate },
    '@/lib/firebase-admin': { adminDb: { collection(name) {
      assert.equal(name, 'lpr_whitelist');
      return { doc(plate) { return { async get() {
        reads.push(plate);
        if (failure) throw Object.assign(new Error('unavailable'), { code: 14 });
        return { exists: listed };
      } }; } };
    } } },
  }, errors);
  return { api, reads, errors };
}
for (const plate of ['B40DEX', 'b40dex', ' b 40-dex. ']) {
  test(`whitelist uses only normalized document: ${plate}`, async () => {
    const g = whitelist();
    assert.equal(await g.api.isMobileBookingPlateBlocked(plate), true);
    assert.deepEqual(g.reads, ['B40DEX']);
  });
}
test('unlisted plate continues; read failure continues and logs', async () => {
  const clear = whitelist({ listed: false });
  assert.equal(await clear.api.isMobileBookingPlateBlocked('B1ABC'), false);
  const failed = whitelist({ failure: true });
  assert.equal(await failed.api.isMobileBookingPlateBlocked('B1ABC'), false);
  assert.equal(failed.errors.length, 1);
});
test('unchanged existing plate and empty input never read the whitelist', async () => {
  const g = whitelist();
  assert.equal(await g.api.isMobileBookingPlateBlocked(' b40-dex ', 'B40DEX'), false);
  assert.equal(await g.api.isMobileBookingPlateBlocked(''), false);
  assert.deepEqual(g.reads, []);
});

const window = { startDate: '2099-10-24', startTime: '10:00', endDate: '2099-10-25', endTime: '10:00' };
const creationRoutes = ['check-availability', 'bookings/pay-on-site', 'bookings/demo-payment', 'payments/stripe/intent', 'payments/netopia/init'];
const modificationRoutes = ['bookings/[id]/modification-quote', 'bookings/[id]/modification-request', 'bookings/[id]/modification-payment'];
function fixture(route, mode, { unchanged = false, isGuest = false, authorized = true, conflict = false, blacklistRejection = null, email = 'booking@example.test' } = {}) {
  const g = whitelist({ listed: mode !== 'clear', failure: mode === 'failure' });
  const effects = [], checks = [], blacklistChecks = [];
  const effect = (name, result) => async () => { effects.push(name); return result; };
  const currentPlate = unchanged ? 'B40DEX' : 'B1ABC';
  const booking = { ...window, licensePlate: currentPlate, activeModificationRequestId: 'mod', amount: 100, clientEmail: 'client@example.test' };
  const mod = { status: 'awaiting_difference_payment', amountToPay: 10, finalValues: { ...window, licensePlate: ' b40-dex ' } };
  const success = { success: true, firestoreId: 'created' };
  const session = { paymentUrl: 'https://payment.example.test', chargedAmount: 10, status: 'pending' };
  const availability = { available: true, conflictingBookings: 0, totalSpots: 100, maxBookingsInPeriod: 0 };
  const conflictResult = { exists: conflict, unavailable: false };
  const mocks = {
    '@/lib/mobile-booking-whitelist': g.api,
    '@/lib/mobile-booking-blacklist': { getMobileBookingBlacklistRejection: async input => { blacklistChecks.push(input); return blacklistRejection; } },
    '@/lib/mobile-api-auth': { verifyMobileUser: async () => authorized ? { ok: true, user: { uid: 'u', email: 'client@example.test', isGuest } } : { ok: false, response: { status: 401 } } },
    '@/lib/mobile-cors': { mobileJsonResponse: (body, status = 200) => ({ body, status }), mobileOptionsResponse() {} },
    '@/lib/mobile-booking-window': { validateMobileBookingWindow: () => ({ ok: true }) },
    '@/lib/mobile-reservation-conflicts': {
      checkMobileReservationConflict: async () => { checks.push('duplicate'); return conflictResult; },
      conflictMessage: () => 'Existing conflict', BOOKING_CHECK_UNAVAILABLE: 'Unavailable',
    },
    '@/lib/mobile-reservation-check.server': { checkMobileReservation: async () => { checks.push('availability'); return { availability, conflict: conflictResult }; } },
    '@/lib/mobile-booking-mapper': {
      validateMobileBookingPayload: data => ({ ok: true, data }),
      createMobilePayOnSiteBooking: effect('booking', success),
      mapMobilePayloadToFormData: value => value, MOBILE_BOOKING_ORIGIN: 'mobile_app',
    },
    '@/lib/mobile-loyalty-pricing': { applyLoyaltyPricingToMobilePayload: async payload => { effects.push('loyalty'); return { payload, finalAmount: 100, applied: false }; } },
    '@/lib/mobile-app-settings': { getMobileAppSettings: async () => ({ testPaymentEnabled: true, stripeEnabled: true, netopiaEnabled: true }) },
    '@/lib/payments/payment-provider': { resolveActivePaymentProvider: () => route.includes('stripe') ? 'stripe' : 'netopia' },
    '@/lib/payments/netopia-provider': { createMobileNetopiaPaymentSession: effect('payment', session) },
    '@/lib/payments/stripe-provider': { createMobileStripePaymentIntent: effect('payment', { clientSecret: 'secret', paymentIntentId: 'pi' }) },
    '@/lib/payments/payment-audit': { recordPaymentAuditEvent: async () => {} },
    '@/lib/payments/netopia-test-mode': { getNetopiaForcedTestConfig: () => ({ enabled: false }) },
    '@/lib/user-credits': { getUserCreditBalance: effect('credit', 0) },
    '@/app/actions/booking-actions': { createBookingWithFirestore: effect('booking', success) },
    '@/lib/mobile-booking-ownership': { canAccessMobileBooking: () => true, logMobileBookingAuthResolved() {}, logMobileBookingOwnershipFailure() {} },
    '@/lib/booking-modification-audit': { recordBookingModificationAuditEvent: async () => {} },
    '@/lib/utils': { normalizeLicensePlate },
    '@/lib/server-firestore': {
      db: {}, doc: (_db, collection) => collection, getDoc: async collection => ({ exists: () => true, data: () => collection === 'bookings' ? booking : mod }),
      addDoc: effect('modification-write', {}), updateDoc: effect('booking-write', {}), collection() {}, serverTimestamp() {},
    },
    '@/lib/modification-email': { parseModificationRequested: value => value },
    '@/lib/booking-utils': {
      checkAvailability: async () => { checks.push('modification-availability'); return { available: false }; },
      checkExistingReservationByLicensePlate: async () => { throw new Error('Unexpected duplicate lookup'); },
    },
    '@/lib/booking-pricing': {}, '@/lib/booking-modifications': {},
  };
  const handler = load(`app/api/mobile/${route}/route.ts`, mocks);
  const payload = route.includes('modification-') ? { newLicensePlate: ' b40-dex ' } : { ...window, licensePlate: ' b40-dex ', email, amount: 100 };
  return { ...g, effects, checks, blacklistChecks, async run() { return handler.POST({ json: async () => payload }, { params: Promise.resolve({ id: 'booking' }) }); } };
}
for (const route of [...creationRoutes, ...modificationRoutes]) {
  for (const isGuest of [false, true]) test(`${route}: direct ${isGuest ? 'guest' : 'user'} call rejected before booking/payment/credit`, async () => {
    const f = fixture(route, 'listed', { isGuest });
    const response = await f.run();
    assert.equal(response.status, route === 'check-availability' ? 200 : 409);
    assert.equal(response.body.code, 'LICENSE_PLATE_NOT_ALLOWED');
    assert.equal(response.body.message || response.body.error, f.api.LICENSE_PLATE_NOT_ALLOWED_MESSAGE);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.checks, []);
    assert.deepEqual(f.reads, ['B40DEX']);
    if (route === 'check-availability') {
      assert.equal(response.body.success, true);
      assert.equal(response.body.available, false);
      for (const key of ['conflictingBookings', 'totalSpots', 'maxBookingsInPeriod']) assert.equal(typeof response.body[key], 'number');
    }
  });
  for (const mode of ['clear', 'failure']) test(`${route}: ${mode} continues existing flow`, async () => {
    const f = fixture(route, mode);
    const response = await f.run();
    if (route.endsWith('modification-quote') || route.endsWith('modification-request')) {
      assert.equal(response.status, 409);
      assert.deepEqual(f.checks, ['modification-availability']);
    } else {
      assert.equal(response.status, 200, JSON.stringify(response));
      assert.equal(response.body.success, true);
      if (route === 'check-availability') assert.equal(response.body.available, true);
      else assert.ok(f.effects.includes(route.includes('payment') && !route.includes('demo') ? 'payment' : 'booking'));
    }
    assert.notEqual(response.body.code, 'LICENSE_PLATE_NOT_ALLOWED');
    if (mode === 'failure') assert.equal(f.errors.length, 1);
  });
  test(`${route}: unauthenticated calls do not read whitelist`, async () => {
    const f = fixture(route, 'listed', { authorized: false });
    assert.equal((await f.run()).status, 401);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.blacklistChecks, []);
  });
}
for (const route of modificationRoutes) test(`${route}: existing listed plate unchanged is allowed without whitelist read`, async () => {
  const f = fixture(route, 'listed', { unchanged: true });
  const response = await f.run();
  assert.deepEqual(f.reads, []);
  assert.notEqual(response.body.code, 'LICENSE_PLATE_NOT_ALLOWED');
  assert.equal(response.status, route.endsWith('modification-payment') ? 200 : 409);
  if (route.endsWith('modification-payment')) assert.deepEqual(f.effects, ['payment']);
  else assert.deepEqual(f.checks, ['modification-availability']);
});
for (const mode of ['clear', 'failure']) for (const route of creationRoutes.filter(r => !r.includes('demo'))) {
  test(`${route}: ${mode} still enforces duplicate protection`, async () => {
    const f = fixture(route, mode, { conflict: true });
    const response = await f.run();
    assert.equal(response.status, route === 'check-availability' ? 200 : 409);
    assert.equal(response.body.error, route === 'check-availability' ? 'DUPLICATE_LICENSE_PLATE_PERIOD' : 'Existing conflict');
    assert.deepEqual(f.effects, []);
  });
}

for (const route of creationRoutes) for (const isGuest of [false, true]) {
  for (const status of [409, 503]) test(`${route}: blacklist ${status} stops ${isGuest ? 'guest' : 'user'} before side effects`, async () => {
    const code = status === 409 ? 'MOBILE_BOOKING_BLOCKED' : 'BOOKING_CHECK_UNAVAILABLE';
    const error = status === 409 ? 'Rezervarea din aplicație nu este permisă pentru aceste date. Contactează parcarea.' : 'Nu putem verifica rezervarea momentan. Încearcă din nou';
    const f = fixture(route, 'clear', { isGuest, blacklistRejection: { status, body: { success: false, code, error } } });
    const response = await f.run();
    assert.equal(response.status, route === 'check-availability' && status === 409 ? 200 : status);
    assert.equal(response.body.code, code);
    assert.equal(response.body.message || response.body.error, error);
    if (route === 'check-availability' && status === 409) assert.equal(response.body.available, false);
    assert.deepEqual(f.effects, []);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.checks, []);
    assert.equal(f.blacklistChecks.length, 1);
    assert.equal(f.blacklistChecks[0].licensePlate, ' b40-dex ');
    assert.deepEqual(Array.from(f.blacklistChecks[0].emails), ['client@example.test', 'booking@example.test']);
  });
  test(`${route}: authenticated email checked even with missing payload email`, async () => {
    // Explicit null avoids the fixture's default argument.
    const empty = fixture(route, 'clear', { isGuest, email: null });
    await empty.run();
    assert.equal(empty.blacklistChecks[0].emails[0], 'client@example.test');
  });
}
for (const route of modificationRoutes) test(`${route}: new booking blacklist does not restrict existing modifications`, async () => {
  const f = fixture(route, 'clear', { blacklistRejection: {status:409,body:{code:'MOBILE_BOOKING_BLOCKED'}} });
  await f.run();
  assert.equal(f.blacklistChecks.length, 0);
});
