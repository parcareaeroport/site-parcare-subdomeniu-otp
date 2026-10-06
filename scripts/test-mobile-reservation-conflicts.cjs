const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`);
    return mocks[id];
  }, console: { error() {}, info() {}, warn() {} }, Date, Number, String, Boolean, Error });
  return exports;
}
const interval = load('lib/reservation-conflict-interval.ts');
const old = { startDate: '2026-10-01', startTime: '08:45', endDate: '2026-10-05', endTime: '19:00', multiparkDurationMinutes: 7200 };
const incoming = { startDate: '2026-10-05', startTime: '19:00', endDate: '2026-10-06', endTime: '19:00' };
test('CT51MMW: rounded Multipark interval blocks the paid reservation case', () => {
  assert.equal(interval.intervalsOverlap(interval.reservationInterval(old, true), interval.reservationInterval(incoming, true)), true);
  assert.equal(interval.reservationInterval(old, true).end, new Date('2026-10-06T08:45:00').getTime());
});
test('legacy duration reconstruction matches saved duration; local interval stays real', () => {
  assert.equal(interval.reservationInterval({...old, multiparkDurationMinutes: undefined}, true).end, interval.reservationInterval(old, true).end);
  assert.equal(interval.intervalsOverlap(interval.reservationInterval(old, false), interval.reservationInterval(incoming, false)), false);
});
test('exact effective end is allowed; later period allowed; invalid dates fail closed', () => {
  const a = interval.reservationInterval(old, true);
  assert.equal(interval.intervalsOverlap(a, {start: a.end, end: a.end + 60000}), false);
  assert.throws(() => interval.reservationInterval({...old, startDate: 'invalid'}, true));
});
function guard(rows, failure = false) {
  return load('lib/mobile-reservation-conflicts.ts', {
    '@/lib/firebase-admin': {adminDb: {collection: () => ({where: (_field, _op, statuses) => ({get: async () => {
      if (failure) throw new Error('offline');
      return {docs: rows.filter(x => statuses.includes(x.status)).map((x,i) => ({id: `booking-${i}`, data: () => x}))};
    }})})}},
    '@/lib/utils': {normalizeLicensePlate: x => x.replace(/[^a-z0-9]/gi, '').toUpperCase()},
    '@/lib/mobile-booking-ownership': {canAccessMobileBooking: (b,a) => b.clientEmail === a.email},
    '@/lib/reservation-conflict-interval': interval,
  });
}
const args = ['ct 51-mmw', incoming.startDate, incoming.endDate, incoming.startTime, incoming.endTime, {auth: {uid: 'u', email: 'owner@example.test'}, paymentMethod: 'online'}];
test('normalized plate and expired rounded record block; only owner receives link', async () => {
  const g = guard([{...old, licensePlate: 'CT51MMW', status: 'expired', apiBookingNumber: '929744', clientEmail: 'owner@example.test'}]);
  assert.equal((await g.checkMobileReservationConflict(...args)).existingBooking.id, 'booking-0');
  const other = await g.checkMobileReservationConflict(...args.slice(0,5), {auth: {uid:'other', email:'other@example.test'}});
  assert.equal(other.exists, true); assert.equal(other.existingBooking, undefined);
});
test('cancelled records and different plates do not block', async () => {
  const g = guard([{...old,licensePlate:'CT51MMW',status:'cancelled_by_admin',apiBookingNumber:'929744'}, {...old,licensePlate:'B1ABC',status:'confirmed_paid',apiBookingNumber:'111111'}]);
  assert.equal((await g.checkMobileReservationConflict(...args)).exists, false);
});
test('Firestore failures return unavailable', async () => {
  assert.equal((await guard([], true).checkMobileReservationConflict(...args)).unavailable, true);
});
for (const provider of ['netopia', 'stripe']) for (const unavailable of [false, true]) {
  test(`${provider}: old client blocked before payment session (${unavailable ? '503' : '409'})`, async () => {
    let called = false;
    const denied = () => {called = true; throw new Error('Payment must not start')};
    const g = guard([], false);
    const mocks = {
      '@/lib/mobile-app-settings': {getMobileAppSettings: async () => ({netopiaEnabled:true, stripeEnabled:true})},
      '@/lib/mobile-api-auth': {verifyMobileUser: async () => ({ok:true,user:{uid:'u',email:'owner@example.test'}})},
      '@/lib/mobile-booking-mapper': {validateMobileBookingPayload: data => ({ok:true,data})},
      '@/lib/mobile-reservation-conflicts': {...g, checkMobileReservationConflict: async () => ({exists:!unavailable,unavailable})},
      '@/lib/mobile-booking-window': {validateMobileBookingWindow: () => ({ok:true})},
      '@/lib/mobile-cors': {mobileJsonResponse: (body,status=200) => ({body,status})},
      '@/lib/payments/payment-provider': {resolveActivePaymentProvider: () => provider},
      '@/lib/payments/netopia-provider': {createMobileNetopiaPaymentSession: denied},
      '@/lib/payments/stripe-provider': {createMobileStripePaymentIntent: denied},
      '@/lib/mobile-loyalty-pricing': {}, '@/lib/user-credits': {}, '@/app/actions/booking-actions': {},
      '@/lib/payments/payment-audit': {}, '@/lib/payments/netopia-test-mode': {},
    };
    const route = load(`app/api/mobile/payments/${provider}/${provider==='netopia'?'init':'intent'}/route.ts`, mocks);
    const response = await route.POST({json:async()=>({licensePlate:'CT51MMW',...incoming})});
    assert.equal(response.status, unavailable ? 503 : 409); assert.equal(called, false);
    assert.equal(response.body.code, unavailable ? 'BOOKING_CHECK_UNAVAILABLE' : 'DUPLICATE_LICENSE_PLATE_PERIOD');
  });
}

for (const capacityFailure of [false, true]) {
  test(`availability endpoint fails closed (${capacityFailure ? 'capacity read' : 'conflict read'})`, async () => {
    const g = guard([], true);
    const route = load('app/api/mobile/check-availability/route.ts', {
      '@/lib/mobile-reservation-conflicts': g,
      '@/lib/booking-utils': {checkAvailability: async () => ({available:!capacityFailure,verificationFailed:capacityFailure})},
      '@/lib/mobile-api-auth': {verifyMobileUser: async () => ({ok:true,user:{uid:'u',email:'owner@example.test'}})},
      '@/lib/mobile-booking-window': {validateMobileBookingWindow: () => ({ok:true})},
      '@/lib/mobile-cors': {mobileJsonResponse: (body,status=200) => ({body,status})},
    });
    const response = await route.POST({json:async()=>({licensePlate:'CT51MMW',...incoming})});
    assert.equal(response.status,503); assert.equal(response.body.code,'BOOKING_CHECK_UNAVAILABLE');
  });
}
test('new online rounding blocks a later reservation that real duration would miss', () => {
  const newShort = {startDate:'2026-10-06',startTime:'09:00',endDate:'2026-10-06',endTime:'10:00'};
  const later = {startDate:'2026-10-06',startTime:'15:00',endDate:'2026-10-07',endTime:'15:00'};
  assert.equal(interval.intervalsOverlap(interval.reservationInterval(newShort,true),interval.reservationInterval(later,true)),true);
  assert.equal(interval.intervalsOverlap(interval.reservationInterval(newShort,false),interval.reservationInterval(later,true)),false);
});
