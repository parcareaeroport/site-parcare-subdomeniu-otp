const test = require('node:test');
const assert = require('node:assert/strict');
const {fixture, load, person, request} = require('./blacklist-fixture.cjs');

test('admin create, normalized matching by either identifier, list and delete/unblock', async () => {
  const f = fixture();
  const created = await f.api.POST(request(person));
  assert.equal(created.status, 201);
  const entries = (await f.api.GET({})).body.entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'Test Person');
  assert.equal(entries[0].email, 'person@example.test');
  assert.equal(entries[0].licensePlate, 'B123ABC');
  assert.equal(entries[0].createdAt, '2026-10-24T09:00:00.000Z');
  for (const input of [
    {licensePlate:'b-123 abc',emails:['different@example.test']},
    {licensePlate:'OTHER',emails:['PERSON@example.test ']},
    {licensePlate:'OTHER',emails:['other@example.test','person@example.test']},
  ]) assert.equal((await f.helper.getMobileBookingBlacklistRejection(input)).body.code, 'MOBILE_BOOKING_BLOCKED');
  assert.equal(await f.helper.getMobileBookingBlacklistRejection({licensePlate:'OTHER',emails:['other@example.test']}), null);
  assert.equal((await f.api.DELETE(request({id:created.body.id}))).status, 200);
  assert.equal(await f.helper.getMobileBookingBlacklistRejection({licensePlate:'B123ABC',emails:['person@example.test']}), null);
});
test('atomic duplicate prevention preserves original creation data', async () => {
  const f = fixture();
  const responses = await Promise.all([f.api.POST(request(person)),f.api.POST(request({...person,name:'Another name'}))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201,409]);
  assert.equal(f.records.size, 1);
});
test('shared email/plate in another record continues blocking after one deletion', async () => {
  const f = fixture();
  const first = await f.api.POST(request(person));
  await f.api.POST(request({...person,licensePlate:'B2ABC'}));
  await f.api.POST(request({...person,email:'other@example.test'}));
  await f.api.DELETE(request({id:first.body.id}));
  assert.equal((await f.helper.getMobileBookingBlacklistRejection({licensePlate:'OTHER',emails:['person@example.test']})).status,409);
  assert.equal((await f.helper.getMobileBookingBlacklistRejection({licensePlate:'B123ABC',emails:[]})).status,409);
});
test('normalizes and deduplicates identity and booking emails before queries', async () => {
  const f = fixture();
  await f.helper.getMobileBookingBlacklistRejection({licensePlate:'b-123 abc',emails:[null,'', ' PERSON@EXAMPLE.TEST ','person@example.test']});
  assert.deepEqual(f.reads,[{field:'licensePlate',value:'B123ABC'},{field:'email',value:'person@example.test'}]);
});
for (const role of [null,'employee','entriesOperator']) test(`admin API denies ${role || 'unauthenticated'} without datastore access`, async () => {
  const f = fixture({role});
  for (const method of ['GET','POST','DELETE']) assert.equal((await f.api[method](request(person))).status,role ? 403 : 401);
  assert.equal(f.records.size,0);
  assert.equal(f.reads.length,0);
});
for (const invalid of [null,{}, {...person,name:' '},{...person,email:'bad'},{...person,email:123},{...person,licensePlate:'---'}, {...person,name:[]}, {...person,email:'a'.repeat(255)+'@b.ro'}]) {
  test(`rejects invalid admin input ${JSON.stringify(invalid)}`, async () => {
    const f = fixture();
    assert.equal((await f.api.POST(request(invalid))).status,400);
    assert.equal(f.records.size,0);
  });
}
test('invalid deletion is rejected and database outages fail closed', async () => {
  const f = fixture({failure:true});
  assert.equal((await f.api.DELETE(request({id:'../bad'}))).status,400);
  assert.equal((await f.api.GET({})).status,503);
  assert.equal((await f.api.POST(request(person))).status,503);
  assert.equal((await f.api.DELETE(request({id:'a'.repeat(64)}))).status,503);
  const rejected = await f.helper.getMobileBookingBlacklistRejection({licensePlate:'B123ABC',emails:['person@example.test']});
  assert.equal(rejected.status,503);
  assert.equal(rejected.body.code,'BOOKING_CHECK_UNAVAILABLE');
});
test('only administrators may access blacklist navigation path', () => {
  const roles = load('lib/admin-roles.ts', {});
  for (const role of ['admin','employee','entriesOperator']) assert.equal(roles.canAccessAdminPath('/admin/dashboard/blacklist',role),role === 'admin');
});
