import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent } from '../src/model.js';
import { createRecurringEvents, findConflicts, splitAcrossDates, suggestSlots } from '../src/scheduler.js';
import { estimateError, summarizePeriod } from '../src/analytics.js';

test('cross-midnight activity stays one record and splits minutes by date', () => {
  const event = normalizeEvent({ title: '睡眠', start: '2026-10-16T23:30', end: '2026-10-17T01:00' });
  assert.deepEqual(splitAcrossDates(event).map(x => [x.date, x.minutes]), [['2026-10-16', 30], ['2026-10-17', 60]]);
});

test('same-day earlier end is interpreted as crossing midnight', () => {
  const event = normalizeEvent({ title: '跨夜', start: '2026-10-16T23:00', end: '2026-10-16T00:30' });
  assert.equal(splitAcrossDates(event).reduce((n, x) => n + x.minutes, 0), 90);
  assert.equal(splitAcrossDates(event)[1].date, '2026-10-17');
});

test('back-to-back events do not count as overlap, intersecting events do', () => {
  const a = normalizeEvent({ id: 'a', title: 'A', start: '2026-10-16T09:00', end: '2026-10-16T10:00' });
  const b = normalizeEvent({ id: 'b', title: 'B', start: '2026-10-16T10:00', end: '2026-10-16T11:00' });
  const c = normalizeEvent({ id: 'c', title: 'C', start: '2026-10-16T09:30', end: '2026-10-16T10:30' });
  assert.equal(findConflicts(b, [a]).length, 0);
  assert.deepEqual(findConflicts(c, [a]).map(x => x.id), ['a']);
});

test('weekly recurrence creates matching occurrences through its range', () => {
  const [first, ...rest] = createRecurringEvents(normalizeEvent({ id: 'weekly', title: '課程', start: '2026-10-05T09:00', end: '2026-10-05T10:00', recurrence: { frequency: 'weekly', interval: 1 } }), { throughDate: '2026-10-26' });
  assert.equal(first.id, 'weekly');
  assert.deepEqual([first, ...rest].map(x => x.start.slice(0, 10)), ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  assert.equal(new Set([first, ...rest].map(x => x.seriesId)).size, 1);
});

test('slot suggestions avoid existing event intervals and honor estimated length', () => {
  const task = { title: '讀書', estimatedMinutes: 60 };
  const events = [normalizeEvent({ title: '固定課', start: '2026-10-12T07:00', end: '2026-10-12T09:00', isFixed: true })];
  const slots = suggestSlots(task, events, { dayStartMinute: 7 * 60, dayEndMinute: 12 * 60 }, '2026-10-12', 1, 3);
  assert.ok(slots.length > 0);
  assert.ok(slots.every(x => x.start >= '2026-10-12T09:00'));
  assert.ok(slots.every(x => x.minutes === 60));
});

test('analytics excludes unknown actual values and reports samples honestly', () => {
  const event = normalizeEvent({ id: 'planned', title: '讀書', category: 'work', start: '2026-10-12T09:00', end: '2026-10-12T10:00', estimatedMinutes: 60 });
  const summary = summarizePeriod([event], [], '2026-10-12', '2026-10-18');
  const error = estimateError([event], []);
  assert.equal(summary.plannedMinutes, 60);
  assert.equal(summary.actualMinutes, 0);
  assert.equal(summary.actualRecords, 0);
  assert.deepEqual(error, { n: 0, meanAbsoluteError: null, bias: null });
});

test('estimate error is paired only when an actual record links to a planned event', () => {
  const event = normalizeEvent({ id: 'planned', title: '讀書', category: 'work', start: '2026-10-12T09:00', end: '2026-10-12T10:00', estimatedMinutes: 60 });
  const actual = { id: 'actual', eventId: 'planned', title: '讀書', category: 'work', start: '2026-10-12T09:00', end: '2026-10-12T09:45' };
  const result = estimateError([event], [actual]);
  assert.equal(result.n, 1);
  assert.equal(result.meanAbsoluteError, 15);
  assert.equal(result.bias, -15);
});
