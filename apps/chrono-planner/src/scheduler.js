import { addDays, dateRange, durationMinutes, minutesOf, normalizeEvent, startOfWeek, timeOf, uid } from './model.js';

export function eventInterval(event) {
  const startDate = event.start.slice(0, 10), startMinute = minutesOf(event.start.slice(11, 16));
  const rawEndDate = event.end.slice(0, 10), endMinute = minutesOf(event.end.slice(11, 16));
  const endDate = rawEndDate < startDate || (rawEndDate === startDate && endMinute <= startMinute) ? addDays(startDate, 1) : rawEndDate;
  const days = Math.round((new Date(`${endDate}T12:00:00`) - new Date(`${startDate}T12:00:00`)) / 86400000);
  return { startDate, startMinute, endDate, endMinute, days, duration: days * 1440 + endMinute - startMinute };
}

export function splitAcrossDates(event) {
  const { startDate, startMinute, duration } = eventInterval(event);
  let cursor = startDate, remaining = duration, minute = startMinute;
  const segments = [];
  while (remaining > 0) {
    const span = Math.min(remaining, 1440 - minute);
    segments.push({ date: cursor, startMinute: minute, endMinute: minute + span, minutes: span });
    remaining -= span; cursor = addDays(cursor, 1); minute = 0;
  }
  return segments;
}

export function overlaps(a, b) {
  const as = new Date(a.start).getTime(), ae = new Date(a.end).getTime();
  const bs = new Date(b.start).getTime(), be = new Date(b.end).getTime();
  return as < be && bs < ae;
}

export function findConflicts(candidate, events, ignoreId = null) {
  return events.filter(event => event.id !== ignoreId && overlaps(candidate, event));
}

export function createRecurringEvents(input, { throughDate = addDays(input.start.slice(0, 10), 365) } = {}) {
  const base = normalizeEvent(input), recurrence = base.recurrence;
  if (!recurrence?.frequency || recurrence.frequency === 'none') return [base];
  const step = Math.max(1, Number(recurrence.interval) || 1);
  const startDate = base.start.slice(0, 10), startTime = base.start.slice(11, 16), endClock = base.end.slice(11, 16);
  const duration = eventInterval(base).duration;
  const dates = [];
  for (const date of dateRange(startDate, Math.min(370, Math.ceil((new Date(`${throughDate}T12:00`) - new Date(`${startDate}T12:00`)) / 86400000) + 1))) {
    const diffDays = Math.round((new Date(`${date}T12:00`) - new Date(`${startDate}T12:00`)) / 86400000);
    let include = false;
    if (recurrence.frequency === 'daily') include = diffDays % step === 0;
    if (recurrence.frequency === 'weekly') include = Math.floor(diffDays / 7) % step === 0 && (diffDays % 7 === 0 || (recurrence.weekdays || []).includes(parseDateWeekday(date)));
    if (recurrence.frequency === 'monthly') {
      const first = new Date(`${startDate}T12:00`), current = new Date(`${date}T12:00`);
      include = current.getDate() === first.getDate() && ((current.getFullYear() - first.getFullYear()) * 12 + current.getMonth() - first.getMonth()) % step === 0;
    }
    if (include && date <= throughDate) dates.push(date);
  }
  const seriesId = base.seriesId || uid('series');
  return dates.map((date, index) => {
    const start = `${date}T${startTime}`;
    const endDate = duration >= 1440 || minutesOf(startTime) + duration >= 1440 ? addDays(date, Math.floor((minutesOf(startTime) + duration) / 1440)) : date;
    const end = `${endDate}T${timeOf(minutesOf(startTime) + duration)}`;
    return normalizeEvent({ ...base, id: index === 0 ? base.id : uid(), start, end, seriesId, occurrenceDate: date,
      recurrence: index === 0 ? recurrence : null });
  });
}

function parseDateWeekday(date) { return parseInt((new Date(`${date}T12:00:00`).getDay() + 6) % 7, 10); }

export function suggestSlots(task, events, settings, rangeStart, days = 7, maxPerDay = 3) {
  const duration = Math.max(15, Number(task.estimatedMinutes) || Number(settings.defaultBlockMinutes) || 30);
  const workStart = Number(settings.dayStartMinute ?? 7 * 60), workEnd = Number(settings.dayEndMinute ?? 22 * 60);
  const dates = dateRange(rangeStart || startOfWeek(new Date().toISOString().slice(0, 10)), days);
  const suggestions = [];
  for (const date of dates) {
    const dayEvents = events.flatMap(event => splitAcrossDates(event).filter(segment => segment.date === date).map(segment => ({ start: segment.startMinute, end: segment.endMinute }))).sort((a, b) => a.start - b.start);
    let cursor = workStart, count = 0;
    for (const event of dayEvents) {
      if (event.start - cursor >= duration) { suggestions.push(slot(date, cursor, duration)); count++; }
      cursor = Math.max(cursor, event.end);
      if (count >= maxPerDay) break;
    }
    if (count < maxPerDay && workEnd - cursor >= duration) suggestions.push(slot(date, cursor, duration));
  }
  const deadline = task.deadline ? new Date(task.deadline).getTime() : Infinity;
  return suggestions.filter(x => new Date(x.start).getTime() <= deadline).slice(0, 8);
}

function slot(date, startMinute, duration) {
  const start = `${date}T${timeOf(startMinute)}`;
  const endDate = startMinute + duration >= 1440 ? addDays(date, 1) : date;
  return { start, end: `${endDate}T${timeOf(startMinute + duration)}`, minutes: duration };
}

export function getWeekDates(date) { return dateRange(startOfWeek(date), 7); }
