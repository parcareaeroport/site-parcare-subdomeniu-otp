const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(id) {
    if (!(id in mocks)) throw new Error(`Unexpected dependency ${id}`);
    return mocks[id];
  }, console: { error() {} } });
  return exports;
}
const normalizeLicensePlate = value => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
function fixture({ role = 'admin', failure = false } = {}) {
  const records = new Map(), reads = [];
  const collection = {
    async get() {
      if (failure) throw new Error('offline');
      return { docs: [...records].map(([id, data]) => ({ id, data: () => data })) };
    },
    where(field, op, value) {
      assert.equal(op, '==');
      return { limit(n) { assert.equal(n, 1); return { async get() {
        reads.push({field, value});
        if (failure) throw new Error('offline');
        return { empty: ![...records.values()].some(data => data[field] === value) };
      } }; } };
    },
    doc(id) {
      return {
        async create(data) {
          if (failure) throw new Error('offline');
          if (records.has(id)) throw Object.assign(new Error('exists'), {code:6});
          records.set(id, data);
        },
        async delete() { if (failure) throw new Error('offline'); records.delete(id); },
      };
    },
  };
  const mocks = {
    '@/lib/utils': { normalizeLicensePlate },
    '@/lib/firebase-admin': { adminDb: { collection(name) { assert.equal(name, 'mobile_booking_blacklist'); return collection; } } },
    'node:crypto': require('node:crypto'),
    'firebase-admin/firestore': { FieldValue: { serverTimestamp: () => ({ toDate: () => new Date('2026-10-24T09:00:00Z') }) } },
    'next/server': { NextResponse: { json: (body, init = {}) => ({body, status:init.status || 200}) } },
    '@/lib/admin-api-auth': { authorizeAdminRequest: async (_request, allowed) => {
      assert.deepEqual(Array.from(allowed), ['admin']);
      return role === 'admin' ? {ok:true,user:{uid:'admin'}} : {ok:false,response:{status:role ? 403 : 401}};
    } },
  };
  const helper = load('lib/mobile-booking-blacklist.ts', mocks);
  mocks['@/lib/mobile-booking-blacklist'] = helper;
  const api = load('app/api/admin/blacklist/route.ts', mocks);
  return {helper, api, records, reads};
}
const person = {name:' Test Person ',email:' PERSON@EXAMPLE.TEST ',licensePlate:' b 123-abc '};
const request = body => ({json:async () => body});

module.exports = {fixture, load, person, request};
