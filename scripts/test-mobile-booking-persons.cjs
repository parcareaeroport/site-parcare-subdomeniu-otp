const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRoute(route, booking) {
  const mocks = {
    '@/lib/qr-link': { buildSignedQrUrl: number => `qr:${number}` },
    '@/lib/mobile-api-auth': {
      verifyMobileUser: async () => ({ ok: true, user: { uid: 'user', email: 'client@example.test' } }),
    },
    '@/lib/mobile-cors': {
      mobileJsonResponse: body => JSON.parse(JSON.stringify(body)),
      mobileOptionsResponse() {},
    },
    '@/lib/mobile-user-service': {
      queryMobileUserBookings: async () => [booking],
      queryBookingsByContact: async () => [booking],
    },
    '@/lib/mobile-booking-ownership': {
      canAccessMobileBooking: () => true,
      logMobileBookingAuthResolved() {},
      logMobileBookingOwnershipFailure() {},
    },
    '@/lib/server-firestore': {
      db: {}, doc() {},
      getDoc: async () => ({ id: booking.id, exists: () => true, data: () => booking }),
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'app/api/mobile/bookings', route, 'route.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require(id) {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`);
    return mocks[id];
  } });
  return exports;
}

for (const route of ['', 'lookup']) {
  for (const numberOfPersons of [1, 3, undefined]) {
    test(`${route || 'account'} list matches details for person count ${numberOfPersons}`, async () => {
      const saved = { id: 'booking-1', numberOfPersons };
      const request = { url: 'https://example.test/api/mobile/bookings?email=client%40example.test' };
      const list = await loadRoute(route, saved).GET(request);
      const details = await loadRoute('[id]', saved).GET(request, { params: Promise.resolve({ id: saved.id }) });

      assert.equal(list.success, true);
      assert.equal(details.success, true);
      assert.equal(list.bookings[0].id, details.booking.id);
      assert.equal(list.bookings[0].numberOfPersons, numberOfPersons);
      assert.equal(list.bookings[0].numberOfPersons, details.booking.numberOfPersons);
    });
  }
}
