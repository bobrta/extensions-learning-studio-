import {
  AWARENESS, CATEGORIES, STORAGE_KEY, TASK_STATUSES, TIME_FEEL, addDays, categoryColor, categoryLabel,
  dateRange, durationMinutes, emptyState, minutesOf, normalizeActual, normalizeEvent, parseDate, startOfWeek,
  timeOf, toISODate, uid, migrateLegacyState
} from './model.js';
import { createRecurringEvents, findConflicts, getWeekDates, suggestSlots, splitAcrossDates } from './scheduler.js';
import { estimateError, summarizeByCategory, summarizePeriod } from './analytics.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localToday = () => toISODate(new Date());
const fmtDate = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const fmtTime = value => value?.slice(11, 16) || '';
const fmtDuration = minutes => `${Math.floor(minutes / 60)}小時${minutes % 60 ? ` ${minutes % 60}分` : ''}`;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.schemaVersion === 2 && Array.isArray(saved.events) && Array.isArray(saved.tasks)) return { ...emptyState(), ...saved };
  } catch { /* Keep a clean state; malformed storage is never overwritten until the first explicit edit. */ }
  return emptyState();
}

const state = loadState();
let selectedDate = localToday();
let viewMode = window.matchMedia('(max-width: 700px)').matches ? 'day' : 'week';
let currentPage = 'workbench';
let selectedEventId = null;
let searchText = '';
let filterCategory = 'all';
let undoStack = [];
let toastTimer;
let modalDraft = null;
let pendingImportExtras = { tasks: [], actuals: [], reviews: [], goals: [] };

function persist(label = '已自動保存') {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const el = $('#save-state');
    if (el) el.textContent = `${label} · ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    notify('本機儲存空間不足，請先匯出 JSON');
  }
}

function change(mutator, message = '已保存') {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 30) undoStack.shift();
  mutator(state);
  persist();
  render();
  notify(message);
}

function undo() {
  const snapshot = undoStack.pop();
  if (!snapshot) return notify('目前沒有可復原的操作');
  Object.assign(state, JSON.parse(snapshot));
  persist('已復原'); render(); notify('已復原上一個操作');
}

function notify(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

function selectedPeriodDates() {
  if (viewMode === 'day') return [selectedDate];
  if (viewMode === 'month') {
    const d = parseDate(selectedDate); d.setDate(1);
    const mondayOffset = (d.getDay() + 6) % 7; d.setDate(d.getDate() - mondayOffset);
    return dateRange(toISODate(d), 42);
  }
  return getWeekDates(selectedDate);
}

function allEventsForDate(date) {
  return state.events.filter(event => splitAcrossDates(event).some(part => part.date === date));
}

function updateRangeLabel() {
  const label = $('#range-label');
  if (!label) return;
  if (viewMode === 'day' || (window.matchMedia('(max-width: 540px)').matches && viewMode === 'week')) label.textContent = `${selectedDate} ${['日', '一', '二', '三', '四', '五', '六'][parseDate(selectedDate).getDay()]}`;
  else if (viewMode === 'month') label.textContent = `${parseDate(selectedDate).getFullYear()} 年 ${parseDate(selectedDate).getMonth() + 1} 月`;
  else { const dates = getWeekDates(selectedDate); label.textContent = `${fmtDate(dates[0])} – ${fmtDate(dates[6])}`; }
}

function render() {
  document.body.dataset.theme = state.settings.theme || 'light';
  document.body.dataset.palette = state.settings.palette || 'frost';
  $$('.nav-item[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === currentPage));
  $('#page-title').textContent = ({ workbench: '排程工作台', analytics: '分析與回顧', knowledge: '公式與知識庫', data: '匯入與設定' })[currentPage];
  updateRangeLabel();
  const root = $('#page-content');
  if (currentPage === 'workbench') root.innerHTML = renderWorkbench();
  if (currentPage === 'analytics') root.innerHTML = renderAnalytics();
  if (currentPage === 'knowledge') root.innerHTML = renderKnowledge();
  if (currentPage === 'data') root.innerHTML = renderData();
  if (selectedEventId && !state.events.some(event => event.id === selectedEventId)) selectedEventId = null;
}

function renderWorkbench() {
  const dates = selectedPeriodDates();
  const unplanned = state.tasks.filter(task => !task.eventId && task.status !== 'done' && task.status !== 'skipped');
  const pendingReview = !state.reviews.some(review => review.periodEnd === selectedDate && review.type === 'daily');
  const now = new Date();
  const todayEvent = state.events.find(event => event.start.slice(0, 10) === localToday() && event.status === 'in_progress');
  return `<section class="workbench-layout">
    <aside class="left-rail">
      <div class="rail-card mini-calendar"><div class="rail-heading"><strong>日期</strong><div><button class="tiny-button" data-action="mini-prev">‹</button><button class="tiny-button" data-action="mini-next">›</button></div></div>${renderMiniCalendar()}</div>
      <div class="rail-card"><div class="rail-heading"><strong>待辦收件匣</strong><span class="count-pill">${unplanned.length}</span></div><div class="task-list">${unplanned.length ? unplanned.map(renderTaskCard).join('') : '<p class="empty compact">目前沒有未排程待辦。<br>點「快速新增」記下下一件事。</p>'}</div></div>
      <div class="rail-card review-reminder"><span class="eyebrow">每日／每週回顧</span><strong>${pendingReview ? '今天的回顧還沒完成' : '今天已完成回顧'}</strong><p>回顧只需記下實際完成、主要差異和下一步。</p><button class="text-button" data-action="open-review">開始回顧 →</button></div>
      ${todayEvent ? `<div class="rail-card timer-card"><span class="eyebrow">進行中的活動</span><strong>${escapeHTML(todayEvent.title)}</strong><p>${fmtTime(todayEvent.start)} 開始</p><button class="text-button" data-action="finish-event" data-id="${todayEvent.id}">記錄完成 →</button></div>` : ''}
    </aside>
    <section class="calendar-area">
      <div class="calendar-toolbar"><div class="segmented"><button data-view="day" class="${viewMode === 'day' ? 'selected' : ''}">日</button><button data-view="week" class="${viewMode === 'week' ? 'selected' : ''}">週</button><button data-view="month" class="${viewMode === 'month' ? 'selected' : ''}">月</button></div>
        <div class="calendar-filters"><input id="calendar-search" class="search-input" placeholder="搜尋活動／備註" value="${escapeHTML(searchText)}"><select id="category-filter" class="select-control"><option value="all">所有分類</option>${CATEGORIES.map(c => `<option value="${c.id}" ${filterCategory === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div></div>
      ${viewMode === 'month' ? renderMonthGrid(dates) : renderTimeGrid(dates)}
      <div class="calendar-legend">${CATEGORIES.slice(0, 7).map(c => `<span><i style="--category:${c.color}"></i>${c.label}</span>`).join('')}<span class="legend-note">重疊事件並排；空白時間不會自動視為可用</span></div>
    </section>
    <aside class="inspector" id="inspector">${renderInspector()}</aside>
  </section>`;
}

function renderMiniCalendar() {
  const date = parseDate(selectedDate), first = new Date(date.getFullYear(), date.getMonth(), 1, 12), offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - offset);
  const dates = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return toISODate(d); });
  return `<div class="mini-month-label">${date.getFullYear()} 年 ${date.getMonth() + 1} 月</div><div class="mini-grid">${['一','二','三','四','五','六','日'].map(x => `<span class="mini-weekday">${x}</span>`).join('')}${dates.map(d => `<button class="mini-day ${d === selectedDate ? 'chosen' : ''} ${d.slice(0, 7) !== selectedDate.slice(0, 7) ? 'outside' : ''} ${d === localToday() ? 'today' : ''}" data-date="${d}">${Number(d.slice(8, 10))}</button>`).join('')}</div>`;
}

function renderTaskCard(task) {
  return `<article class="task-card" draggable="true" data-drag-task="${escapeHTML(task.id)}"><span class="task-dot" style="--category:${categoryColor(task.category)}"></span><div class="task-main"><strong>${escapeHTML(task.title)}</strong><small>${categoryLabel(task.category)}${task.estimatedMinutes ? ` · 約 ${task.estimatedMinutes} 分` : ''}${task.deadline ? ` · 期限 ${task.deadline}` : ''}</small></div><button class="suggest-button" data-action="suggest" data-id="${escapeHTML(task.id)}" title="建議時段">⋯</button></article>`;
}

function renderTimeGrid(dates) {
  const startHour = 6, endHour = 24, pxPerMinute = 0.92;
  const days = viewMode === 'day' || (window.matchMedia('(max-width: 540px)').matches && viewMode === 'week') ? [selectedDate] : dates;
  const headers = days.map(date => `<button class="day-header ${date === localToday() ? 'today' : ''} ${date === selectedDate ? 'selected-day' : ''}" data-date="${date}"><b>${['日','一','二','三','四','五','六'][parseDate(date).getDay()]}</b><span>${Number(date.slice(8, 10))}</span></button>`).join('');
  const hours = Array.from({ length: endHour - startHour }, (_, i) => `<div class="hour-label" style="top:${i * 60 * pxPerMinute}px">${String(startHour + i).padStart(2, '0')}:00</div>`).join('');
  const columns = days.map(date => `<div class="day-column" data-drop-date="${date}"><div class="drop-hint"></div>${Array.from({ length: endHour - startHour }, (_, i) => `<button class="time-slot" style="top:${i * 60 * pxPerMinute}px" data-action="new-at" data-date="${date}" data-time="${String(startHour + i).padStart(2, '0')}:00" aria-label="${date} ${startHour + i}:00 新增活動"></button>`).join('')}${renderDayEvents(date, startHour, endHour, pxPerMinute)}</div>`).join('');
  const height = (endHour - startHour) * 60 * pxPerMinute;
  return `<div class="calendar-scroll"><div class="week-header"><div class="time-gutter"></div><div class="day-head-grid" style="--day-count:${days.length}">${headers}</div></div><div class="time-grid-wrap" style="--day-count:${days.length}"><div class="time-gutter hour-gutter" style="height:${height}px">${hours}</div><div class="day-columns" style="--day-count:${days.length};height:${height}px">${columns}</div></div></div>`;
}

function renderDayEvents(date, startHour, endHour, pxPerMinute) {
  const events = allEventsForDate(date).filter(event => matchesFilters(event));
  const occurrences = [];
  for (const event of events) {
    const part = splitAcrossDates(event).find(x => x.date === date);
    if (!part) continue;
    occurrences.push({ event, start: part.startMinute, end: part.endMinute });
  }
  occurrences.sort((a, b) => a.start - b.start || b.end - a.end);
  const clusters = [];
  for (const occurrence of occurrences) {
    let cluster = clusters.at(-1);
    if (!cluster || occurrence.start >= cluster.end) { cluster = { end: occurrence.end, items: [] }; clusters.push(cluster); }
    cluster.end = Math.max(cluster.end, occurrence.end); cluster.items.push(occurrence);
  }
  const hourStart = startHour * 60, hourEnd = endHour * 60;
  return clusters.flatMap(cluster => cluster.items.map((item, index) => {
    const clippedStart = Math.max(hourStart, item.start), clippedEnd = Math.min(hourEnd, item.end);
    if (clippedEnd <= clippedStart) return '';
    const total = cluster.items.length, width = 100 / total, category = categoryColor(item.event.category);
    const top = (clippedStart - hourStart) * pxPerMinute, height = Math.max(26, (clippedEnd - clippedStart) * pxPerMinute);
    return `<button class="event-card ${item.event.id === selectedEventId ? 'selected' : ''} status-${item.event.status}" style="top:${top}px;height:${height}px;left:calc(${index * width}% + 3px);width:calc(${width}% - 6px);--category:${category}" data-action="select-event" data-id="${escapeHTML(item.event.id)}" draggable="true" data-drag-event="${escapeHTML(item.event.id)}"><span class="event-time">${fmtTime(item.event.start)}–${fmtTime(item.event.end)}</span><strong>${escapeHTML(item.event.title)}</strong>${height > 48 ? `<small>${categoryLabel(item.event.category)}${item.event.status === 'done' ? ' · 已完成' : ''}</small>` : ''}</button>`;
  })).join('');
}

function renderMonthGrid(dates) {
  return `<div class="month-grid"><div class="month-weekdays">${['一','二','三','四','五','六','日'].map(x => `<span>${x}</span>`).join('')}</div><div class="month-days">${dates.map(date => {
    const events = allEventsForDate(date).filter(matchesFilters).slice(0, 4);
    return `<button class="month-day ${date === selectedDate ? 'selected-day' : ''} ${date === localToday() ? 'today' : ''} ${date.slice(0,7) !== selectedDate.slice(0,7) ? 'outside' : ''}" data-date="${date}"><b>${Number(date.slice(8,10))}</b>${events.map(event => `<span class="month-event" style="--category:${categoryColor(event.category)}" data-action="select-event" data-id="${event.id}">${escapeHTML(event.title)}</span>`).join('')}</button>`;
  }).join('')}</div></div>`;
}

function matchesFilters(event) {
  const text = `${event.title} ${event.notes || ''} ${(event.tags || []).join(' ')}`.toLowerCase();
  return (filterCategory === 'all' || event.category === filterCategory) && (!searchText || text.includes(searchText.toLowerCase()));
}

function renderInspector() {
  const event = state.events.find(item => item.id === selectedEventId);
  if (!event) return `<div class="inspector-empty"><span class="inspector-icon">◷</span><strong>選取一個活動</strong><p>在日曆點選行程，這裡會顯示詳情和快速操作。</p><button class="outline-button" data-action="new-event">新增行程</button></div>`;
  const actuals = state.actuals.filter(actual => actual.eventId === event.id);
  const actualMinutes = actuals.reduce((sum, actual) => sum + splitAcrossDates(actual).reduce((n, segment) => n + segment.minutes, 0), 0);
  return `<div class="inspector-head"><span class="eyebrow">活動詳情</span><button class="close-inspector" data-action="clear-selection" aria-label="關閉詳情">×</button></div>
    <div class="inspector-color" style="--category:${categoryColor(event.category)}"></div><h2>${escapeHTML(event.title)}</h2><div class="inspector-meta"><span>${categoryLabel(event.category)}</span><span>${event.start.slice(0,10)}</span><span>${fmtTime(event.start)}–${fmtTime(event.end)}</span></div>
    <div class="inspector-section"><span>計畫時長</span><strong>${fmtDuration(Math.max(0, durationMinutes(fmtTime(event.start), fmtTime(event.end))))}</strong></div>
    <div class="inspector-section"><span>實際紀錄</span><strong>${actuals.length ? fmtDuration(actualMinutes) : '尚未記錄'}</strong></div>
    <div class="inspector-section"><span>狀態</span><select id="event-status" class="select-control">${TASK_STATUSES.map(s => `<option value="${s.id}" ${event.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
    ${event.deadline ? `<div class="inspector-section"><span>${event.deadlineKind === 'external' ? '外部硬期限' : '自訂期限'}</span><strong>${escapeHTML(event.deadline)}</strong></div>` : ''}
    ${event.notes ? `<p class="inspector-notes">${escapeHTML(event.notes)}</p>` : ''}
    <div class="inspector-actions"><button class="outline-button" data-action="edit-event" data-id="${event.id}">編輯</button><button class="outline-button" data-action="log-actual" data-id="${event.id}">記錄實際</button>${event.seriesId ? `<button class="outline-button" data-action="edit-series" data-id="${event.id}">修改重複行程</button>` : ''}<button class="danger-button" data-action="delete-event" data-id="${event.id}">刪除</button></div>
    ${actuals.length ? `<div class="actual-list"><strong>實際紀錄</strong>${actuals.map(actual => `<div><span>${actual.start.slice(0,10)} ${fmtTime(actual.start)}–${fmtTime(actual.end)}</span><small>${actual.focus ? `專注 ${actual.focus}/5` : '未填專注'}${actual.awareness ? ` · ${actual.awareness}` : ''}</small></div>`).join('')}</div>` : ''}`;
}

function renderAnalytics() {
  const week = getWeekDates(selectedDate), start = week[0], end = week[6];
  const summary = summarizePeriod(state.events, state.actuals, start, end);
  const rows = summarizeByCategory(state.events, state.actuals, start, end);
  const maximum = Math.max(30, ...rows.flatMap(row => [row.planned, row.actual]));
  const err = estimateError(state.events, state.actuals);
  const reviews = state.reviews.filter(r => r.periodEnd >= start && r.periodEnd <= end);
  return `<div class="page-heading"><div><span class="eyebrow">${start} – ${end}</span><h1>分析與回顧</h1><p>只使用已記錄的資料；未知不會被當成 0。</p></div><div class="toolbar-group"><button class="outline-button" data-action="prev">‹ 前週</button><button class="outline-button" data-action="next">後週 ›</button></div></div>
    <section class="stat-grid"><article class="metric-card"><span>計畫時間</span><strong>${fmtDuration(summary.plannedMinutes)}</strong><small>週一至週日</small></article><article class="metric-card"><span>已記錄實際</span><strong>${fmtDuration(summary.actualMinutes)}</strong><small>${summary.trackedDays} 天有紀錄</small></article><article class="metric-card"><span>實際紀錄數</span><strong>${summary.actualRecords}</strong><small>缺漏不等於零</small></article><article class="metric-card"><span>估時樣本</span><strong>${err.n}</strong><small>${err.n ? `平均絕對誤差 ${Math.round(err.meanAbsoluteError)} 分` : '資料不足，暫不計算'}</small></article></section>
    <section class="panel"><div class="panel-heading"><div><h2>各分類：計畫與實際</h2><p>實際值由實際紀錄計算，跨午夜依日期拆分。</p></div><span class="sample-count">樣本 ${summary.actualRecords} 段</span></div>${rows.length ? `<div class="comparison-list">${rows.map(row => `<div class="comparison-row"><span class="comparison-label"><i style="--category:${row.color}"></i>${row.label}</span><div class="dual-bars"><div class="bar-line"><small>計畫</small><span class="bar-track"><i class="planned-bar" style="width:${Math.max(row.planned ? 2 : 0, row.planned / maximum * 100)}%;--category:${row.color}"></i></span><b>${row.planned} 分</b></div><div class="bar-line"><small>實際</small><span class="bar-track"><i class="actual-bar" style="width:${Math.max(row.actual ? 2 : 0, row.actual / maximum * 100)}%;--category:${row.color}"></i></span><b>${row.actual} 分</b></div></div></div>`).join('')}</div>` : '<div class="empty">這週還沒有行程或實際紀錄。</div>'}</section>
    <section class="panel two-column-panels"><div><div class="panel-heading"><div><h2>時間型態</h2><p>依實際活動段計算，不推測未填資料。</p></div></div><div class="mini-metrics"><div><span>最長連續活動段</span><b>${summary.longestBlockMinutes ? fmtDuration(summary.longestBlockMinutes) : '未知'}</b></div><div><span>計畫與實際差異</span><b>${summary.actualRecords ? `${summary.differenceMinutes >= 0 ? '+' : ''}${fmtDuration(Math.abs(summary.differenceMinutes))}` : '未知'}</b></div></div></div><div><div class="panel-heading"><div><h2>每週回顧</h2><p>${reviews.length} 則回顧紀錄</p></div><button class="text-button" data-action="open-review">新增回顧 →</button></div>${reviews.length ? reviews.map(r => `<p class="review-quote"><b>${r.periodEnd}</b> ${escapeHTML(r.nextAction || r.observed || '已完成回顧')}</p>`).join('') : '<div class="empty compact">還沒有本週回顧。</div>'}</div></section>`;
}

function renderKnowledge() {
  const cards = [
    { title: '運動時間與運動量', label: '來源型健康指引＋個人紀錄', definition: '記錄活動種類、實際分鐘與強度來源。運動計畫分鐘不能代替實際完成分鐘。', formula: '每週實際活動分鐘＝符合指定強度與類別的實際活動分鐘總和。', caution: '人口健康指引不是個人處方；分鐘數不能單獨推定強度或健康結果。', href: '../../knowledge/health-time/index.html' },
    { title: '睡眠與清醒休息', label: '分開記錄', definition: '睡眠、臥床時間與清醒休息分開；跨午夜活動仍是一筆紀錄，統計依日期切分。', formula: '臥床區間 ≠ 睡眠時長；睡眠時長只在有相應資料時呈現。', caution: '未填睡眠資料顯示未知，不當成零，也不由工作產出推估睡眠。', href: '../../knowledge/health-time/index.html' },
    { title: '玩樂與休閒', label: '工具操作定義', definition: '由使用者標記的自主休閒活動；不等於所有空閒或休息時間。', formula: '休閒分鐘＝使用者標記為休閒的實際活動分鐘總和。', caution: '時數不等於滿意度或幸福感，應分開記錄。' },
    { title: '專注與當下意識', label: '自我回報，不作診斷', definition: '專注程度、走神察覺與主觀時間感分成不同欄位記錄。', formula: '有效專注自評平均＝有效自評分數總和 ÷ 有效回報筆數。', caution: '自評不等於客觀注意力測量；未填不視為低專注。' },
    { title: '長區塊與零散時間', label: '個人門檻可調', definition: '長區塊依設定門檻辨認；短空檔需由使用者明確標記為可安排。', formula: '區塊分鐘＝連續起訖時間；中斷／恢復時間需分別記錄。', caution: '短時間不等於浪費；目前門檻是產品設定，不是研究定律。' },
    { title: '外部期限與自訂期限', label: '來源分開保存', definition: '外部期限與個人設定目標日分開，保留原期限、變更和原因。', formula: '期限差＝期限時間 − 完成時間；正值表示提早，負值表示逾期。', caution: '自訂期限調整不必然代表拖延；系統不替使用者判斷期限真假。' }
  ];
  return `<div class="page-heading"><div><span class="eyebrow">定義、公式與使用限制</span><h1>公式與知識庫</h1><p>研究公式與工具衍生指標分開標示；每個數字都可回到原始紀錄核對。</p></div><input id="knowledge-search" class="search-input" placeholder="搜尋主題" value="${escapeHTML(searchText)}"></div>
    <div class="knowledge-grid">${cards.filter(card => !searchText || `${card.title} ${card.definition} ${card.formula}`.toLowerCase().includes(searchText.toLowerCase())).map(card => `<article class="knowledge-card"><div class="knowledge-card-head"><span class="status-chip">${card.label}</span>${card.href ? `<a href="${card.href}" class="text-button">完整公式庫 ↗</a>` : ''}</div><h2>${card.title}</h2><p>${card.definition}</p><div class="formula-box"><b>目前指標</b><code>${card.formula}</code></div><p class="caution">注意：${card.caution}</p></article>`).join('')}</div>
    <div class="evidence-note"><b>資料標示原則</b><span>研究原式、工具衍生指標與產品暫定定義分開呈現。樣本數不足或欄位缺漏時，顯示「資料不足」，不補猜測值。</span></div>`;
}

function renderData() {
  return `<div class="page-heading"><div><span class="eyebrow">資料留在此瀏覽器</span><h1>匯入與設定</h1><p>目前不做雲端同步；匯入前會先檢查格式與重複資料。</p></div></div>
    <section class="data-grid"><article class="panel"><div class="panel-heading"><div><h2>資料交換</h2><p>支援 JSON 備份、CSV 與 ICS 行事曆交換。</p></div></div><div class="action-stack"><button class="primary-button" data-action="export-json">下載 JSON 備份</button><button class="outline-button" data-action="export-ics">匯出 ICS 行事曆</button><button class="outline-button" data-action="export-csv">匯出 CSV 活動清單</button><label class="upload-button">選擇 JSON／CSV／ICS 檔案<input id="import-file" type="file" accept=".json,.csv,.ics,application/json,text/calendar,text/csv"></label><button class="outline-button" data-action="import-legacy">讀取此瀏覽器的舊版資料</button></div><p class="helper-text">匯入會先產生預覽，不會立刻覆蓋目前資料。重複項目需由你逐筆選擇。</p></article>
      <article class="panel"><div class="panel-heading"><div><h2>個人設定</h2><p>時間門檻只影響標記與分析，不改變原始紀錄。</p></div></div><label class="setting-row">介面模式<select id="theme-setting" class="select-control"><option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>淺色</option><option value="dark" ${state.settings.theme === 'dark' ? 'selected' : ''}>深色</option></select></label><label class="setting-row">配色主題<select id="palette-setting" class="select-control">${[['frost','Apple 霧藍'],['fluent','Fluent 藍靛'],['material','Material 薰衣草'],['oneui','One UI 靜紫'],['meta','Meta 藍'],['chrono','Chrono 電藍']].map(([id,label]) => `<option value="${id}" ${state.settings.palette === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="setting-row">預設排程時長（分鐘）<input id="default-block" type="number" min="15" max="240" step="15" value="${Number(state.settings.defaultBlockMinutes) || 30}"></label><label class="setting-row">長區塊門檻（分鐘）<input id="long-block" type="number" min="30" max="240" step="15" value="${Number(state.settings.longBlockMinutes) || 60}"></label><label class="setting-row">短空檔上限（分鐘）<input id="short-gap" type="number" min="5" max="60" step="5" value="${Number(state.settings.shortGapMaxMinutes) || 30}"></label><p class="helper-text">長區塊與短空檔門檻是可調的產品設定，不是研究標準。</p></article></section>
    <section class="panel"><div class="panel-heading"><div><h2>目前資料概況</h2><p>刪除資料前請先下載 JSON。</p></div><button class="danger-button" data-action="clear-data">清除本機資料</button></div><div class="mini-metrics"><div><span>待辦</span><b>${state.tasks.length}</b></div><div><span>行程</span><b>${state.events.length}</b></div><div><span>實際紀錄</span><b>${state.actuals.length}</b></div><div><span>回顧</span><b>${state.reviews.length}</b></div></div></section>`;
}

function openEventDialog({ event = null, date = selectedDate, time = '09:00', task = null } = {}) {
  const start = event?.start || `${date}T${time}`;
  const defaultDuration = Math.max(15, Number(task?.estimatedMinutes) || Number(state.settings.defaultBlockMinutes) || 30);
  const end = event?.end || `${date}T${timeOf(minutesOf(time) + defaultDuration)}`;
  modalDraft = { event, task };
  $('#overlay-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><span class="eyebrow">${event ? '修改活動' : task ? '安排待辦' : '快速新增'}</span><h2 id="modal-title">${event ? escapeHTML(event.title) : task ? `安排「${escapeHTML(task.title)}」` : '先記下來，時間可稍後安排'}</h2></div><button class="close-inspector" data-action="close-modal" aria-label="關閉">×</button></div>
    <form id="event-form"><div class="form-grid"><label class="form-item full">標題<input required name="title" maxlength="120" value="${escapeHTML(event?.title || task?.title || '')}" placeholder="例如：整理課程筆記"></label>
    <label class="form-item">類別<select name="category">${CATEGORIES.map(c => `<option value="${c.id}" ${(event?.category || task?.category || 'work') === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
    ${event ? `<div class="form-item"><span>記錄類型</span><input value="行程（排入日曆）" disabled></div>` : `<label class="form-item">記錄類型<select name="kind"><option value="task" ${!task ? 'selected' : ''}>待辦（未排時間）</option><option value="event" ${task ? 'selected' : ''}>行程（排入日曆）</option></select></label>`}
    <label class="form-item date-fields">開始<input type="datetime-local" name="start" value="${start}"></label><label class="form-item date-fields">結束<input type="datetime-local" name="end" value="${end}"></label>
    <label class="form-item">預估時長（分鐘）<input type="number" min="0" step="5" name="estimate" value="${event?.estimatedMinutes ?? task?.estimatedMinutes ?? defaultDuration}"></label>
    <label class="form-item">狀態<select name="status">${TASK_STATUSES.map(s => `<option value="${s.id}" ${(event?.status || 'todo') === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label>
    <label class="form-item">期限種類<select name="deadlineKind"><option value="">沒有期限</option><option value="external" ${event?.deadlineKind === 'external' ? 'selected' : ''}>外部硬期限</option><option value="self" ${event?.deadlineKind === 'self' ? 'selected' : ''}>自訂期限</option></select></label>
    <label class="form-item">期限日期<input type="date" name="deadline" value="${event?.deadline || task?.deadline || ''}"></label>
    <label class="form-item recurrence-field">重複<select name="recurrence"><option value="none">不重複</option><option value="daily">每日</option><option value="weekly">每週</option><option value="monthly">每月</option></select></label>
    ${event?.seriesId ? `<label class="form-item">套用範圍<select name="editScope"><option value="this">只改這次</option><option value="future">這次及之後</option><option value="all">整個系列</option></select></label>` : ''}
    <label class="form-item full">備註<textarea name="notes" rows="3" maxlength="1000" placeholder="選填">${escapeHTML(event?.notes || task?.notes || '')}</textarea></label></div>
    <div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">${event ? '儲存修改' : '儲存'}</button></div></form></section></div>`;
  const form = $('#event-form');
  const seriesRule = event?.seriesId ? state.events.find(item => item.seriesId === event.seriesId && item.recurrence)?.recurrence : null;
  form.elements.recurrence.value = event?.recurrence?.frequency || seriesRule?.frequency || 'none';
  const updateKindFields = () => {
    const isTask = !event && !form.elements.kind ? false : form.elements.kind?.value === 'task';
    form.querySelectorAll('.date-fields,.recurrence-field').forEach(el => el.classList.toggle('hidden', isTask));
  };
  updateKindFields();
  form.elements.kind?.addEventListener('change', updateKindFields);
  form.addEventListener('submit', onEventSubmit);
}

function onEventSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form);
  const title = String(data.get('title') || '').trim();
  const kind = data.get('kind');
  if (!title) return notify('請輸入標題');
  if (kind === 'event') {
    const start = String(data.get('start')), end = String(data.get('end'));
    if (!start || !end || new Date(end) <= new Date(start)) return notify('結束時間必須晚於開始時間');
    const input = normalizeEvent({ id: modalDraft?.event?.id, title, category: data.get('category'), start, end,
      estimatedMinutes: Number(data.get('estimate')) || durationMinutes(fmtTime(start), fmtTime(end)), status: data.get('status'), deadline: data.get('deadline') || null,
      deadlineKind: data.get('deadlineKind') || null, notes: data.get('notes'), taskId: modalDraft?.task?.id || modalDraft?.event?.taskId || null,
      seriesId: modalDraft?.event?.seriesId || null, recurrence: data.get('recurrence') === 'none' ? null : { frequency: data.get('recurrence'), interval: 1 } });
    const conflicts = findConflicts(input, state.events, input.id);
    if (conflicts.length) notify(`有 ${conflicts.length} 個重疊行程；已保留，你可以檢視後再調整`);
    selectedEventId = input.id;
    change(store => {
      if (modalDraft?.event?.seriesId) {
        const original = modalDraft.event, scope = data.get('editScope') || 'this';
        const dayDelta = Math.round((new Date(`${input.start.slice(0,10)}T12:00`) - new Date(`${original.start.slice(0,10)}T12:00`)) / 86400000);
        const duration = Math.max(1, Math.round((new Date(input.end) - new Date(input.start)) / 60000));
        store.events = store.events.map(old => {
          const inScope = old.seriesId === original.seriesId && (scope === 'all' || (scope === 'future' && old.start >= original.start) || (scope === 'this' && old.id === original.id));
          if (!inScope) return old;
          const oldDate = old.start.slice(0,10), targetDate = scope === 'this' ? input.start.slice(0,10) : addDays(oldDate, dayDelta);
          const targetStart = `${targetDate}T${input.start.slice(11,16)}`;
          const absoluteEnd = new Date(new Date(targetStart).getTime() + duration * 60000);
          return { ...old, title: input.title, category: input.category, start: targetStart,
            end: `${toISODate(absoluteEnd)}T${timeOf(absoluteEnd.getHours() * 60 + absoluteEnd.getMinutes())}`,
            estimatedMinutes: input.estimatedMinutes, status: input.status, deadline: input.deadline, deadlineKind: input.deadlineKind,
            deadlineSource: input.deadlineSource, notes: input.notes, updatedAt: new Date().toISOString() };
        });
      } else if (modalDraft?.event) store.events = store.events.map(old => old.id === input.id ? input : old);
      else store.events.push(...createRecurringEvents(input));
      if (modalDraft?.task) { const task = store.tasks.find(item => item.id === modalDraft.task.id); if (task) task.eventId = input.id; }
    }, conflicts.length ? '行程已保存並標記重疊' : '行程已保存');
  } else {
    const taskId = modalDraft?.task?.id;
    change(store => {
      const task = { id: taskId || uid('task'), title, category: data.get('category'), estimatedMinutes: Number(data.get('estimate')) || 0,
        deadline: data.get('deadline') || null, deadlineKind: data.get('deadlineKind') || null, status: data.get('status') || 'todo', notes: String(data.get('notes') || ''), eventId: null, createdAt: new Date().toISOString() };
      if (taskId) store.tasks = store.tasks.map(old => old.id === taskId ? { ...old, ...task } : old); else store.tasks.unshift(task);
    }, '待辦已保存');
  }
  $('#overlay-root').innerHTML = ''; modalDraft = null;
}

function openActualDialog(event) {
  const actual = event ? null : null;
  if (!event) return;
  const date = event.start.slice(0, 10), start = event.start, end = event.end;
  $('#overlay-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><span class="eyebrow">實際紀錄</span><h2>${escapeHTML(event.title)}</h2></div><button class="close-inspector" data-action="close-modal">×</button></div><form id="actual-form"><div class="form-grid"><label class="form-item">實際開始<input required type="datetime-local" name="start" value="${start}"></label><label class="form-item">實際結束<input required type="datetime-local" name="end" value="${end}"></label><label class="form-item">完成狀態<select name="status"><option value="done">已完成</option><option value="partial">部分完成</option><option value="skipped">取消／略過</option></select></label><label class="form-item">專注（1–5）<select name="focus"><option value="">不填</option>${[1,2,3,4,5].map(n => `<option>${n}</option>`).join('')}</select></label><label class="form-item">精力（1–5）<select name="energy"><option value="">不填</option>${[1,2,3,4,5].map(n => `<option>${n}</option>`).join('')}</select></label><label class="form-item">當下意識<select name="awareness"><option value="">不填</option>${AWARENESS.map(x => `<option>${x}</option>`).join('')}</select></label><label class="form-item">主觀時間感<select name="timeFeel"><option value="">不填</option>${TIME_FEEL.map(x => `<option>${x}</option>`).join('')}</select></label><label class="form-item">中斷次數<input type="number" min="0" step="1" name="interruptions" value="0"></label><label class="form-item">中斷分鐘<input type="number" min="0" step="1" name="interruptionMinutes" value="0"></label><label class="form-item full">備註<textarea name="notes" rows="2"></textarea></label></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">取消</button><button class="primary-button">保存實際紀錄</button></div></form></section></div>`;
  $('#actual-form').addEventListener('submit', e => {
    e.preventDefault(); const data = new FormData(e.currentTarget), s = String(data.get('start')), en = String(data.get('end'));
    if (new Date(en) <= new Date(s)) return notify('結束必須晚於開始');
    const focus = data.get('focus') ? Number(data.get('focus')) : null, energy = data.get('energy') ? Number(data.get('energy')) : null;
    const entry = normalizeActual({ eventId: event.id, title: event.title, category: event.category, start: s, end: en, status: data.get('status'),
      focus, energy, awareness: data.get('awareness') || null, timeFeel: data.get('timeFeel') || null,
      interruptions: Number(data.get('interruptions')), interruptionMinutes: Number(data.get('interruptionMinutes')), notes: data.get('notes') });
    change(store => {
      store.actuals.push(entry);
      const current = store.events.find(x => x.id === event.id);
      if (current) current.status = entry.status;
      const linkedTask = store.tasks.find(x => x.eventId === event.id);
      if (linkedTask) linkedTask.status = entry.status;
    }, '實際紀錄已保存');
    $('#overlay-root').innerHTML = '';
  });
}

function openReviewDialog() {
  const start = startOfWeek(selectedDate), end = addDays(start, 6);
  $('#overlay-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><span class="eyebrow">每週檢視</span><h2>${start} – ${end}</h2></div><button class="close-inspector" data-action="close-modal">×</button></div><form id="review-form"><div class="form-grid"><label class="form-item full">本週實際完成什麼？<textarea name="observed" rows="3"></textarea></label><label class="form-item full">主要差異或限制？<textarea name="constraints" rows="3"></textarea></label><label class="form-item full">下一步只調整哪一件事？<textarea name="nextAction" rows="2"></textarea></label><label class="form-item">回顧時間（分鐘）<input type="number" min="0" name="minutes" value="10"></label></div><div class="modal-actions"><button type="button" class="outline-button" data-action="close-modal">取消</button><button class="primary-button">完成回顧</button></div></form></section></div>`;
  $('#review-form').addEventListener('submit', e => { e.preventDefault(); const d = new FormData(e.currentTarget); const review = { id: uid('review'), type: 'weekly', periodStart: start, periodEnd: end, observed: d.get('observed'), constraints: d.get('constraints'), nextAction: d.get('nextAction'), minutes: Number(d.get('minutes')) || 0, createdAt: new Date().toISOString() }; change(store => store.reviews.push(review), '週回顧已保存'); $('#overlay-root').innerHTML = ''; });
}

function openSuggestions(task) {
  const dates = getWeekDates(selectedDate), suggestions = suggestSlots(task, state.events, state.settings, dates[0], 7, 3);
  $('#overlay-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><span class="eyebrow">排程建議 · 由你確認</span><h2>${escapeHTML(task.title)}</h2></div><button class="close-inspector" data-action="close-modal">×</button></div><p class="helper-text">依可用時間、預估時長與期限產生候選時段；固定行程不會被移動。</p>${suggestions.length ? `<div class="suggestion-list">${suggestions.map((slot, i) => `<button class="suggestion-option" data-action="choose-slot" data-task="${task.id}" data-start="${slot.start}" data-end="${slot.end}"><b>建議 ${i + 1}</b><span>${slot.start.replace('T',' ')} – ${fmtTime(slot.end)}</span><small>${fmtDuration(slot.minutes)}</small></button>`).join('')}</div>` : '<div class="empty">本週沒有符合時長和期限的空檔。可以手動縮短時長或延後日期。</div>'}<div class="modal-actions"><button class="outline-button" data-action="close-modal">稍後再排</button></div></section></div>`;
}

function openImportPreview(file, parsed) {
  const rows = parsed.map(row => {
    const duplicate = findDuplicate(row, state);
    return { ...row, duplicate, decision: duplicate ? 'skip' : 'add' };
  });
  const extrasCount = pendingImportExtras.tasks.length + pendingImportExtras.actuals.length + pendingImportExtras.reviews.length;
  $('#overlay-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-wide" role="dialog" aria-modal="true"><div class="modal-header"><div><span class="eyebrow">匯入預覽 · ${escapeHTML(file.name)}</span><h2>${parsed.length} 筆行程${extrasCount ? `，另有 ${extrasCount} 筆待辦／實際紀錄／回顧` : ''}，請檢查後確認</h2></div><button class="close-inspector" data-action="close-modal">×</button></div><div class="import-table-wrap"><table class="import-table"><thead><tr><th>日期</th><th>活動</th><th>類別</th><th>重複檢查</th><th>處理</th></tr></thead><tbody>${rows.map((row, i) => `<tr><td>${escapeHTML(row.start?.slice(0,10) || '—')}</td><td>${escapeHTML(row.title)}</td><td>${categoryLabel(row.category)}</td><td>${row.duplicate ? `可能重複：${escapeHTML(row.duplicate.title)}` : '未發現'}</td><td><select class="import-decision" data-row="${i}"><option value="add" ${!row.duplicate ? 'selected' : ''}>新增</option><option value="skip" ${row.duplicate ? 'selected' : ''}>略過</option><option value="replace">覆蓋本機重複項</option></select></td></tr>`).join('')}</tbody></table></div><div class="modal-actions"><button class="outline-button" data-action="close-modal">取消匯入</button><button class="primary-button" data-action="confirm-import">確認匯入</button></div></section></div>`;
  $$('[data-row]').forEach(select => select.addEventListener('change', () => { rows[Number(select.dataset.row)].decision = select.value; }));
  $('#overlay-root').dataset.importRows = JSON.stringify(rows);
}

function findDuplicate(row, store) {
  if (row.externalUid) return store.events.find(event => event.externalUid === row.externalUid) || null;
  return store.events.find(event => event.title.trim().toLowerCase() === row.title.trim().toLowerCase() && event.start === row.start && event.end === row.end) || null;
}

function normalizeImported(row) {
  const categoryInput = String(row.category || 'other').trim();
  const category = CATEGORIES.find(item => item.id === categoryInput || item.label === categoryInput)?.id || 'other';
  return normalizeEvent({ title: row.title, category, start: row.start, end: row.end, notes: row.notes || '',
    externalUid: row.externalUid || null, source: 'imported', status: 'todo', estimatedMinutes: row.estimatedMinutes });
}

function download(filename, content, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportJSON() { download(`chrono-planner-${localToday()}.json`, JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2), 'application/json;charset=utf-8'); notify('JSON 備份已下載'); }
function exportCSV() {
  const header = ['日期','標題','類別','開始','結束','狀態','期限','期限種類','備註'];
  const rows = state.events.map(e => [e.start.slice(0,10),e.title,categoryLabel(e.category),fmtTime(e.start),fmtTime(e.end),TASK_STATUSES.find(s=>s.id===e.status)?.label || e.status,e.deadline || '',e.deadlineKind || '',e.notes || '']);
  const csv = [header,...rows].map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  download(`chrono-planner-${localToday()}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8'); notify('CSV 已下載');
}
function exportICS() {
  const esc = value => String(value || '').replaceAll('\\','\\\\').replaceAll(';','\\;').replaceAll(',','\\,').replaceAll('\n','\\n');
  const stamp = value => value.replaceAll('-','').replaceAll(':','');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Chrono Desk//Chrono Planner//ZH-TW','CALSCALE:GREGORIAN'];
  for (const event of state.events) lines.push('BEGIN:VEVENT',`UID:${event.externalUid || `${event.id}@chronodesk`}`,`DTSTART:${stamp(event.start)}`,`DTEND:${stamp(event.end)}`,`SUMMARY:${esc(event.title)}`,`DESCRIPTION:${esc(`${categoryLabel(event.category)} ${event.notes || ''}`)}`,'END:VEVENT');
  lines.push('END:VCALENDAR'); download(`chrono-planner-${localToday()}.ics`, lines.join('\r\n'), 'text/calendar;charset=utf-8'); notify('ICS 已下載');
}

function parseCSV(text) {
  const rows = [], lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) { const cells = []; let value = '', quote = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (ch === '"' && quote && line[i+1] === '"') { value += '"'; i++; } else if (ch === '"') quote = !quote; else if (ch === ',' && !quote) { cells.push(value); value = ''; } else value += ch; } cells.push(value); rows.push(cells); }
  const headers = rows.shift().map(x => x.trim().toLowerCase());
  return rows.map(cells => Object.fromEntries(headers.map((header,i) => [header,cells[i] || '']))).map(row => normalizeImported({ title: row.title || row['活動'] || row.summary, category: row.category || row['類別'], start: row.start || `${row.date || row['日期']}T${row.starttime || row['開始'] || '09:00'}`, end: row.end || `${row.date || row['日期']}T${row.endtime || row['結束'] || '10:00'}`, notes: row.notes || row['備註'] })).filter(row => row.title && row.start && row.end);
}

function parseICS(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, ''), blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  const unescape = value => value.replace(/\\n/gi,'\n').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\');
  const dateValue = value => { const m = value.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4] || '09'}:${m[5] || '00'}` : ''; };
  return blocks.map(block => { const fields = {}; for (const line of block.split(/\r?\n/)) { const idx=line.indexOf(':'); if(idx<0)continue; const key=line.slice(0,idx).split(';')[0].toUpperCase(); if(['UID','DTSTART','DTEND','SUMMARY','DESCRIPTION'].includes(key))fields[key]=line.slice(idx+1); }
    return normalizeImported({ title: unescape(fields.SUMMARY || '匯入活動'), start: dateValue(fields.DTSTART || ''), end: dateValue(fields.DTEND || ''), notes: unescape(fields.DESCRIPTION || ''), externalUid: fields.UID || null });
  }).filter(row => row.start && row.end);
}

async function handleImportFile(file) {
  try {
    const text = await file.text(); let parsed; pendingImportExtras = { tasks: [], actuals: [], reviews: [], goals: [] };
    if (file.name.endsWith('.json')) {
      const raw = JSON.parse(text);
      if (raw.schemaVersion === 2 && Array.isArray(raw.events)) {
        parsed = raw.events.map(event => normalizeEvent(event));
        pendingImportExtras = { tasks: raw.tasks || [], actuals: raw.actuals || [], reviews: raw.reviews || [], goals: raw.goals || [] };
      }
      else if (Array.isArray(raw.events)) parsed = raw.events.map(event => normalizeEvent(event));
      else if (Array.isArray(raw.tasks)) { const migrated = migrateLegacyState(raw); parsed = migrated.events; pendingImportExtras = { tasks: migrated.tasks, actuals: migrated.actuals, reviews: migrated.reviews, goals: migrated.goals }; }
      else if (Array.isArray(raw)) parsed = raw.map(row => normalizeEvent(row));
      else throw new Error('JSON 格式中找不到活動資料');
    } else if (file.name.endsWith('.ics')) parsed = parseICS(text);
    else if (file.name.endsWith('.csv')) parsed = parseCSV(text);
    else throw new Error('目前只接受 JSON、CSV 或 ICS');
    if (!parsed.length && !pendingImportExtras.tasks.length && !pendingImportExtras.actuals.length && !pendingImportExtras.reviews.length && !pendingImportExtras.goals.length) throw new Error('檔案中沒有可匯入的資料');
    openImportPreview(file, parsed);
  } catch (error) { notify(`匯入失敗：${error.message}`); }
}

function applyImport() {
  const wrapper = $('#overlay-root'), decisions = JSON.parse(wrapper.dataset.importRows || '[]');
  change(store => {
    for (const row of decisions) {
      if (row.decision === 'skip') continue;
      const duplicate = findDuplicate(row, store);
      const imported = normalizeImported(row);
      if (row.decision === 'replace' && duplicate) store.events = store.events.map(event => event.id === duplicate.id ? { ...imported, id: event.id } : event);
      else if (!duplicate) store.events.push(imported);
    }
    const appendNewIds = (target, incoming) => {
      const known = new Set(target.map(item => item.id));
      target.push(...incoming.filter(item => item?.id && !known.has(item.id)));
    };
    appendNewIds(store.tasks, pendingImportExtras.tasks);
    appendNewIds(store.actuals, pendingImportExtras.actuals.map(normalizeActual));
    appendNewIds(store.reviews, pendingImportExtras.reviews);
    appendNewIds(store.goals, pendingImportExtras.goals);
  }, '匯入資料已保存');
  pendingImportExtras = { tasks: [], actuals: [], reviews: [], goals: [] };
  wrapper.innerHTML = '';
}

function importLegacy() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem('TIME_PRO_ENTERPRISE_V1') || 'null'); } catch { raw = null; }
  if (!raw || !Array.isArray(raw.tasks)) return notify('此瀏覽器找不到舊版 Chrono Desk 資料');
  const migrated = migrateLegacyState(raw);
  $('#overlay-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><div class="modal-header"><div><span class="eyebrow">舊版資料預覽</span><h2>找到 ${migrated.events.length} 筆行程和 ${migrated.actuals.length} 筆實際紀錄</h2></div><button class="close-inspector" data-action="close-modal">×</button></div><p>舊版資料只會複製到新模組，不會刪除或修改舊資料。重複活動會先略過。</p><div class="modal-actions"><button class="outline-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-legacy">匯入到新模組</button></div></section></div>`;
  $('#overlay-root')._legacyState = migrated;
}

function attachGlobalHandlers() {
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action], [data-page], [data-view], [data-date], [data-id]');
    if (!target) return;
    if (target.matches('[data-page]')) { currentPage = target.dataset.page; selectedEventId = null; render(); return; }
    if (target.matches('[data-view]')) { viewMode = target.dataset.view; render(); return; }
    if (target.matches('[data-date]') && !target.dataset.action) { selectedDate = target.dataset.date; if (window.matchMedia('(max-width: 700px)').matches) viewMode = 'day'; render(); return; }
    const action = target.dataset.action, id = target.dataset.id;
    if (!action) return;
    if (action === 'prev' || action === 'next') { const amount = viewMode === 'day' ? 1 : viewMode === 'month' ? 30 : 7; selectedDate = addDays(selectedDate, amount * (action === 'prev' ? -1 : 1)); render(); }
    if (action === 'today') { selectedDate = localToday(); render(); }
    if (action === 'mini-prev' || action === 'mini-next') { const d=parseDate(selectedDate); d.setMonth(d.getMonth()+(action==='mini-prev'?-1:1)); selectedDate=toISODate(d); render(); }
    if (action === 'new-task') openEventDialog();
    if (action === 'new-event') openEventDialog({ date: selectedDate });
    if (action === 'new-at') openEventDialog({ date: target.dataset.date, time: target.dataset.time });
    if (action === 'select-event') { selectedEventId = id; render(); }
    if (action === 'clear-selection') { selectedEventId = null; render(); }
    if (action === 'edit-event') { const item=state.events.find(x=>x.id===id); if(item)openEventDialog({event:item}); }
    if (action === 'log-actual') openActualDialog(state.events.find(x=>x.id===id));
    if (action === 'finish-event') openActualDialog(state.events.find(x=>x.id===id));
    if (action === 'open-review') openReviewDialog();
    if (action === 'suggest') { const task=state.tasks.find(x=>x.id===id); if(task)openSuggestions(task); }
    if (action === 'choose-slot') {
      const task=state.tasks.find(x=>x.id===target.dataset.task); if(task)openEventDialog({task,date:target.dataset.start.slice(0,10),time:target.dataset.start.slice(11,16)});
      if(task){ const form=$('#event-form'); form.elements.end.value=target.dataset.end; form.elements.estimate.value=durationMinutes(target.dataset.start.slice(11,16),target.dataset.end.slice(11,16)); }
    }
    if (action === 'undo') undo();
    if (action === 'close-modal') { if (target === event.target || target.classList.contains('close-inspector')) $('#overlay-root').innerHTML = ''; }
    if (action === 'export-json') exportJSON();
    if (action === 'export-csv') exportCSV();
    if (action === 'export-ics') exportICS();
    if (action === 'confirm-import') applyImport();
    if (action === 'import-legacy') importLegacy();
    if (action === 'confirm-legacy') { const legacy=$('#overlay-root')._legacyState; if(legacy)change(store=>{ const existing=new Set(store.events.map(e=>`${e.title}|${e.start}`)); store.events.push(...legacy.events.filter(e=>!existing.has(`${e.title}|${e.start}`))); store.actuals.push(...legacy.actuals); },'舊版資料已複製'); $('#overlay-root').innerHTML=''; }
    if (action === 'clear-data') { if (confirm('確定清除 Chrono Planner 的本機資料？請先下載 JSON 備份。')) change(store=>{ Object.assign(store,emptyState()); },'本機資料已清除'); }
    if (action === 'delete-event') {
      const item=state.events.find(x=>x.id===id); if(!item)return;
      const scope = item.seriesId ? prompt('輸入 1 刪除這次、2 刪除這次及之後、3 刪除整個系列', '1') : '1';
      if (!scope || !confirm('確認刪除？此操作可按復原。')) return;
      change(store=>{ store.events=store.events.filter(e=>e.id!==id && !(item.seriesId&&e.seriesId===item.seriesId&&(scope==='3'||scope==='2'&&e.start>=item.start))); store.actuals=store.actuals.filter(a=>a.eventId!==id); },'行程已刪除'); selectedEventId=null;
    }
    if (action === 'edit-series') { const item=state.events.find(x=>x.id===id); if(item)openEventDialog({event:item}); }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'calendar-search' || event.target.id === 'knowledge-search') { searchText = event.target.value; const position=event.target.selectionStart; render(); const next=$(`#${event.target.id}`); next?.focus(); next?.setSelectionRange(position,position); }
  });
  document.addEventListener('change', event => {
    const target=event.target;
    if(target.id==='category-filter'){filterCategory=target.value;render();}
    if(target.id==='event-status'&&selectedEventId){const value=target.value;change(store=>{const item=store.events.find(e=>e.id===selectedEventId);if(item)item.status=value;},'狀態已更新');}
    if(target.id==='import-file'&&target.files?.[0])handleImportFile(target.files[0]);
    if(target.id==='theme-setting'){change(store=>{store.settings.theme=target.value;},'介面模式已更新');}
    if(target.id==='palette-setting'){change(store=>{store.settings.palette=target.value;},'配色已更新');}
    if(target.id==='default-block'||target.id==='long-block'||target.id==='short-gap'){const key=target.id==='default-block'?'defaultBlockMinutes':target.id==='long-block'?'longBlockMinutes':'shortGapMaxMinutes';change(store=>{store.settings[key]=Number(target.value)||30;},'門檻已保存');}
  });

  document.addEventListener('dragstart', event => {
    const task=event.target.closest('[data-drag-task]'), item=event.target.closest('[data-drag-event]');
    if(task){event.dataTransfer.setData('text/task-id',task.dataset.dragTask);event.dataTransfer.effectAllowed='copy';}
    if(item){event.dataTransfer.setData('text/event-id',item.dataset.dragEvent);event.dataTransfer.effectAllowed='move';}
  });
  document.addEventListener('dragover', event => { const column=event.target.closest('[data-drop-date]'); if(column){event.preventDefault();column.classList.add('drag-over');} });
  document.addEventListener('dragleave', event => { const column=event.target.closest('[data-drop-date]'); if(column && !column.contains(event.relatedTarget))column.classList.remove('drag-over'); });
  document.addEventListener('drop', event => {
    const column=event.target.closest('[data-drop-date]'); if(!column)return; event.preventDefault();column.classList.remove('drag-over');
    const taskId=event.dataTransfer.getData('text/task-id'), eventId=event.dataTransfer.getData('text/event-id');
    if(taskId){const task=state.tasks.find(x=>x.id===taskId);if(task)openEventDialog({task,date:column.dataset.dropDate,time:'09:00'});}
    if(eventId){const item=state.events.find(x=>x.id===eventId);if(!item||item.isFixed)return notify('固定行程無法拖曳修改');const rect=column.getBoundingClientRect(), hour=6, y=event.clientY-rect.top, minute=Math.max(0,Math.round(y/0.92/15)*15), date=column.dataset.dropDate, duration=durationMinutes(fmtTime(item.start),fmtTime(item.end)), start=`${date}T${timeOf(hour*60+minute)}`, endMinute=hour*60+minute+duration; const endDate=endMinute>=1440?addDays(date,1):date;const updated={...item,start,end:`${endDate}T${timeOf(endMinute)}`};const conflicts=findConflicts(updated,state.events,item.id);change(store=>{store.events=store.events.map(e=>e.id===item.id?updated:e);},conflicts.length?'已移動；請留意重疊行程':'已移動行程');}
  });

  document.addEventListener('keydown', event => { if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo();} if(event.key==='Escape')$('#overlay-root').innerHTML=''; });
  $('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
}

attachGlobalHandlers();
render();
persist('本機自動保存已啟用');
