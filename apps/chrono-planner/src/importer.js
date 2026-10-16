import { CATEGORIES, normalizeActual, normalizeEndDateTime, normalizeEvent, uid } from './model.js';

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function isCalendarDateTime(value) {
  if (!DATE_TIME.test(value || '')) return false;
  const [date, time] = value.split('T');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const parsed = new Date(year, month - 1, day, hour, minute);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
    && parsed.getHours() === hour && parsed.getMinutes() === minute;
}

export function validateImportEvent(input) {
  const errors = [];
  if (!String(input?.title || '').trim()) errors.push({ field: 'title', reason: '缺少活動名稱' });
  if (!isCalendarDateTime(input?.start)) errors.push({ field: 'start', reason: '開始日期或時間格式無效' });
  if (!isCalendarDateTime(input?.end)) errors.push({ field: 'end', reason: '結束日期或時間格式無效' });
  if (!errors.length && new Date(input.end) <= new Date(input.start)) errors.push({ field: 'end', reason: '結束必須晚於開始；跨午夜請填寫隔天日期' });
  return errors;
}

/** Prepare a non-mutating, reviewable import preview. Invalid rows are never normalized. */
export function previewImportEvents(inputRows, existingEvents = []) {
  return (Array.isArray(inputRows) ? inputRows : []).map((input, index) => {
    const errors = validateImportEvent(input);
    if (errors.length) return { index, input, event: null, errors, duplicate: null, decision: 'invalid' };
    const event = normalizeImported(input);
    const duplicate = findDuplicate(event, existingEvents);
    return { index, input, event, errors: [], duplicate, decision: duplicate ? 'skip' : 'add' };
  });
}

const taipeiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});

function taipeiDateTime(date) {
  const parts = Object.fromEntries(taipeiFormatter.formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseIcsDateTime(value, parameters = '') {
  const raw = String(value || '').trim();
  const isAllDay = /^\d{8}$/.test(raw);
  if (isAllDay) return { value: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00`, allDay: true };
  if (!/^\d{8}T\d{6}Z?$/.test(raw)) return { error: '日期時間格式不支援' };
  const zone = parameters.match(/TZID=([^;:]+)/i)?.[1];
  if (zone && zone !== 'Asia/Taipei') return { error: `不支援時區 ${zone}` };
  if (raw.endsWith('Z')) return { value: taipeiDateTime(new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`)), allDay: false };
  return { value: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}`, allDay: false };
}

/** Parse only the documented ICS subset. Unsupported recurrence and time zones remain visible as issues. */
export function parseICS(text) {
  const blocks = String(text || '').replace(/\r?\n[ \t]/g, '').match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const events = [], issues = [];
  const unescape = value => String(value || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
  blocks.forEach((block, index) => {
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const name = line.slice(0, separator), key = name.split(';')[0].toUpperCase();
      fields[key] = { value: line.slice(separator + 1), parameters: name.slice(key.length) };
    }
    if (fields.RRULE) { issues.push({ row: index + 1, field: 'RRULE', reason: '尚未支援 ICS 重複規則，這筆資料未匯入' }); return; }
    const start = parseIcsDateTime(fields.DTSTART?.value, fields.DTSTART?.parameters);
    const end = parseIcsDateTime(fields.DTEND?.value, fields.DTEND?.parameters);
    if (start.error) { issues.push({ row: index + 1, field: 'DTSTART', reason: start.error }); return; }
    if (end.error) { issues.push({ row: index + 1, field: 'DTEND', reason: end.error }); return; }
    if (!start.value || !end.value) { issues.push({ row: index + 1, field: '日期', reason: '缺少 DTSTART 或 DTEND' }); return; }
    events.push({ title: unescape(fields.SUMMARY?.value || '匯入活動'), start: start.value, end: end.value,
      notes: unescape(fields.DESCRIPTION?.value), externalUid: fields.UID?.value || null, allDay: start.allDay && end.allDay });
  });
  return { events, issues };
}

export function parseCSV(text) {
  const records = [];
  let record = [], cell = '', quoted = false;
  const source = String(text || '').replace(/^\ufeff/, '');
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' && quoted && source[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { record.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      record.push(cell);
      if (record.some(value => value !== '')) records.push(record);
      record = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV 引號沒有成對，請重新匯出檔案後再試');
  record.push(cell);
  if (record.some(value => value !== '')) records.push(record);
  if (records.length < 2) return [];
  const headers = records.shift().map(value => value.trim().toLocaleLowerCase());
  const read = (row, ...keys) => {
    for (const key of keys) {
      const index = headers.indexOf(key.toLocaleLowerCase());
      if (index >= 0 && row[index] !== undefined && row[index] !== '') return row[index];
    }
    return '';
  };
  return records.map(row => {
    const date = read(row, 'date', '日期');
    const startValue = read(row, 'start', '開始', '開始時間', '開始日期時間');
    const endValue = read(row, 'end', '結束', '結束時間', '結束日期時間');
    const start = startValue.includes('T') ? startValue : date ? `${date}T${startValue || '09:00'}` : '';
    const end = endValue.includes('T') ? endValue : date ? `${date}T${endValue || '10:00'}` : '';
    const title = read(row, 'title', '標題', '活動', 'summary');
    if (!title || !start || !end) return null;
    const rawStatus = read(row, 'status', '狀態');
    const status = ({ '未開始': 'todo', '進行中': 'in_progress', '已完成': 'done', '部分完成': 'partial', '取消／略過': 'skipped' })[rawStatus] || rawStatus || 'todo';
    return normalizeImported({
      title, category: read(row, 'category', '類別'), start, end, status,
      deadline: read(row, 'deadline', '期限') || null,
      deadlineKind: read(row, 'deadlinekind', '期限種類') || null, notes: read(row, 'notes', '備註'),
      estimatedMinutes: Number(read(row, 'estimatedminutes', '預估分鐘')) || undefined
    });
  }).filter(Boolean);
}

export function findDuplicate(row, events) {
  if (row.externalUid) {
    const byUid = events.find(event => event.externalUid === row.externalUid);
    if (byUid) return byUid;
  }
  return events.find(event => event.title.trim().toLocaleLowerCase() === String(row.title || '').trim().toLocaleLowerCase()
    && event.start === row.start && event.end === row.end) || null;
}

export function normalizeImported(row) {
  const categoryInput = String(row.category || 'other').trim();
  const category = CATEGORIES.find(item => item.id === categoryInput || item.label === categoryInput)?.id || 'other';
  return normalizeEvent({ ...row, category, end: normalizeEndDateTime(row.start, row.end), source: row.source || 'imported' });
}

function uniqueId(preferred, collection, prefix) {
  if (preferred && !collection.some(item => item.id === preferred)) return preferred;
  return uid(prefix);
}

/** Merge a reviewed import into a mutable application state, preserving links between records. */
export function mergeImportBatch(store, rows, extras = {}) {
  const eventsIn = Array.isArray(rows) ? rows : [];
  const tasksIn = Array.isArray(extras.tasks) ? extras.tasks : [];
  const actualsIn = Array.isArray(extras.actuals) ? extras.actuals : [];
  const reviewsIn = Array.isArray(extras.reviews) ? extras.reviews : [];
  const goalsIn = Array.isArray(extras.goals) ? extras.goals : [];
  const eventIds = new Map();
  const taskIds = new Map();
  const eventActions = [];
  const reservedEventIds = new Set(store.events.map(event => event.id));
  const allocateEventId = preferred => {
    let id = preferred && !reservedEventIds.has(preferred) ? preferred : uid('evt');
    while (reservedEventIds.has(id)) id = uid('evt');
    reservedEventIds.add(id);
    return id;
  };

  for (const row of eventsIn) {
    const duplicate = findDuplicate(row, store.events);
    if (row.decision === 'skip') {
      if (duplicate && row.id) eventIds.set(row.id, duplicate.id);
      continue;
    }
    const replace = row.decision === 'replace' && duplicate;
    const existing = replace ? duplicate : null;
    const targetId = existing?.id || allocateEventId(row.id);
    if (row.id) eventIds.set(row.id, targetId);
    eventActions.push({ row, targetId, existingId: existing?.id || null });
  }

  let addedTasks = 0;
  for (const task of tasksIn) {
    const existing = store.tasks.find(item => item.id === task.id);
    const targetId = existing?.id || uniqueId(task.id, store.tasks, 'task');
    if (task.id) taskIds.set(task.id, targetId);
    if (!existing) {
      store.tasks.push({ ...task, id: targetId, eventId: eventIds.get(task.eventId) || store.events.find(item => item.id === task.eventId)?.id || null });
      addedTasks++;
    }
  }

  let addedEvents = 0;
  let replacedEvents = 0;
  for (const { row, targetId, existingId } of eventActions) {
    const event = normalizeImported({ ...row, id: targetId, importedAt: row.importedAt || new Date().toISOString(), taskId: taskIds.get(row.taskId) || store.tasks.find(item => item.id === row.taskId)?.id || null });
    if (existingId) {
      store.events = store.events.map(item => item.id === existingId ? event : item);
      replacedEvents++;
    } else {
      store.events.push(event);
      addedEvents++;
    }
  }

  let addedActuals = 0;
  for (const actual of actualsIn) {
    if (store.actuals.some(item => item.id === actual.id)) continue;
    const linkedEventId = actual.eventId ? eventIds.get(actual.eventId) || null : null;
    store.actuals.push(normalizeActual({ ...actual, eventId: linkedEventId }));
    addedActuals++;
  }

  const appendUnique = (target, incoming, prefix) => {
    let count = 0;
    for (const item of incoming) {
      if (target.some(existing => existing.id === item.id)) continue;
      target.push({ ...item, id: uniqueId(item.id, target, prefix) });
      count++;
    }
    return count;
  };
  const addedReviews = appendUnique(store.reviews, reviewsIn, 'review');
  const addedGoals = appendUnique(store.goals, goalsIn, 'goal');
  return { addedEvents, replacedEvents, addedTasks, addedActuals, addedReviews, addedGoals };
}
