import { CATEGORIES, normalizeActual, normalizeEvent, uid } from './model.js';

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
  return normalizeEvent({ ...row, category, source: row.source || 'imported' });
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
