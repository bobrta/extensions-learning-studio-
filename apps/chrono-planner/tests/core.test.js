import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyState, normalizeEndDateTime, normalizeEvent } from '../src/model.js';
import { createRecurringEvents, findConflicts, splitAcrossDates, suggestSlots } from '../src/scheduler.js';
import { estimateError, summarizePeriod } from '../src/analytics.js';
import { mergeImportBatch, parseCSV } from '../src/importer.js';

const importFixture = JSON.parse(readFileSync(new URL('../sample-data/chrono-planner-test-data.json', import.meta.url), 'utf8'));

test('cross-midnight activity stays one record and splits minutes by date', () => {
  const event = normalizeEvent({ title: '睡眠', start: '2026-10-16T23:30', end: '2026-10-17T01:00' });
  assert.deepEqual(splitAcrossDates(event).map(x => [x.date, x.minutes]), [['2026-10-16', 30], ['2026-10-17', 60]]);
});

test('same-day earlier end is interpreted as crossing midnight', () => {
  const event = normalizeEvent({ title: '跨夜', start: '2026-10-16T23:00', end: '2026-10-16T00:30' });
  assert.equal(splitAcrossDates(event).reduce((n, x) => n + x.minutes, 0), 90);
  assert.equal(splitAcrossDates(event)[1].date, '2026-10-17');
});

test('form end time on the same date is advanced to the next date when it crosses midnight', () => {
  assert.equal(normalizeEndDateTime('2026-10-16T23:30', '2026-10-16T00:30'), '2026-10-17T00:30');
  assert.equal(normalizeEndDateTime('2026-10-16T21:30', '2026-10-16T22:00'), '2026-10-16T22:00');
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

test('sample JSON import preserves linked tasks, events, and actual records', () => {
  const state = emptyState();
  const rows = importFixture.events.map(event => ({ ...normalizeEvent(event), decision: 'add' }));
  const summary = mergeImportBatch(state, rows, importFixture);

  assert.deepEqual(summary, { addedEvents: 4, replacedEvents: 0, addedTasks: 2, addedActuals: 1, addedReviews: 1, addedGoals: 1 });
  assert.equal(state.tasks.find(task => task.id === 'sample-task-linked').eventId, 'sample-event-focus');
  assert.equal(state.events.find(event => event.id === 'sample-event-focus').taskId, 'sample-task-linked');
  assert.equal(state.actuals[0].eventId, 'sample-event-leisure');
  assert.equal(state.events.find(event => event.id === 'sample-event-sleep').status, 'todo');
  assert.ok(state.events.every(event => Number.isFinite(Date.parse(event.importedAt))));
});

test('normalizing an imported event retains its import marker for later editing', () => {
  const marker = '2026-10-16T08:00:00.000Z';
  assert.equal(normalizeEvent({ title: '匯入行程', importedAt: marker }).importedAt, marker);
});

test('reimporting the same sample skips duplicate content without creating broken links', () => {
  const state = emptyState();
  const rows = importFixture.events.map(event => ({ ...normalizeEvent(event), decision: 'add' }));
  mergeImportBatch(state, rows, importFixture);
  const duplicateRows = importFixture.events.map(event => ({ ...normalizeEvent(event), decision: 'skip' }));
  const summary = mergeImportBatch(state, duplicateRows, importFixture);

  assert.equal(summary.addedEvents, 0);
  assert.equal(summary.addedTasks, 0);
  assert.equal(summary.addedActuals, 0);
  assert.equal(state.events.length, 4);
  assert.equal(state.actuals[0].eventId, state.events.find(event => event.title === '休閒閱讀').id);
});

test('choosing add for a duplicate creates a new event with a unique ID', () => {
  const state = emptyState();
  const first = normalizeEvent(importFixture.events[0]);
  state.events.push(first);
  const rows = [{ ...first, decision: 'add' }];
  mergeImportBatch(state, rows);
  assert.equal(state.events.length, 2);
  assert.notEqual(state.events[0].id, state.events[1].id);
});

test('CSV export headings round-trip Chinese titles, categories, full dates, and multiline notes', () => {
  const csv = '\ufeff"日期","標題","類別","開始日期時間","結束日期時間","狀態","期限","期限種類","備註"\r\n'
    + '"2026-10-20","跨夜睡眠","睡眠","2026-10-20T23:00","2026-10-21T07:00","已完成","","","第一行\n第二行,含逗號""與引號"""\r\n';
  const [event] = parseCSV(csv);
  assert.equal(event.title, '跨夜睡眠');
  assert.equal(event.category, 'sleep');
  assert.equal(event.start, '2026-10-20T23:00');
  assert.equal(event.end, '2026-10-21T07:00');
  assert.equal(event.status, 'done');
  assert.equal(event.notes, '第一行\n第二行,含逗號"與引號"');
});
