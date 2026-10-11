/**
 * Registration and feedback forms (Peshkash 5.0).
 *
 * A form is a list of questions owned by one event. Questions carry stable ids, and answers are
 * stored against those ids, so a form can grow after people have answered it:
 *   - once a form has responses, an existing question can no longer be edited;
 *   - new questions may be added (earlier respondents simply have no answer);
 *   - removing a question only hides it (`removedAt`), so earlier answers stay readable.
 * Everything here is pure so it can be unit-tested without a database.
 */

export const QUESTION_TYPES = [
  'short', 'paragraph', 'mc', 'checkbox', 'dropdown', 'number', 'scale', 'rating',
  'date', 'time', 'email', 'file', 'section',
] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export type FormKind = 'registration' | 'feedback';

export interface ShowIf { questionId: string; op: 'is' | 'is_not'; value: string }

export interface FormQuestion {
  id: string;
  type: QuestionType;
  label: string;
  description: string;
  required: boolean;
  options: string[];
  allowOther: boolean;
  min: number | null;
  max: number | null;
  minLabel: string;
  maxLabel: string;
  fileAccept: 'image' | 'image_pdf';
  maxFiles: number;
  /** A short-answer question whose answer is the guest's display name on passes and tables. */
  role: 'name' | null;
  /** A number question whose answer is the party size counted against seats. */
  partySize: boolean;
  /** Answer may appear on the guest's pass/invitation card as {{answer.<id>}}. */
  onPass: boolean;
  showIf: ShowIf | null;
  addedAt: string;
  removedAt: string | null;
}

export interface EventForm {
  title: string;
  description: string;
  questions: FormQuestion[];
  version: number;
}

export interface FileAnswer { path: string; name: string; size: number; type: string }
export type AnswerValue = string | number | string[] | FileAnswer[];

const MAX_QUESTIONS = 60;
const MAX_OPTIONS = 40;
const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const multiline = (value: unknown, max: number) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function emptyForm(): EventForm {
  return { title: '', description: '', questions: [], version: 1 };
}

function cleanId(value: unknown, fallback: string): string {
  const id = String(value ?? '').trim();
  return /^[a-zA-Z0-9_-]{1,40}$/.test(id) ? id : fallback;
}

export function cleanQuestion(raw: any, index: number, now = new Date().toISOString()): FormQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = QUESTION_TYPES.includes(raw.type) ? raw.type as QuestionType : null;
  if (!type) return null;
  const label = text(raw.label, 300);
  if (!label && type !== 'section') return null;
  const options = ['mc', 'checkbox', 'dropdown'].includes(type)
    ? [...new Set((Array.isArray(raw.options) ? raw.options : []).map((o: unknown) => text(o, 200)).filter(Boolean))].slice(0, MAX_OPTIONS) as string[]
    : [];
  if (['mc', 'checkbox', 'dropdown'].includes(type) && !options.length) return null;
  let min = num(raw.min);
  let max = num(raw.max);
  if (type === 'scale') {
    min = min === 0 ? 0 : 1;
    max = Math.max(min + 1, Math.min(10, max ?? 5));
  }
  if (type === 'rating') { min = 1; max = Math.max(3, Math.min(10, max ?? 5)); }
  if (type === 'number' && min !== null && max !== null && min > max) [min, max] = [max, min];
  const showIf = raw.showIf && typeof raw.showIf === 'object' && raw.showIf.questionId
    ? { questionId: cleanId(raw.showIf.questionId, ''), op: raw.showIf.op === 'is_not' ? 'is_not' as const : 'is' as const, value: text(raw.showIf.value, 200) }
    : null;
  return {
    id: cleanId(raw.id, `q${index + 1}`),
    type,
    label: label || 'Section',
    description: multiline(raw.description, 1000),
    required: type === 'section' ? false : raw.required === true,
    options,
    allowOther: ['mc', 'checkbox'].includes(type) && raw.allowOther === true,
    min: ['number', 'scale', 'rating'].includes(type) ? min : null,
    max: ['number', 'scale', 'rating'].includes(type) ? max : null,
    minLabel: type === 'scale' ? text(raw.minLabel, 60) : '',
    maxLabel: type === 'scale' ? text(raw.maxLabel, 60) : '',
    fileAccept: raw.fileAccept === 'image_pdf' ? 'image_pdf' : 'image',
    maxFiles: type === 'file' ? Math.max(1, Math.min(3, Number(raw.maxFiles) || 1)) : 1,
    role: type === 'short' && raw.role === 'name' ? 'name' : null,
    partySize: type === 'number' && raw.partySize === true,
    onPass: ['short', 'mc', 'dropdown', 'number'].includes(type) && raw.onPass === true,
    showIf: showIf?.questionId ? showIf : null,
    addedAt: typeof raw.addedAt === 'string' && !Number.isNaN(Date.parse(raw.addedAt)) ? raw.addedAt : now,
    removedAt: typeof raw.removedAt === 'string' && !Number.isNaN(Date.parse(raw.removedAt)) ? raw.removedAt : null,
  };
}

/** Cleans a whole form; duplicate ids are renamed, only one name/party-size question survives. */
export function cleanForm(raw: any, now = new Date().toISOString()): EventForm {
  const seen = new Set<string>();
  const questions: FormQuestion[] = [];
  let hasName = false;
  let hasParty = false;
  for (const [index, candidate] of (Array.isArray(raw?.questions) ? raw.questions : []).slice(0, MAX_QUESTIONS).entries()) {
    const question = cleanQuestion(candidate, index, now);
    if (!question) continue;
    let id = question.id;
    for (let n = 2; seen.has(id); n += 1) id = `${question.id}_${n}`;
    question.id = id;
    seen.add(id);
    // Removed questions keep their flags (they are frozen) but no longer count.
    if (question.role === 'name' && !question.removedAt) { if (hasName) question.role = null; else hasName = true; }
    if (question.partySize && !question.removedAt) { if (hasParty) question.partySize = false; else hasParty = true; }
    questions.push(question);
  }
  // showIf may only point at an earlier, live choice question.
  const ids = new Map(questions.map((q, i) => [q.id, i] as const));
  for (const [index, question] of questions.entries()) {
    const target = question.showIf ? ids.get(question.showIf.questionId) : undefined;
    if (question.showIf && (target === undefined || target >= index || !['mc', 'dropdown', 'checkbox'].includes(questions[target].type))) question.showIf = null;
  }
  return {
    title: text(raw?.title, 200),
    description: multiline(raw?.description, 2000),
    questions,
    version: Math.max(1, Number(raw?.version) || 1),
  };
}

/** The parts of a question that may never change once anyone has answered the form. */
function frozenShape(question: FormQuestion) {
  const { removedAt: _removed, addedAt: _added, ...rest } = question;
  return JSON.stringify(rest);
}

export class FormLockError extends Error {
  status = 409;
  constructor(message: string) { super(message); }
}

/**
 * Applies a vendor's edit to the saved form.
 * When `locked` (the form has responses) existing questions must arrive unchanged; a question
 * missing from the edit is kept as removed rather than deleted, and the version is bumped.
 */
export function applyFormUpdate(saved: EventForm, incomingRaw: any, locked: boolean, now = new Date().toISOString()): EventForm {
  if (!locked) return { ...cleanForm(incomingRaw, now), version: saved.version };

  const savedById = new Map(saved.questions.map((q) => [q.id, q]));
  const rawList: any[] = Array.isArray(incomingRaw?.questions) ? incomingRaw.questions.slice(0, MAX_QUESTIONS) : [];
  const incomingIds = new Set(rawList.map((q) => String(q?.id ?? '')));
  const merged: any[] = [];
  for (const [index, raw] of rawList.entries()) {
    const previous = savedById.get(String(raw?.id ?? ''));
    if (!previous) { merged.push({ ...raw, addedAt: now, removedAt: null }); continue; }
    const candidate = cleanQuestion({ ...raw, addedAt: previous.addedAt }, index, now);
    if (!candidate || frozenShape(previous) !== frozenShape(candidate)) {
      throw new FormLockError(`"${previous.label}" already has answers and can't be edited. Remove it and add a new question instead.`);
    }
    merged.push({ ...previous, removedAt: raw?.removedAt ? (previous.removedAt ?? now) : null });
  }
  // A question the client dropped is kept, as removed, right after the saved question before it.
  for (const [index, previous] of saved.questions.entries()) {
    if (incomingIds.has(previous.id)) continue;
    const before = saved.questions.slice(0, index).reverse().find((q) => merged.some((m) => m.id === q.id));
    const at = before ? merged.findIndex((m) => m.id === before.id) + 1 : 0;
    merged.splice(at, 0, { ...previous, removedAt: previous.removedAt ?? now });
  }
  const result = cleanForm({ title: incomingRaw?.title, description: incomingRaw?.description, questions: merged }, now);
  // Frozen questions must survive cleaning untouched (ids, roles, logic).
  for (const question of result.questions) {
    const previous = savedById.get(question.id);
    if (previous && frozenShape(previous) !== frozenShape(question)) {
      throw new FormLockError(`"${previous.label}" already has answers and can't be edited.`);
    }
  }
  const changed = JSON.stringify(result.questions) !== JSON.stringify(saved.questions)
    || result.title !== saved.title || result.description !== saved.description;
  return { ...result, version: changed ? saved.version + 1 : saved.version };
}

/** Questions a guest should see (removed ones are never shown). */
export function publicQuestions(form: EventForm): FormQuestion[] {
  return form.questions.filter((q) => !q.removedAt);
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

export function isVisible(question: FormQuestion, answers: Record<string, AnswerValue>, live?: Set<string>): boolean {
  if (!question.showIf) return true;
  // Logic that points at a removed question no longer applies: show the question.
  if (live && !live.has(question.showIf.questionId)) return true;
  const values = asList(answers[question.showIf.questionId]);
  const hit = values.includes(question.showIf.value);
  return question.showIf.op === 'is' ? hit : !hit;
}

export interface ValidatedAnswers {
  answers: Record<string, AnswerValue>;
  partySize: number;
  guestName: string;
  errors: Record<string, string>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates guest answers against the live questions. Unknown, removed and hidden answers are
 * dropped. `filePrefix` is the storage folder the caller is allowed to reference, so a guest can
 * only attach files they uploaded themselves.
 */
export function validateAnswers(form: EventForm, raw: unknown, filePrefix: string): ValidatedAnswers {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const answers: Record<string, AnswerValue> = {};
  const errors: Record<string, string> = {};
  let partySize = 1;
  let guestName = '';

  const live = new Set(publicQuestions(form).map((q) => q.id));
  for (const question of publicQuestions(form)) {
    if (question.type === 'section') continue;
    if (!isVisible(question, answers, live)) continue;
    const value = input[question.id];
    const blank = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
    if (blank) {
      if (question.required) errors[question.id] = 'This question is required.';
      continue;
    }
    switch (question.type) {
      case 'short': case 'paragraph': {
        const v = question.type === 'short' ? text(value, 500) : multiline(value, 5000);
        if (!v) { if (question.required) errors[question.id] = 'This question is required.'; break; }
        answers[question.id] = v;
        if (question.role === 'name') guestName = text(v, 120);
        break;
      }
      case 'email': {
        const v = text(value, 254);
        if (!EMAIL.test(v)) errors[question.id] = 'Enter a valid email address.';
        else answers[question.id] = v;
        break;
      }
      case 'mc': case 'dropdown': {
        const v = text(value, 200);
        if (question.options.includes(v) || (question.allowOther && v)) answers[question.id] = v;
        else errors[question.id] = 'Choose one of the options.';
        break;
      }
      case 'checkbox': {
        const values = [...new Set(asList(value).map((v) => text(v, 200)).filter(Boolean))];
        const bad = values.filter((v) => !question.options.includes(v));
        if (bad.length && !(question.allowOther && bad.length === 1)) errors[question.id] = 'Choose from the options.';
        else if (values.length) answers[question.id] = values;
        else if (question.required) errors[question.id] = 'This question is required.';
        break;
      }
      case 'number': case 'scale': case 'rating': {
        const n = Number(value);
        if (!Number.isFinite(n)) { errors[question.id] = 'Enter a number.'; break; }
        if ((question.type !== 'number' || question.partySize) && !Number.isInteger(n)) { errors[question.id] = 'Enter a whole number.'; break; }
        if (question.min !== null && n < question.min) { errors[question.id] = `Must be ${question.min} or more.`; break; }
        if (question.max !== null && n > question.max) { errors[question.id] = `Must be ${question.max} or less.`; break; }
        if (question.partySize && n < 1) { errors[question.id] = 'Must be at least 1.'; break; }
        answers[question.id] = n;
        if (question.partySize) partySize = n;
        break;
      }
      case 'date': {
        const v = text(value, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) errors[question.id] = 'Enter a valid date.';
        else answers[question.id] = v;
        break;
      }
      case 'time': {
        const v = text(value, 5);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) errors[question.id] = 'Enter a valid time.';
        else answers[question.id] = v;
        break;
      }
      case 'file': {
        const files = (Array.isArray(value) ? value : []).slice(0, question.maxFiles).map((f: any) => ({
          path: String(f?.path ?? ''), name: text(f?.name, 200), size: Number(f?.size) || 0, type: text(f?.type, 100),
        })).filter((f) => f.path.startsWith(filePrefix) && !f.path.includes('..'));
        if (!files.length) { if (question.required) errors[question.id] = 'Upload a file.'; break; }
        if (question.fileAccept === 'image' && files.some((f) => !f.type.startsWith('image/'))) { errors[question.id] = 'Only images are allowed.'; break; }
        answers[question.id] = files;
        break;
      }
    }
  }
  return { answers, partySize: Math.max(1, Math.min(50, partySize)), guestName, errors };
}

/** Answers allowed on a pass, keyed `answer.<id>`. */
export function passAnswers(form: EventForm, answers: Record<string, AnswerValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const question of form.questions) {
    if (!question.onPass || question.removedAt) continue;
    const value = answers?.[question.id];
    if (value === undefined || value === null || Array.isArray(value)) continue;
    out[`answer.${question.id}`] = String(value).slice(0, 120);
  }
  return out;
}
