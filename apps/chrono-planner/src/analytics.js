import { CATEGORIES, durationMinutes } from './model.js';
import { splitAcrossDates } from './scheduler.js';

export function summarizeByCategory(events, actuals, startDate, endDate) {
  return CATEGORIES.map(category => {
    const planned = events.flatMap(event => splitAcrossDates(event).filter(part => part.date >= startDate && part.date <= endDate && event.category === category.id).map(part => part.minutes)).reduce((sum, n) => sum + n, 0);
    const actual = actuals.flatMap(entry => splitAcrossDates(entry).filter(part => part.date >= startDate && part.date <= endDate && entry.category === category.id).map(part => part.minutes)).reduce((sum, n) => sum + n, 0);
    return { ...category, planned, actual, difference: actual - planned };
  }).filter(row => row.planned || row.actual);
}

export function summarizePeriod(events, actuals, startDate, endDate) {
  const categoryRows = summarizeByCategory(events, actuals, startDate, endDate);
  const planned = categoryRows.reduce((sum, row) => sum + row.planned, 0);
  const actual = categoryRows.reduce((sum, row) => sum + row.actual, 0);
  const actualSegments = actuals.flatMap(splitAcrossDates).filter(part => part.date >= startDate && part.date <= endDate);
  return {
    plannedMinutes: planned, actualMinutes: actual, differenceMinutes: actual - planned,
    actualRecords: actualSegments.length, trackedDays: new Set(actualSegments.map(x => x.date)).size,
    longestBlockMinutes: actualSegments.reduce((max, x) => Math.max(max, x.minutes), 0),
    categories: categoryRows
  };
}

export function estimateError(events, actuals) {
  const actualByEvent = new Map();
  for (const actual of actuals) if (actual.eventId) actualByEvent.set(actual.eventId, (actualByEvent.get(actual.eventId) || 0) + splitAcrossDates(actual).reduce((sum, x) => sum + x.minutes, 0));
  const pairs = events.filter(event => actualByEvent.has(event.id) && Number(event.estimatedMinutes) > 0).map(event => ({
    eventId: event.id, estimate: Number(event.estimatedMinutes), actual: actualByEvent.get(event.id)
  }));
  if (!pairs.length) return { n: 0, meanAbsoluteError: null, bias: null };
  return { n: pairs.length,
    meanAbsoluteError: pairs.reduce((sum, p) => sum + Math.abs(p.actual - p.estimate), 0) / pairs.length,
    bias: pairs.reduce((sum, p) => sum + p.actual - p.estimate, 0) / pairs.length };
}

export function getEventDuration(event) { return durationMinutes(event.start.slice(11, 16), event.end.slice(11, 16)); }
