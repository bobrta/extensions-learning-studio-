export const STORAGE_KEY = 'CHRONO_PLANNER_V2';
export const CATEGORIES = [
  { id: 'sleep', label: '睡眠', color: '#6750a4' },
  { id: 'rest', label: '休息／恢復', color: '#5b8c85' },
  { id: 'exercise', label: '運動', color: '#2e8b57' },
  { id: 'leisure', label: '玩樂／休閒', color: '#d17b36' },
  { id: 'work', label: '工作／學習', color: '#0f6cbd' },
  { id: 'review', label: '回饋／回顧', color: '#7a6db0' },
  { id: 'admin', label: '整理／行政', color: '#758196' },
  { id: 'social', label: '社交／生活照護', color: '#bf6681' },
  { id: 'commute', label: '通勤／移動', color: '#7b8490' },
  { id: 'other', label: '其他', color: '#9b7653' }
];
export const TASK_STATUSES = [
  { id: 'todo', label: '未開始' }, { id: 'in_progress', label: '進行中' },
  { id: 'done', label: '已完成' }, { id: 'partial', label: '部分完成' },
  { id: 'skipped', label: '取消／略過' }
];
export const AWARENESS = ['當下', '分心但有察覺', '分心且未察覺', '不確定'];
export const TIME_FEEL = ['感覺很快', '差不多', '感覺很慢', '未知'];
export const uid = (prefix = 'evt') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
export const pad = n => String(n).padStart(2, '0');
export const toISODate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const parseDate = value => new Date(`${value}T12:00:00`);
export const addDays = (value, amount) => { const d = parseDate(value); d.setDate(d.getDate() + amount); return toISODate(d); };
export const startOfWeek = value => { const d = parseDate(value); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISODate(d); };
export const dateRange = (start, count) => Array.from({ length: count }, (_, i) => addDays(start, i));
export const minutesOf = time => { const [h, m] = String(time || '00:00').split(':').map(Number); return h * 60 + m; };
export const timeOf = minutes => `${pad(Math.floor((((minutes % 1440) + 1440) % 1440) / 60))}:${pad(((minutes % 60) + 60) % 60)}`;
export const durationMinutes = (start, end) => {
  const s = minutesOf(start), e = minutesOf(end);
  return e > s ? e - s : e + 1440 - s;
};
export const categoryLabel = id => CATEGORIES.find(x => x.id === id)?.label || '其他';
export const categoryColor = id => CATEGORIES.find(x => x.id === id)?.color || '#9b7653';

export function emptyState() {
  return {
    schemaVersion: 2,
    tasks: [], events: [], actuals: [], reviews: [], goals: [],
    settings: { theme: 'light', palette: 'frost', defaultBlockMinutes: 30, longBlockMinutes: 60, shortGapMaxMinutes: 30, reviewDay: 0, reviewTime: '18:00', weekStartsOn: 1 }
  };
}

export function normalizeEvent(input = {}) {
  const start = input.start || `${input.date || toISODate(new Date())}T09:00`;
  const end = input.end || `${input.date || toISODate(new Date())}T10:00`;
  return {
    id: input.id || uid(), title: String(input.title || '未命名活動').trim(), category: input.category || 'work',
    start, end, status: input.status || 'todo', taskId: input.taskId || null, tags: Array.isArray(input.tags) ? input.tags : [],
    deadline: input.deadline || null, deadlineKind: input.deadlineKind || null, deadlineSource: input.deadlineSource || '',
    estimatedMinutes: Number.isFinite(Number(input.estimatedMinutes)) ? Number(input.estimatedMinutes) : durationMinutes(start.slice(11, 16), end.slice(11, 16)),
    notes: String(input.notes || ''), seriesId: input.seriesId || null, recurrence: input.recurrence || null,
    externalUid: input.externalUid || null, source: input.source || 'local',
    occurrenceDate: input.occurrenceDate || start.slice(0, 10), isFixed: Boolean(input.isFixed), createdAt: input.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

export function normalizeActual(input = {}) {
  return {
    id: input.id || uid('act'), eventId: input.eventId || null, title: String(input.title || '').trim(), category: input.category || 'other',
    start: input.start, end: input.end, segments: Array.isArray(input.segments) ? input.segments : [],
    status: input.status || 'done', focus: input.focus ?? null, energy: input.energy ?? null,
    awareness: input.awareness || null, timeFeel: input.timeFeel || null, interruptions: Number(input.interruptions) || 0,
    interruptionMinutes: Number(input.interruptionMinutes) || 0, reason: input.reason || '', notes: input.notes || '', source: input.source || 'manual',
    createdAt: input.createdAt || new Date().toISOString()
  };
}

export function migrateLegacyState(raw) {
  if (!raw || typeof raw !== 'object') return emptyState();
  const state = emptyState();
  const legacyTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  for (const task of legacyTasks) {
    if (!task || !task.title || !task.date) continue;
    const start = `${task.date}T${task.startTime || '09:00'}`;
    const estimated = Math.max(0, Number(task.estimatedMinutes) || 0);
    const endDate = task.endDate || (estimated && minutesOf(task.startTime || '09:00') + estimated >= 1440 ? addDays(task.date, 1) : task.date);
    const endTime = task.endTime || timeOf(minutesOf(task.startTime || '09:00') + (estimated || 30));
    const statusMap = { todo: 'todo', in_progress: 'in_progress', done: 'done', partial: 'partial', cancelled: 'skipped' };
    state.events.push(normalizeEvent({ id: String(task.id || uid()), title: task.title, category: mapLegacyCategory(task), start,
      end: `${endDate}T${endTime}`, status: statusMap[task.status] || 'todo', estimatedMinutes: estimated, notes: task.notes || '',
      deadline: task.deadline || null, deadlineKind: task.deadlineKind === 'external' ? 'external' : task.deadlineKind === 'self' ? 'self' : null,
      deadlineSource: task.deadlineSource || '', tags: task.tags || [], isFixed: Boolean(task.isFixed) }));
  }
  for (const log of (Array.isArray(raw.activityLogs) ? raw.activityLogs : [])) {
    if (!log?.date || !log?.startTime || !log?.endTime) continue;
    const start = `${log.date}T${log.startTime}`;
    const endDate = minutesOf(log.endTime) <= minutesOf(log.startTime) ? addDays(log.date, 1) : log.date;
    state.actuals.push(normalizeActual({ id: log.id, title: log.title, category: mapLegacyCategory(log), start,
      end: `${endDate}T${log.endTime}`, focus: log.focusRating || null, energy: log.energyAfter || null,
      interruptions: log.interruptions, interruptionMinutes: log.interruptionMinutes, notes: log.note || '', source: 'legacy' }));
  }
  if (raw.settings) state.settings = { ...state.settings, theme: raw.settings.theme || 'light' };
  return state;
}

function mapLegacyCategory(item) {
  const text = `${item.category || ''} ${item.project || ''} ${item.title || ''}`;
  if (/健康休息|睡眠/.test(text)) return /睡眠/.test(text) ? 'sleep' : 'rest';
  if (/運動/.test(text)) return 'exercise';
  if (/玩樂|休閒/.test(text)) return 'leisure';
  if (/會議|社交/.test(text)) return 'social';
  if (/行政|整理/.test(text)) return 'admin';
  if (/回顧|反饋/.test(text)) return 'review';
  if (/通勤|移動/.test(text)) return 'commute';
  return 'work';
}
