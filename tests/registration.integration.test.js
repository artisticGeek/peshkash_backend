/**
 * End-to-end API test for Peshkash 5.0 registration against a real PostgreSQL database.
 * Skipped unless REGISTRATION_IT_DATABASE_URL points at a disposable database, e.g.
 *   REGISTRATION_IT_DATABASE_URL=postgres://pk:pk@127.0.0.1:5432/peshkash node --test tests/registration.integration.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.REGISTRATION_IT_DATABASE_URL;
if (!url) {
  test('registration integration (skipped: set REGISTRATION_IT_DATABASE_URL)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = url;
  const { default: app, runMigrations } = require('../dist/app');
  const { sequelize } = require('../dist/config/sequelize');
  const { AuthService } = require('../dist/services/AuthService');
  const { resetRateLimits } = require('../dist/utils/RateLimitUtil');

  const VENDOR = '+919000000001';
  const STAFF = '+919000000009';
  const A = '+919000000011', B = '+919000000012', C = '+919000000013', D = '+919000000014', E = '+919000000015';
  let server, base, eventId;
  const eventName = `it-diwali-${Date.now()}`;
  const tokenFor = (phone, role = 'customer') => AuthService.signToken({ phone, role });

  async function call(method, path, { as, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (as) headers.Authorization = `Bearer ${tokenFor(as, as === VENDOR ? 'vendor' : 'customer')}`;
    const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  test.before(async () => {
    await runMigrations();
    const [vendor] = await sequelize.query(
      `INSERT INTO vendor (name, display_name, phone) VALUES (:name, 'Kitchen of Kesar', :phone) RETURNING id`,
      { replacements: { name: `it-kesar-${Date.now()}`, phone: VENDOR }, type: 'SELECT' });
    await sequelize.query(`INSERT INTO admin_section_grant (phone, section) VALUES (:phone, 'events') ON CONFLICT DO NOTHING`, { replacements: { phone: VENDOR } });
    const [event] = await sequelize.query(
      `INSERT INTO event (name, display_name, vendor_id, start_time, end_time, status, experience_config)
       VALUES (:name, 'Diwali Tasting Evening', :vendorId, NOW() + interval '1 day', NOW() + interval '1 day 3 hours', 'active', '{"enabled":true,"registrationEnabled":true}')
       RETURNING id`, { replacements: { name: eventName, vendorId: vendor.id }, type: 'SELECT' });
    eventId = Number(event.id);
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}/api`;
  });

  test.after(async () => {
    server?.close();
    await sequelize.close();
  });

  test.beforeEach(() => resetRateLimits());

  test('untouched event keeps one-tap defaults', async () => {
    const r = await call('GET', `/registration/${eventName}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, false);
    assert.equal(r.body.mode, 'tap');
    assert.equal(r.body.pass.enabled, false);
    assert.equal(r.body.seats, null);
  });

  test('full flow: form, seats, waitlist, passes, check-in, cancel and auto-promote', async () => {
    const admin = `/admin/event-registration/${eventId}`;
    let r = await call('PUT', `${admin}/settings`, { as: VENDOR, body: { settings: {
      mode: 'form', capacity: 3, guestCanCancel: true,
      waitlist: { enabled: true, autoPromote: true },
      pass: { enabled: true, staffPhones: [STAFF] },
      confirmationMessage: 'See you on the 1st!',
    } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    r = await call('PUT', `${admin}/forms/registration`, { as: VENDOR, body: { form: { title: 'Reserve your seat', questions: [
      { id: 'name', type: 'short', label: 'Your name', required: true, role: 'name' },
      { id: 'party', type: 'number', label: 'How many?', required: true, min: 1, max: 4, partySize: true },
    ] } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.locked, false);

    r = await call('POST', `/registration/${eventName}`, { as: A, body: { answers: { party: 2 } } });
    assert.equal(r.status, 422, 'name is required');
    assert.ok(r.body.details.name);

    r = await call('POST', `/registration/${eventName}`, { body: { answers: {} } });
    assert.equal(r.status, 401, 'sign-in required');

    const a = await call('POST', `/registration/${eventName}`, { as: A, body: { answers: { name: 'Ananya Kulkarni', party: 2 } } });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.me.status, 'registered');
    assert.equal(a.body.me.passToken.length, 22);
    assert.match(a.body.me.passCode, /^DTE-/);

    const b = await call('POST', `/registration/${eventName}`, { as: B, body: { answers: { name: 'Rohan', party: 2 } } });
    assert.equal(b.body.me.status, 'waitlisted');
    assert.equal(b.body.me.waitlistPosition, 1);
    assert.equal(b.body.me.passToken, null, 'no pass while waitlisted');

    const c = await call('POST', `/registration/${eventName}`, { as: C, body: { answers: { name: 'Meher', party: 1 } } });
    assert.equal(c.body.me.status, 'registered');

    r = await call('POST', `/registration/${eventName}`, { as: A, body: { answers: { name: 'Again', party: 1 } } });
    assert.equal(r.body.duplicate, true, 'registering twice returns the existing registration');

    r = await call('PUT', `${admin}/forms/registration`, { as: VENDOR, body: { form: { title: 'Reserve your seat', questions: [
      { id: 'name', type: 'short', label: 'Full name', required: true, role: 'name' },
      { id: 'party', type: 'number', label: 'How many?', required: true, min: 1, max: 4, partySize: true },
    ] } } });
    assert.equal(r.status, 409, 'answered questions are frozen');

    r = await call('PUT', `${admin}/forms/registration`, { as: VENDOR, body: { form: { title: 'Reserve your seat', questions: [
      { id: 'name', type: 'short', label: 'Your name', required: true, role: 'name' },
      { id: 'party', type: 'number', label: 'How many?', required: true, min: 1, max: 4, partySize: true },
      { id: 'diet', type: 'mc', label: 'Diet', options: ['Veg', 'Non-veg'] },
    ] } } });
    assert.equal(r.status, 200, 'adding a question is allowed');
    assert.equal(r.body.form.version, 2);

    // Pass visibility
    r = await call('GET', `/registration/pass/${a.body.me.passToken}`, { as: E });
    assert.equal(r.body.private, true);
    r = await call('GET', `/registration/pass/${a.body.me.passToken}`, { as: A });
    assert.equal(r.body.private, false);
    assert.equal(r.body.guest.name, 'Ananya Kulkarni');
    assert.equal(r.body.fields['guest.party'], '2');
    r = await call('GET', `/registration/pass/${a.body.me.passToken}`, { as: VENDOR });
    assert.equal(r.body.private, false);
    r = await call('GET', '/registration/pass/AAAAAAAAAAAAAAAAAAAAAA');
    assert.equal(r.status, 404);

    // Check-in
    r = await call('GET', `/checkin/${eventId}`, { as: E });
    assert.equal(r.status, 403, 'random numbers cannot open the scanner');
    r = await call('GET', `/checkin/${eventId}`, { as: STAFF });
    assert.equal(r.status, 200);
    assert.equal(r.body.role, 'staff');
    r = await call('POST', `/checkin/${eventId}/scan`, { as: STAFF, body: { token: `https://peshkash.app/t/${a.body.me.passToken}` } });
    assert.equal(r.body.result, 'ok');
    assert.equal(r.body.guest.name, 'Ananya Kulkarni');
    r = await call('POST', `/checkin/${eventId}/scan`, { as: STAFF, body: { token: a.body.me.passToken } });
    assert.equal(r.body.result, 'duplicate');
    r = await call('POST', `/checkin/${eventId}/scan`, { as: STAFF, body: { token: 'BBBBBBBBBBBBBBBBBBBBBB' } });
    assert.equal(r.body.result, 'invalid');
    r = await call('GET', `/checkin/${eventId}/search?q=meh`, { as: STAFF });
    assert.equal(r.body[0].name, 'Meher');

    // Cancel frees seats and moves the waitlist in
    r = await call('POST', `/registration/${eventName}/cancel`, { as: C });
    assert.equal(r.status, 200);
    assert.equal(r.body.promoted, 0, 'Rohan needs 2 seats; only 1 freed');
    r = await call('GET', `/admin/event-registration/${eventId}/registrations`, { as: VENDOR });
    const rows = r.body.rows;
    const ananya = rows.find((x) => x.phone === A);
    r = await call('POST', `${admin}/registrations/actions`, { as: VENDOR, body: { action: 'undo_checkin', ids: [ananya.id] } });
    r = await call('POST', `${admin}/registrations/actions`, { as: VENDOR, body: { action: 'cancel', ids: [ananya.id] } });
    assert.equal(r.body.promoted, 1, 'cancelling Ananya moves Rohan in');
    r = await call('POST', `/checkin/${eventId}/scan`, { as: STAFF, body: { token: a.body.me.passToken } });
    assert.equal(r.body.result, 'invalid', 'a cancelled pass stops working');
    r = await call('GET', `/registration/${eventName}`, { as: B });
    assert.equal(r.body.me.status, 'registered');
    assert.equal(r.body.me.passToken.length, 22);

    r = await call('GET', `${admin}/registrations`, { as: VENDOR });
    assert.equal(r.body.summary.registered, 1);
    assert.equal(r.body.summary.cancelled, 2);
    assert.equal(r.body.questions.length, 3);
  });

  test('feedback opens when sent, and only registered guests can answer', async () => {
    const admin = `/admin/event-registration/${eventId}`;
    let r = await call('GET', admin, { as: VENDOR });
    const settings = r.body.settings;
    settings.feedback = { enabled: true, when: 'manual', channel: 'manual', audience: 'all' };
    await call('PUT', `${admin}/settings`, { as: VENDOR, body: { settings } });
    await call('PUT', `${admin}/forms/feedback`, { as: VENDOR, body: { form: { title: 'How was it?', questions: [{ id: 'stars', type: 'rating', label: 'Overall', required: true }] } } });
    r = await call('POST', `/registration/${eventName}/feedback`, { as: B, body: { answers: { stars: 5 } } });
    assert.equal(r.status, 409, 'not open yet');
    r = await call('POST', `${admin}/feedback/send`, { as: VENDOR });
    assert.equal(r.body.recipients.length, 1);
    r = await call('POST', `/registration/${eventName}/feedback`, { as: B, body: { answers: { stars: 5 } } });
    assert.equal(r.status, 200);
    r = await call('POST', `/registration/${eventName}/feedback`, { as: E, body: { answers: { stars: 5 } } });
    assert.equal(r.status, 403);
  });

  test('invite-only registration is bound to the invited phone', async () => {
    const admin = `/admin/event-registration/${eventId}`;
    let r = await call('GET', admin, { as: VENDOR });
    const settings = { ...r.body.settings, inviteOnly: true, capacity: null };
    await call('PUT', `${admin}/settings`, { as: VENDOR, body: { settings } });
    r = await call('POST', `/registration/${eventName}`, { as: D, body: { answers: { name: 'Dev', party: 1 } } });
    assert.equal(r.status, 403);
    r = await call('POST', `${admin}/invites`, { as: VENDOR, body: { phones: ['9000000014'] } });
    assert.equal(r.status, 201);
    const token = r.body[0].token;
    r = await call('GET', `/registration/invite/${token}`);
    assert.equal(r.body.eventName, eventName);
    r = await call('POST', `/registration/${eventName}`, { as: E, body: { invite: token, answers: { name: 'Eve', party: 1 } } });
    assert.equal(r.status, 403, 'someone else cannot use the invite');
    r = await call('POST', `/registration/${eventName}`, { as: D, body: { invite: `https://peshkash.app/i/${token}`, answers: { name: 'Dev', party: 1 } } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.me.status, 'registered');
  });
}
