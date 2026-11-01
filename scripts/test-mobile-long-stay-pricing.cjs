// Exercises the actual mobile/server calculators and payment payload recalculation.
// Run: node --test scripts/test-mobile-long-stay-pricing.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, state, config, zero } = require('./booking-loyalty-fixture.cjs');
const tiers = [{ days: 1, standardPrice: 60 }, { days: 29, standardPrice: 898 }, { days: 30, standardPrice: 923 }];
const settings = { getPricingSettings: async () => ({ mobileOnlineDiscountPercent: 25 }) };
const firestore = {
  db: {}, collection: () => ({}), query: () => ({}), orderBy: () => ({}),
  getDocs: async () => ({ forEach: callback => tiers.forEach(tier => callback({ data: () => tier })) }),
  doc: () => ({}), getDoc: async () => ({ exists: () => false }),
};
const server = load('lib/booking-pricing.ts', {
  '@/lib/server-firestore': firestore, '@/lib/pricing-settings': settings,
});
const mobile = load('../expo-mobile-app/lib/bookingPricing.ts', {
  '@/lib/dateFormat': { toApiDate: date => date.split('.').reverse().join('-') },
});
const program = load('lib/loyalty-program.ts', {
  '@/lib/booking-pricing': server, '@/lib/server-firestore': firestore,
  '@/lib/pricing-settings': settings, '@/lib/loyalty-state': state,
  '@/lib/mobile-app-settings.shared': { DEFAULT_LOYALTY_PROGRAM: config },
  '@/lib/mobile-app-settings': { DEFAULT_LOYALTY_PROGRAM: config, getLoyaltyProgramFromSettings: () => config },
});
const payment = load('lib/mobile-loyalty-pricing.ts', {
  '@/lib/booking-pricing': server, '@/lib/loyalty-program': program,
  '@/lib/mobile-user-service': { getMobileUserProfile: async () => ({ loyalty: { ...zero, freeDaysAvailable: 1 } }) },
});

for (const [days, standard, online] of [
  [1, 60, 45], [29, 898, 673.5], [30, 923, 692.25], [31, 953.77, 715.33],
  [60, 1846.1, 1384.58], [61, 1876.87, 1407.65], [90, 2769.2, 2076.9], [92, 2830.74, 2123.06],
]) {
  test(`${days} days: display, quote and payment calculators agree`, () => {
    for (const [method, expected] of [['online', online], ['at_parking', standard]]) {
      assert.equal(mobile.computeBookingTotal(days, tiers, method, 25), expected);
      assert.equal(server.resolveMobileBookingPrice(days, tiers, method, 25).total, expected);
      assert.equal(program.calculateMobileBookingPriceFromTiers(tiers, days, method, 25), expected);
    }
  });
}

test('full quote spans multiple months and a year', async () => {
  const quote = await server.resolveMobileBookingQuote({ startDate: '2026-11-01', startTime: '10:00', endDate: '2027-02-01', endTime: '10:00' });
  assert.equal(quote.days, 92);
  assert.equal(quote.onlineTotal, 2123.06);
  assert.equal(quote.atParkingTotal, 2830.74);
  assert.equal(quote.pricePerDayOnline, 23.08);
  assert.equal(quote.tierDaysUsed, 92);
});

test('payment recomputes dates and amount instead of trusting the client', async () => {
  for (const [method, expected] of [['online', 2123.06], ['at_parking', 2830.74]]) {
    const result = await payment.applyLoyaltyPricingToMobilePayload({ startDate: '2026-11-01', startTime: '10:00', endDate: '2027-02-01', endTime: '10:00', days: 30, amount: 1 }, 'test', 'users', method);
    assert.equal(result.payload.days, 92);
    assert.equal(result.payload.amount, expected);
    assert.equal(result.baseAmount, expected);
    assert.equal(result.applied, false, 'long stay does not change existing loyalty eligibility');
  }
});

test('extra partial day is billed after the 30-day threshold', () => {
  const days = server.computeBillableDays('2026-11-01', '10:00', '2026-12-01', '10:01');
  assert.equal(days, 31);
  assert.equal(server.resolveMobileBookingPrice(days, tiers, 'online', 25).total, 715.33);
});

test('website pricing remains unchanged and mobile discount stays configurable', () => {
  assert.equal(server.computeBookingTotal(92, tiers, 'online'), 738.4);
  assert.equal(server.resolveMobileBookingPrice(92, tiers, 'online', 20).total, 2264.59);
  assert.equal(mobile.computeBookingTotal(92, tiers, 'online', 20), 2264.59);
});

test('30-day tariff is required and remains the base even with longer tiers', () => {
  assert.equal(server.resolveMobileBookingPrice(92, [{ days: 1, standardPrice: 60 }], 'online', 25), null);
  assert.equal(server.resolveMobileBookingPrice(92, [...tiers, { days: 92, standardPrice: 1 }], 'at_parking', 25).total, 2830.74);
});
