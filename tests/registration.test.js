const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanForm, applyFormUpdate, validateAnswers, passAnswers, FormLockError } = require('../dist/utils/RegistrationFormUtil');
const { cleanRegistrationSettings, defaultRegistrationSettings, feedbackDueAt, staffAccessOpen, normalisePhone } = require('../dist/utils/RegistrationSettingsUtil');
const { deriveToken, hashToken, extractToken, passCode } = require('../dist/utils/PassTokenUtil');
const { hit, resetRateLimits } = require('../dist/utils/RateLimitUtil');

const sampleForm = () => cleanForm({
  title: 'Reserve your seat',
  questions: [
    { id: 'name', type: 'short', label: 'Your name', required: true, role: 'name', onPass: true },
    { id: 'party', type: 'number', label: 'How many?', required: true, min: 1, max: 4, partySize: true },
    { id: 'diet', type: 'mc', label: 'Diet', options: ['Veg', 'Non-veg'] },
    { id: 'allergy', type: 'paragraph', label: 'Allergies', showIf: { questionId: 'diet', op: 'is', value: 'Veg' } },
    { id: 'photo', type: 'file', label: 'Photo', fileAccept: 'image' },
  ],
});

test('defaults keep every new option off (one tap, no pass, no limit, no feedback)', () => {
  const d = defaultRegistrationSettings();
  assert.equal(d.mode, 'tap');
  assert.equal(d.capacity, null);
  assert.equal(d.pass.enabled, false);
  assert.equal(d.waitlist.enabled, false);
  assert.equal(d.feedback.enabled, false);
  assert.deepEqual(cleanRegistrationSettings(undefined), d);
});

test('settings cleaning normalises phones, templates and feedback timing', () => {
  const s = cleanRegistrationSettings({
    mode: 'form', capacity: '30', pass: { enabled: true, template: { kind: 'library', id: 'nope' }, staffPhones: ['98765 10234', '+919876510234', '12'] },
    feedback: { enabled: true, when: 'at' },
  });
  assert.equal(s.capacity, 30);
  assert.equal(s.pass.template.id, 'pass-mobile');
  assert.deepEqual(s.pass.staffPhones, ['+919876510234']);
  assert.equal(s.feedback.when, 'manual', '"at" without a date falls back to manual');
  assert.equal(normalisePhone('9876510234'), '+919876510234');
});

test('cleanForm drops invalid questions and keeps one name and one party-size question', () => {
  const form = cleanForm({ questions: [
    { id: 'a', type: 'short', label: 'Name', role: 'name' },
    { id: 'b', type: 'short', label: 'Nick', role: 'name' },
    { id: 'c', type: 'mc', label: 'Empty choice', options: [] },
    { id: 'd', type: 'banana', label: 'x' },
    { id: 'a', type: 'number', label: 'Dup id', partySize: true },
  ] });
  assert.deepEqual(form.questions.map((q) => q.id), ['a', 'b', 'a_2']);
  assert.equal(form.questions[1].role, null);
  assert.equal(form.questions[2].partySize, true);
});

test('validateAnswers enforces required, options, ranges, visibility and file ownership', () => {
  const form = sampleForm();
  const bad = validateAnswers(form, { party: 9, diet: 'Fish' }, '7/919876500000/');
  assert.ok(bad.errors.name);
  assert.ok(bad.errors.party);
  assert.ok(bad.errors.diet);

  const ok = validateAnswers(form, {
    name: 'Ananya Kulkarni', party: 2, diet: 'Non-veg', allergy: 'hidden because diet is not Veg', stray: 'x',
    photo: [{ path: '7/919876500000/a.jpg', name: 'a.jpg', size: 10, type: 'image/jpeg' }, { path: '7/111/b.jpg', type: 'image/jpeg' }],
  }, '7/919876500000/');
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.guestName, 'Ananya Kulkarni');
  assert.equal(ok.partySize, 2);
  assert.equal(ok.answers.allergy, undefined);
  assert.equal(ok.answers.stray, undefined);
  assert.equal(ok.answers.photo.length, 1, "someone else's file is dropped");
  assert.deepEqual(passAnswers(form, ok.answers), { 'answer.name': 'Ananya Kulkarni' });
});

test('a form with responses: existing questions are frozen, new ones allowed, removal keeps the question', () => {
  const saved = sampleForm();
  assert.throws(() => applyFormUpdate(saved, { ...saved, questions: saved.questions.map((q) => q.id === 'diet' ? { ...q, label: 'Food' } : q) }, true), FormLockError);

  const added = applyFormUpdate(saved, { ...saved, questions: [...saved.questions, { id: 'seat', type: 'short', label: 'Seating' }] }, true);
  assert.equal(added.version, saved.version + 1);
  assert.ok(added.questions.find((q) => q.id === 'seat'));

  const removed = applyFormUpdate(saved, { ...saved, questions: saved.questions.filter((q) => q.id !== 'diet') }, true);
  const diet = removed.questions.find((q) => q.id === 'diet');
  assert.ok(diet && diet.removedAt, 'dropped question is kept as removed');

  const noName = applyFormUpdate(saved, { ...saved, questions: saved.questions.filter((q) => q.id !== 'name') }, true);
  assert.equal(noName.questions.find((q) => q.id === 'name').role, 'name', 'removing the name question keeps it frozen');

  const unlocked = applyFormUpdate(saved, { ...saved, questions: saved.questions.map((q) => q.id === 'diet' ? { ...q, label: 'Food' } : q) }, false);
  assert.equal(unlocked.questions.find((q) => q.id === 'diet').label, 'Food');
});

test('pass tokens are 22 chars, derivable, hashed for lookup, and codes are display-only', () => {
  const token = deriveToken('pass', 42, 'nonce-1');
  assert.equal(token.length, 22);
  assert.equal(deriveToken('pass', 42, 'nonce-1'), token);
  assert.notEqual(deriveToken('pass', 42, 'nonce-2'), token, 're-issue changes the token');
  assert.equal(extractToken(`https://peshkash.app/t/${token}`), token);
  assert.equal(extractToken('nope'), null);
  assert.match(passCode('Diwali Tasting Evening', hashToken(token)), /^DTE-[0-9A-Z]{4}$/);
});

test('feedback scheduling and staff access windows', () => {
  const end = new Date('2026-11-01T17:00:00Z');
  const s = cleanRegistrationSettings({ feedback: { enabled: true, when: 'after', afterMinutes: 60 } });
  assert.equal(feedbackDueAt(s, end).toISOString(), '2026-11-01T18:00:00.000Z');
  assert.equal(feedbackDueAt(cleanRegistrationSettings({ feedback: { enabled: true } }), end), null);
  assert.equal(staffAccessOpen(null, end, end.getTime() + 23 * 3600_000), true);
  assert.equal(staffAccessOpen(null, end, end.getTime() + 25 * 3600_000), false);
});

test('rate limiter blocks after the limit within a window', () => {
  resetRateLimits();
  for (let i = 0; i < 3; i += 1) assert.equal(hit('t', 3, 1000, 0), true);
  assert.equal(hit('t', 3, 1000, 10), false);
  assert.equal(hit('t', 3, 1000, 2000), true, 'window resets');
});
