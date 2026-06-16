'use strict';

const state = {
  tasks: [],
  summary: {},
  filters: {},
  meta: {},
  me: null,
  view: 'table',
  time: 'all',
  projects: [],
  owners: [],
  priorities: [],
  statuses: [],
  types: [],
  search: '',
  sortKey: 'deadline',
  sortDir: 'asc',
  expanded: false,
  calY: null,
  calM: null, // 0-based
};

const STATUSES = ['لم تبدأ', 'قيد التنفيذ', 'منجزة', 'متوقفة'];
const PRIORITIES = ['حرجة', 'عالية', 'متوسطة'];
const TYPES = ['E-mail', 'مجلس الإدارة', 'مكتب تنفيذي'];
const MEETING_SCHEDULED = 'تم جدولته';
const MEETING_UNSCHEDULED = 'غير مجدول';
const MEETING_STATUSES = [MEETING_UNSCHEDULED, MEETING_SCHEDULED];
// أيقونة مختصرة لكل نوع (للبطاقات)
const TYPE_ICON = { 'E-mail': '✉️', 'مجلس الإدارة': '🏛️', 'مكتب تنفيذي': '🏢' };
const $ = (id) => document.getElementById(id);

const TIME_CHIPS = [
  { key: 'all', label: 'الكل' },
  { key: 'today', label: 'اليوم' },
  { key: 'soon3', label: 'خلال 3 أيام' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'overdue', label: 'متأخر' },
  { key: 'undated', label: 'بلا موعد' },
  { key: 'recurring', label: 'دورية' },
];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ===== Auth =====
function canEdit() {
  return !!state.meta.canWrite && !!state.me && (state.me.role === 'admin' || state.me.role === 'editor');
}
async function fetchMe() {
  const res = await fetch('/api/me');
  if (res.status === 401) { location.href = '/login.html'; throw new Error('redirect'); }
  const data = await res.json();
  state.me = data.user;
}
function renderUser() {
  if (!state.me) return;
  const roleAr = { admin: 'مدير', editor: 'محرّر', viewer: 'مشاهد' }[state.me.role] || '';
  $('userChip').innerHTML = `${esc(state.me.name)}<span class="role">${roleAr}</span>`;
  $('userChip').style.display = '';
  $('logoutBtn').style.display = state.me && !state.meta.authDisabled ? '' : 'none';
  const ub = $('usersBtn'); if (ub) ub.style.display = state.me.role === 'admin' ? '' : 'none';
  const pb = $('pushBtn');
  if ('PushManager' in window) {
    pb.style.display = '';
    const granted = window.Notification && Notification.permission === 'granted';
    pb.textContent = granted ? '🔔' : '🔕';
  }
}

// ===== Data =====
async function fetchTasks(refresh = false) {
  const res = await fetch('/api/tasks' + (refresh ? '?refresh=1' : ''));
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'فشل التحميل');
  state.tasks = data.tasks;
  state.summary = data.summary;
  state.filters = data.filters;
  state.meta = data.meta;
}

function fmtSync(iso) {
  try {
    return 'آخر مزامنة: ' + new Date(iso).toLocaleTimeString('ar-SY-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ===== التذكيرات =====
const REMINDER_METHODS = [
  { key: 'email', label: '📧 بريد إلكتروني' },
  { key: 'push', label: '🔔 إشعار متصفح/حاسوب' },
  { key: 'calendar', label: '🗓️ تقويم الحاسوب' },
];
const REMINDER_OFFSETS = [
  { key: 'morning', label: 'صباح يوم المهمة' },
  { key: '1d', label: 'قبل يوم' },
  { key: '3d', label: 'قبل 3 أيام' },
  { key: '7d', label: 'قبل أسبوع' },
];
async function fetchReminders() {
  try {
    const data = await (await fetch('/api/reminders')).json();
    if (data.ok) { state.reminders = data.reminders || {}; state.storeEnabled = data.storeEnabled !== false; }
  } catch { /* تجاهل */ }
}

function toast(msg, isErr = false) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  setTimeout(() => { el.className = 'toast' + (isErr ? ' err' : ''); }, 2600);
}

// ===== Filtering =====
function matchTime(t, key) {
  switch (key) {
    case 'all': return true;
    case 'today': return t.isToday;
    case 'soon3': return t.isSoon3;
    case 'week': return t.isThisWeek;
    case 'overdue': return t.isOverdue;
    case 'undated': return t.isUndated;
    case 'recurring': return t.isRecurring;
    default: return true;
  }
}
function countForTime(key) { return state.tasks.filter((t) => matchTime(t, key)).length; }

function applyFilters() {
  let list = state.tasks.filter((t) => matchTime(t, state.time));
  if (state.projects.length) list = list.filter((t) => state.projects.includes(t.project));
  if (state.owners.length) list = list.filter((t) => t.owners.some((o) => state.owners.includes(o)));
  if (state.priorities.length) list = list.filter((t) => state.priorities.includes(t.priority));
  if (state.statuses.length) list = list.filter((t) => state.statuses.includes(t.status));
  if (state.types.length) list = list.filter((t) => state.types.includes(t.type || '__none__'));
  if (state.search) {
    const q = state.search.trim();
    list = list.filter((t) => [t.project, t.dept, t.file, t.owner, t.deliverable, t.notes, t.followup, t.source].join(' ').includes(q));
  }
  return list;
}

function sortList(list) {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  const key = state.sortKey;
  const val = (t) => {
    if (key === 'deadline') return t.deadlineIso || '9999-99-99';
    if (key === 'priority') return ({ 'حرجة': 0, 'عالية': 1, 'متوسطة': 2 })[t.priority] ?? 9;
    if (key === 'project') return t.project || '';
    if (key === 'file') return t.file || '';
    if (key === 'type') return t.type || '';
    if (key === 'owner') return t.owner || '';
    if (key === 'status') return t.status || '';
    return '';
  };
  return [...list].sort((a, b) => {
    if (a.isDone !== b.isDone) return a.isDone ? 1 : -1; // المنجزة دائماً في الأسفل
    const x = val(a), y = val(b);
    return x < y ? -dir : x > y ? dir : 0;
  });
}

// ===== Helpers =====
function priClass(p) { return PRIORITIES.includes(p) ? 'p-' + p : 'p-غير'; }
function stClass(s) { return s === 'منجزة' ? 'st-منجزة' : s === 'قيد التنفيذ' ? 'st-قيد' : s === 'متوقفة' ? 'st-متوقفة' : ''; }
function typeCell(type) {
  if (!type) return '<span style="color:var(--muted)">—</span>';
  return `<span class="type-tag">${TYPE_ICON[type] || '🏷️'} ${esc(type)}</span>`;
}
// خلية المخرجات في الجدول: مضغوط = أول مخرج + «+عدد»، موسّع = كل المخرجات مكدّسة
function deliverableCell(t) {
  const items = fuBlocks(t.deliverable);
  if (!items.length) return '<span style="color:var(--muted)">—</span>';
  if (state.expanded) return `<div class="fu-cell-full">${items.map((b, i) => `<div class="fu-mini"><div class="fu-meta"><b>مخرج ${i + 1}</b></div><div class="fu-mtext">${esc(b)}</div></div>`).join('')}</div>`;
  const first = items[0];
  const more = items.length > 1 ? `<span class="fu-more">+${items.length - 1}</span>` : '';
  return `<div class="fu-cell"><div class="fu-meta">${more}</div><div class="fu-text">${esc(first.slice(0, 100))}${first.length > 100 ? '…' : ''}</div></div>`;
}

// ===== سجلّ المتابعة اليومية =====
// عمودان متوازيان: «المتابعة» (نصّ الحدث) و«السجل» (الاسم·التاريخ·الوقت بصيغة [..])، كتلة لكل حدث مفصولة بسطر فارغ.
// الحدث i في «المتابعة» يقابل السجل i في «السجل». الأحداث اليدوية سجلّها «----------» (بلا بيانات).
const FU_RE = /^\s*\[(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[—–-]\s*(.+?)\]\s*$/;
function fuBlocks(s) {
  return String(s == null ? '' : s).replace(/\r/g, '').split(/\n[ \t]*\n+/).map((b) => b.replace(/^\s+|\s+$/g, '')).filter((b) => b !== '');
}
function parseFollowup(followup, log) {
  const F = fuBlocks(followup), L = fuBlocks(log);
  return F.map((text, i) => {
    const m = (L[i] || '').match(FU_RE);
    if (m) return { idx: i, text, date: m[1], time: m[2], author: m[3].trim(), manual: false };
    return { idx: i, text, manual: true };
  });
}
function fuShort(date, time) {
  if (!date) return '';
  const p = date.split('-');
  return `${p[2]}/${p[1]}${time ? ' ' + time : ''}`;
}
function fuAvatar(author) {
  const ch = (author || '؟').trim().charAt(0) || '؟';
  return `<span class="fu-av">${esc(ch)}</span>`;
}
function fuMini(e) {
  const meta = e.manual ? '<span class="fu-leg">متابعة</span>' : `<b>${esc(e.author)}</b> · ${esc(fuShort(e.date, e.time))}`;
  return `<div class="fu-mini"><div class="fu-meta">${meta}</div><div class="fu-mtext">${esc(e.text)}</div></div>`;
}
function followupCell(t) {
  const evs = parseFollowup(t.followup, t.log);
  if (!evs.length) return '<span style="color:var(--muted)">—</span>';
  if (state.expanded) return `<div class="fu-cell-full">${evs.slice().reverse().map(fuMini).join('')}</div>`;
  const last = evs[evs.length - 1];
  const more = evs.length > 1 ? `<span class="fu-more">+${evs.length - 1}</span>` : '';
  const meta = last.manual
    ? `<div class="fu-meta"><span class="fu-leg">متابعة</span>${more}</div>`
    : `<div class="fu-meta"><b>${esc(last.author)}</b> · ${esc(fuShort(last.date, last.time))} ${more}</div>`;
  const txt = (last.text || '');
  return `<div class="fu-cell">${meta}<div class="fu-text">${esc(txt.slice(0, 90))}${txt.length > 90 ? '…' : ''}</div></div>`;
}
function followupSection(t) {
  const evs = parseFollowup(t.followup, t.log).slice().reverse(); // الأحدث أولاً
  const ed = canEdit();
  const acts = (e) => ed ? `<span class="fu-acts"><button class="fu-ico fu-ed" type="button" data-idx="${e.idx}" title="تعديل">✏️</button><button class="fu-ico fu-del" type="button" data-idx="${e.idx}" title="حذف">🗑</button></span>` : '';
  const items = evs.length ? evs.map((e) => `
    <div class="fu-item ${e.manual ? 'plain' : ''}" data-idx="${e.idx}">
      <div class="fu-ihead">${e.manual ? '<span class="fu-leg">متابعة (يدوي)</span>' : `${fuAvatar(e.author)}<span class="fu-au">${esc(e.author)}</span><span class="fu-tm">${esc(e.date || '')} ${esc(e.time || '')}</span>`}${acts(e)}</div>
      <div class="fu-ibody">${esc(e.text)}</div></div>`).join('') : '<div class="fu-empty">لا توجد متابعة بعد.</div>';
  const add = canEdit() ? `
    <div class="fu-add">
      <textarea id="fuInput" rows="2" placeholder="أضف تحديث متابعة جديد… (يُسجَّل باسمك ووقته تلقائياً)"></textarea>
      <button class="btn btn-save" id="fuAdd" type="button">➕ إضافة حدث</button>
    </div>` : '';
  return `<div class="field"><label>سجلّ المتابعة اليومية</label><div class="fu-log">${items}</div>${add}</div>`;
}
async function addFollowup(id) {
  const inp = $('fuInput');
  const text = inp ? inp.value.trim() : '';
  if (!text) { toast('اكتب نصّ التحديث أولاً', true); return; }
  const btn = $('fuAdd'); if (btn) { btn.disabled = true; btn.textContent = '... إضافة'; }
  try {
    const res = await fetch(`/api/tasks/${id}/followup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تمت إضافة الحدث ✓');
    openModal(id);
    render();
  } catch (e) {
    toast('تعذّر: ' + e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = '➕ إضافة حدث'; }
  }
}
function startEditEvent(id, idx, btn) {
  const item = btn.closest('.fu-item');
  const body = item.querySelector('.fu-ibody');
  const cur = body.textContent;
  body.innerHTML = `<textarea class="fu-eta" rows="2"></textarea>
    <div class="fu-eacts"><button class="btn btn-save fu-savebtn" type="button">حفظ</button><button class="btn btn-cancel fu-cancelbtn" type="button">إلغاء</button></div>`;
  const ta = body.querySelector('.fu-eta');
  ta.value = cur; ta.focus();
  body.querySelector('.fu-savebtn').onclick = () => saveEvent(id, idx, ta.value.trim());
  body.querySelector('.fu-cancelbtn').onclick = () => openModal(id);
}
async function saveEvent(id, idx, text) {
  if (!text) { toast('نصّ الحدث فارغ', true); return; }
  try {
    const res = await fetch(`/api/tasks/${id}/followup/${idx}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم تعديل الحدث ✓'); openModal(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
async function deleteEvent(id, idx) {
  if (!confirm('حذف هذا الحدث وسجلّه نهائياً؟')) return;
  try {
    const res = await fetch(`/api/tasks/${id}/followup/${idx}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم حذف الحدث ✓'); openModal(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
function relText(t) {
  if (t.diffDays == null) return t.recurrence ? 'دورية' : 'بلا موعد';
  if (t.diffDays < 0) return `متأخرة ${Math.abs(t.diffDays)} يوم`;
  if (t.diffDays === 0) return 'اليوم';
  if (t.diffDays === 1) return 'غداً';
  return `بعد ${t.diffDays} يوم`;
}

// ===== KPIs / chips / filters =====
function syncViewTabs() {
  document.querySelectorAll('.view-tab[data-view]').forEach((x) => x.classList.toggle('active', x.dataset.view === state.view));
}

function renderKpis() {
  const s = state.summary;
  const byType = s.byType || {};
  const meet = s.meetings || { total: 0, scheduled: 0, unscheduled: 0 };

  // البطاقات الزمنية الأساسية
  const cards = [
    { kind: 'time', key: 'all', cls: '', num: s.total, lbl: 'إجمالي المهام' },
    { kind: 'time', key: 'today', cls: 'orange', num: s.today, lbl: 'مهام اليوم' },
    { kind: 'time', key: 'overdue', cls: 'red', num: s.overdue, lbl: 'متأخرة' },
    { kind: 'time', key: 'soon3', cls: 'orange', num: s.soon3, lbl: 'خلال 3 أيام' },
    { kind: 'time', key: 'week', cls: '', num: s.thisWeek, lbl: 'هذا الأسبوع' },
    { kind: 'time', key: 'undated', cls: '', num: s.undated, lbl: 'بلا موعد' },
    { kind: 'time', key: 'recurring', cls: '', num: s.recurring, lbl: 'دورية' },
    { kind: 'time', key: '_done', cls: 'green', num: (s.completion || 0) + '%', lbl: 'نسبة الإنجاز' },
  ];

  // بطاقة لكل نوع (المعروفة أولاً ثم أي نوع آخر موجود)
  const presentTypes = [
    ...TYPES.filter((t) => byType[t]),
    ...Object.keys(byType).filter((k) => k && !TYPES.includes(k)),
  ];
  presentTypes.forEach((t) => cards.push({ kind: 'type', key: t, cls: 'kpi-type', num: byType[t] || 0, lbl: `${TYPE_ICON[t] || '🏷️'} ${t}` }));
  if (byType['']) cards.push({ kind: 'type', key: '__none__', cls: 'kpi-type', num: byType[''], lbl: '🏷️ بلا نوع' });

  // بطاقة الاجتماعات (التركيز على غير المجدولة)
  if (meet.total) cards.push({ kind: 'meet', key: 'meetings', cls: 'kpi-meet', num: meet.unscheduled, lbl: '🤝 اجتماعات غير مجدولة' });

  const isActive = (c) =>
    (c.kind === 'time' && state.view !== 'meetings' && state.time === c.key) ||
    (c.kind === 'type' && state.types.includes(c.key)) ||
    (c.kind === 'meet' && state.view === 'meetings');

  $('kpis').innerHTML = cards.map((c) => `
    <div class="kpi ${c.cls || ''} ${isActive(c) ? 'active' : ''}" data-kind="${c.kind}" data-key="${esc(c.key)}">
      <div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`).join('');

  $('kpis').querySelectorAll('.kpi').forEach((el) => {
    el.onclick = () => {
      const { kind, key } = el.dataset;
      if (kind === 'time') { if (key === '_done') return; if (state.view === 'meetings') state.view = 'table'; state.time = state.time === key ? 'all' : key; }
      else if (kind === 'type') { if (state.view === 'meetings') state.view = 'table'; const i = state.types.indexOf(key); if (i > -1) state.types.splice(i, 1); else state.types.push(key); }
      else if (kind === 'meet') { state.view = 'meetings'; }
      render();
    };
  });
}
function renderChips() {
  $('timeChips').innerHTML = TIME_CHIPS.map((c) =>
    `<button class="chip ${state.time === c.key ? 'active' : ''}" data-time="${c.key}">${c.label}<span class="c">${countForTime(c.key)}</span></button>`).join('');
  $('timeChips').querySelectorAll('.chip').forEach((el) => { el.onclick = () => { state.time = el.dataset.time; render(); }; });
}
function fillSelect(id, values, current) {
  const el = $(id); const first = el.querySelector('option').outerHTML;
  el.innerHTML = first + values.map((v) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('');
}
// مكوّن اختيار متعدّد (قائمة مربّعات): يحدّث state[stateKey] (مصفوفة) عند التغيير
function buildMS(id, stateKey, values) {
  const el = $(id); if (!el) return;
  const sel = state[stateKey];
  const all = el.dataset.all || '';
  const label = sel.length === 0 ? `كل ${all}` : (sel.length === 1 ? (sel[0] === '__none__' ? 'بلا نوع' : sel[0]) : `${sel.length} مختار`);
  el.innerHTML =
    `<button type="button" class="ms-btn ${sel.length ? 'has' : ''}"><span class="ms-lbl">${esc(label)}</span><span class="ms-ar">▾</span></button>
     <div class="ms-panel">${values.length ? values.map((v) => `<label class="ms-opt"><input type="checkbox" value="${esc(v.value)}" ${sel.includes(v.value) ? 'checked' : ''}><span>${esc(v.label)}</span></label>`).join('') : '<div class="ms-empty">لا خيارات</div>'}</div>`;
  el.querySelector('.ms-btn').onclick = (e) => {
    e.stopPropagation();
    const open = el.classList.contains('open');
    document.querySelectorAll('.ms.open').forEach((x) => x.classList.remove('open'));
    if (!open) el.classList.add('open');
  };
  el.querySelectorAll('.ms-opt input').forEach((inp) => inp.onchange = () => {
    const i = sel.indexOf(inp.value);
    if (inp.checked && i === -1) sel.push(inp.value);
    else if (!inp.checked && i > -1) sel.splice(i, 1);
    render();
  });
}
function renderFilters() {
  const opts = (arr) => (arr || []).map((v) => ({ value: v, label: v }));
  buildMS('msProject', 'projects', opts(state.filters.projects));
  buildMS('msOwner', 'owners', opts(state.filters.owners));
  buildMS('msPriority', 'priorities', opts(state.filters.priorities));
  buildMS('msStatus', 'statuses', opts(state.filters.statuses));
  const typeVals = opts(state.filters.types);
  if (state.summary && state.summary.byType && state.summary.byType['']) typeVals.push({ value: '__none__', label: 'بلا نوع' });
  buildMS('msType', 'types', typeVals);
}

// ===== Table view =====
function renderTable() {
  const list = sortList(applyFilters());
  $('countLine').textContent = `عرض ${list.length} من ${state.tasks.length} مهمة`;
  if (!list.length) { $('viewArea').innerHTML = '<div class="table-wrap"><div class="empty">لا توجد مهام مطابقة للفلاتر.</div></div>'; return; }
  const arrow = (k) => state.sortKey === k ? `<span class="arrow">${state.sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
  const rows = list.map((t) => {
    const rowCls = t.isDone ? 'row-done' : t.isOverdue ? 'row-overdue' : t.isSoon3 ? 'row-soon' : '';
    const dlCls = t.isOverdue ? 'overdue' : t.isSoon3 ? 'soon' : '';
    const dl = t.deadlineIso || (t.deadlineRaw ? esc(t.deadlineRaw) : '—');
    return `<tr class="${rowCls}" data-id="${t.id}">
      <td>${esc(t.project)}</td>
      <td>${esc(t.file)}</td>
      <td>${typeCell(t.type)}</td>
      <td class="cell-owner">${esc(t.owner)}</td>
      <td class="fu-col">${deliverableCell(t)}</td>
      <td class="deadline-cell ${dlCls}"><span class="iso">${dl}</span><span class="rel">${relText(t)}</span></td>
      <td><span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span></td>
      <td><span class="badge st ${stClass(t.status)}">${esc(t.status)}</span></td>
      <td class="fu-col">${followupCell(t)}</td></tr>`;
  }).join('');
  $('viewArea').innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th data-sort="project">المشروع ${arrow('project')}</th>
      <th data-sort="file">الملف ${arrow('file')}</th>
      <th data-sort="type">النوع ${arrow('type')}</th>
      <th data-sort="owner">المسؤول ${arrow('owner')}</th>
      <th>المخرج المطلوب</th>
      <th data-sort="deadline">الموعد ${arrow('deadline')}</th>
      <th data-sort="priority">الأولوية ${arrow('priority')}</th>
      <th data-sort="status">الحالة ${arrow('status')}</th>
      <th>المتابعة</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  $('viewArea').querySelectorAll('th[data-sort]').forEach((th) => {
    th.onclick = () => { const k = th.dataset.sort; if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = k; state.sortDir = 'asc'; } renderTable(); };
  });
  $('viewArea').querySelectorAll('tbody tr').forEach((tr) => { tr.onclick = () => openModal(Number(tr.dataset.id)); });
}

// ===== Kanban view =====
function renderKanban() {
  const list = applyFilters();
  $('countLine').textContent = `عرض ${list.length} من ${state.tasks.length} مهمة` + (canEdit() ? ' — اسحب البطاقة لتغيير الحالة' : '');
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, []]));
  list.forEach((t) => { (byStatus[t.status] || (byStatus[t.status] = [])).push(t); });
  const card = (t) => {
    const dlCls = t.isOverdue ? 'overdue' : t.isSoon3 ? 'soon' : '';
    return `<div class="kcard pri-${esc(t.priority)}" data-id="${t.id}">
      <div class="kp">${esc(t.project)}</div>
      <div style="font-size:12.5px;color:var(--text);margin-bottom:6px">${esc((t.deliverable || '').slice(0, 90))}${(t.deliverable || '').length > 90 ? '…' : ''}</div>
      <div class="km"><span>${esc(t.owner.split('\n')[0])}</span><span class="kdl ${dlCls}">${t.deadlineIso || esc(t.deadlineRaw || '—')}</span></div></div>`;
  };
  $('viewArea').innerHTML = `<div class="kanban">${STATUSES.map((s) => `
    <div class="kcol"><div class="kcol-head"><span>${s}</span><span class="c">${byStatus[s].length}</span></div>
    <div class="kbody ${canEdit() ? '' : 'disabled'}" data-status="${s}">${byStatus[s].map(card).join('')}</div></div>`).join('')}</div>`;

  $('viewArea').querySelectorAll('.kcard').forEach((el) => { el.onclick = () => openModal(Number(el.dataset.id)); });

  if (canEdit() && window.Sortable) {
    $('viewArea').querySelectorAll('.kbody').forEach((col) => {
      Sortable.create(col, {
        group: 'kanban', animation: 150, ghostClass: 'sortable-ghost',
        onEnd: async (evt) => {
          const newStatus = evt.to.dataset.status;
          const id = Number(evt.item.dataset.id);
          if (evt.from.dataset.status === newStatus) return;
          await changeStatus(id, newStatus);
        },
      });
    });
  }
}

async function changeStatus(id, status) {
  try {
    const res = await fetch(`/api/tasks/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم تحديث الحالة ✓');
    render();
  } catch (e) { toast('تعذّر التحديث: ' + e.message, true); load(true); }
}

// ===== Calendar view =====
function renderCalendar() {
  const list = applyFilters().filter((t) => t.deadlineIso);
  if (state.calY == null) { const d = new Date(); state.calY = d.getFullYear(); state.calM = d.getMonth(); }
  const y = state.calY, m = state.calM;
  const monthName = new Date(y, m, 1).toLocaleDateString('ar-SY-u-nu-latn', { month: 'long', year: 'numeric' });
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 1) % 7; // السبت=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const byDay = {};
  list.forEach((t) => { const [ty, tm] = t.deadlineIso.split('-').map(Number); if (ty === y && tm === m + 1) { const d = Number(t.deadlineIso.split('-')[2]); (byDay[d] || (byDay[d] = [])).push(t); } });

  const dows = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  let cells = dows.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (new Date(y, m, d).getDay() + 1) % 7;
    const tasks = byDay[d] || [];
    const tHtml = tasks.map((t) => {
      const cls = t.priority === 'حرجة' ? 'crit' : t.priority === 'عالية' ? 'high' : '';
      return `<div class="cal-task ${cls}" data-id="${t.id}" title="${esc(t.deliverable)}">${esc(t.project)}</div>`;
    }).join('');
    cells += `<div class="cal-cell ${iso === todayStr ? 'today' : ''} ${dow === 6 ? 'fri' : ''}"><div class="d">${d}</div>${tHtml}</div>`;
  }
  $('countLine').textContent = `${list.length} مهمة مؤرّخة (تظهر المهام ذات التواريخ فقط)`;
  $('viewArea').innerHTML = `<div class="table-wrap" style="padding:16px">
    <div class="cal-head"><button id="calPrev">‹ السابق</button><h3>${monthName}</h3><button id="calNext">التالي ›</button></div>
    <div class="cal-grid">${cells}</div></div>`;
  $('calPrev').onclick = () => { state.calM--; if (state.calM < 0) { state.calM = 11; state.calY--; } renderCalendar(); };
  $('calNext').onclick = () => { state.calM++; if (state.calM > 11) { state.calM = 0; state.calY++; } renderCalendar(); };
  $('viewArea').querySelectorAll('.cal-task').forEach((el) => { el.onclick = () => openModal(Number(el.dataset.id)); });
}

// ===== المخرجات المطلوبة ككائنات (كتل مفصولة بسطر فارغ) =====
function deliverableSection(t) {
  const items = fuBlocks(t.deliverable);
  const ed = canEdit();
  const acts = (i) => ed ? `<span class="fu-acts"><button class="fu-ico dv-ed" type="button" data-idx="${i}" title="تعديل">✏️</button><button class="fu-ico dv-del" type="button" data-idx="${i}" title="حذف">🗑</button></span>` : '';
  const list = items.length ? items.map((b, i) => `
    <div class="fu-item plain" data-idx="${i}">
      <div class="fu-ihead"><span class="dv-num">مخرج ${i + 1}</span>${acts(i)}</div>
      <div class="fu-ibody">${esc(b)}</div></div>`).join('') : '<div class="fu-empty">لا توجد مخرجات بعد.</div>';
  const add = ed ? `<div class="fu-add"><textarea id="dvInput" rows="2" placeholder="أضف مخرجاً مطلوباً جديداً…"></textarea><button class="btn btn-save" id="dvAdd" type="button">➕ إضافة مخرج</button></div>` : '';
  return `<div class="field"><label>المخرجات المطلوبة</label><div class="fu-log">${list}</div>${add}</div>`;
}
async function addDeliverable(id) {
  const inp = $('dvInput'); const text = inp ? inp.value.trim() : '';
  if (!text) { toast('اكتب نصّ المخرج أولاً', true); return; }
  const btn = $('dvAdd'); if (btn) { btn.disabled = true; btn.textContent = '... إضافة'; }
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تمت إضافة المخرج ✓'); openModal(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); if (btn) { btn.disabled = false; btn.textContent = '➕ إضافة مخرج'; } }
}
function startEditDeliv(id, idx, btn) {
  const body = btn.closest('.fu-item').querySelector('.fu-ibody'); const cur = body.textContent;
  body.innerHTML = `<textarea class="fu-eta" rows="3"></textarea><div class="fu-eacts"><button class="btn btn-save dv-savebtn" type="button">حفظ</button><button class="btn btn-cancel dv-cancelbtn" type="button">إلغاء</button></div>`;
  const ta = body.querySelector('.fu-eta'); ta.value = cur; ta.focus();
  body.querySelector('.dv-savebtn').onclick = () => saveDeliv(id, idx, ta.value.trim());
  body.querySelector('.dv-cancelbtn').onclick = () => openModal(id);
}
async function saveDeliv(id, idx, text) {
  if (!text) { toast('نصّ المخرج فارغ', true); return; }
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable/${idx}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم تعديل المخرج ✓'); openModal(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
async function deleteDeliv(id, idx) {
  if (!confirm('حذف هذا المخرج؟')) return;
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable/${idx}`, { method: 'DELETE' });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم حذف المخرج ✓'); openModal(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}

// ===== Meetings view (قائمة الاجتماعات) =====
function renderMeetings() {
  let list = state.tasks.filter((t) => t.isMeeting);
  if (state.projects.length) list = list.filter((t) => state.projects.includes(t.project));
  if (state.owners.length) list = list.filter((t) => t.owners.some((o) => state.owners.includes(o)));
  if (state.types.length) list = list.filter((t) => state.types.includes(t.type || '__none__'));
  if (state.search) {
    const q = state.search.trim();
    list = list.filter((t) => [t.project, t.dept, t.file, t.owner, t.deliverable, t.notes, t.followup, t.source].join(' ').includes(q));
  }
  // غير المجدول أولاً (للتركيز عليه) ثم المجدول في الأسفل؛ وداخل كل مجموعة حسب الموعد
  list = [...list].sort((a, b) => {
    if (a.meetingScheduled !== b.meetingScheduled) return a.meetingScheduled ? 1 : -1;
    const x = a.deadlineIso || '9999-99-99', y = b.deadlineIso || '9999-99-99';
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const unsched = list.filter((t) => !t.meetingScheduled).length;
  $('countLine').textContent = `${list.length} اجتماع — ${unsched} غير مجدول · ${list.length - unsched} مجدول`
    + (canEdit() ? ' (انقر زرّ الحالة للتبديل)' : '');
  if (!list.length) { $('viewArea').innerHTML = '<div class="table-wrap"><div class="empty">لا توجد اجتماعات. فعّل مربّع «اجتماع» لأي مهمة لتظهر هنا.</div></div>'; return; }

  const rows = list.map((t) => {
    const sch = t.meetingScheduled;
    const dlCls = !sch && t.isOverdue ? 'overdue' : !sch && t.isSoon3 ? 'soon' : '';
    const dl = t.deadlineIso || (t.deadlineRaw ? esc(t.deadlineRaw) : '—');
    const btn = canEdit()
      ? `<button class="btn mt-toggle ${sch ? 'btn-cancel' : 'btn-save'}" data-id="${t.id}" data-sched="${sch ? 0 : 1}">${sch ? '↩ إلغاء الجدولة' : '✓ تم جدولته'}</button>`
      : '';
    return `<tr class="${sch ? 'row-done' : ''}" data-id="${t.id}">
      <td>${esc(t.project)}</td>
      <td class="cell-owner">${esc(t.owner)}</td>
      <td><div class="deliv">${esc(t.deliverable)}</div></td>
      <td class="deadline-cell ${dlCls}"><span class="iso">${dl}</span><span class="rel">${relText(t)}</span></td>
      <td><span class="badge ${sch ? 'mt-sched' : 'mt-unsched'}">${sch ? MEETING_SCHEDULED : MEETING_UNSCHEDULED}</span></td>
      <td>${btn}</td></tr>`;
  }).join('');
  $('viewArea').innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th>المشروع</th><th>المسؤول</th><th>موضوع الاجتماع / المخرج</th><th>الموعد</th><th>حالة الاجتماع</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
  $('viewArea').querySelectorAll('tbody tr').forEach((tr) => {
    tr.onclick = (e) => { if (e.target.closest('.mt-toggle')) return; openModal(Number(tr.dataset.id)); };
  });
  $('viewArea').querySelectorAll('.mt-toggle').forEach((b) => {
    b.onclick = async (e) => { e.stopPropagation(); await setMeetingScheduled(Number(b.dataset.id), b.dataset.sched === '1'); };
  });
}

async function setMeetingScheduled(id, scheduled) {
  try {
    const res = await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduled }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم تحديث جدولة الاجتماع ✓');
    render();
  } catch (e) { toast('تعذّر التحديث: ' + e.message, true); load(true); }
}

// ===== Modal: view + edit =====
function openModal(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  $('mTitle').textContent = `${t.project}${t.file ? ' — ' + t.file : ''}`;
  const F = (label, val) => val ? `<div class="field"><label>${label}</label><div class="val">${esc(val)}</div></div>` : '';
  const meetingField = t.isMeeting
    ? `<div class="field"><label>الاجتماع</label><div class="val"><span class="badge ${t.meetingScheduled ? 'mt-sched' : 'mt-unsched'}">${esc(t.meetingStatus)}</span></div></div>`
    : '';
  $('mBody').innerHTML =
    F('المشروع', t.project) + F('القسم / الشركة / المشروع', t.dept) + F('الملف', t.file) + F('النوع', t.type) + F('المسؤول المعني', t.owner) +
    deliverableSection(t) +
    `<div class="field"><label>الموعد / الدورية</label><div class="val">${esc(t.deadlineRaw || '—')} <span style="color:var(--muted)">(${relText(t)})</span></div></div>` +
    `<div class="field"><label>الأولوية</label><div class="val"><span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span></div></div>` +
    `<div class="field"><label>الحالة</label><div class="val"><span class="badge st ${stClass(t.status)}">${esc(t.status)}</span></div></div>` +
    meetingField +
    followupSection(t) + F('مصدر المهمة', t.source) + F('ملاحظات', t.notes) +
    reminderSection(t);
  $('mFoot').innerHTML = canEdit() ? `<button class="btn btn-edit" id="mEdit">✏️ تعديل</button>` : '';
  if (canEdit()) $('mEdit').onclick = () => openEdit(t);
  const fuAdd = $('fuAdd');
  if (fuAdd) fuAdd.onclick = () => addFollowup(t.id);
  $('mBody').querySelectorAll('.fu-ed').forEach((b) => b.onclick = () => startEditEvent(t.id, Number(b.dataset.idx), b));
  $('mBody').querySelectorAll('.fu-del').forEach((b) => b.onclick = () => deleteEvent(t.id, Number(b.dataset.idx)));
  const dvAdd = $('dvAdd');
  if (dvAdd) dvAdd.onclick = () => addDeliverable(t.id);
  $('mBody').querySelectorAll('.dv-ed').forEach((b) => b.onclick = () => startEditDeliv(t.id, Number(b.dataset.idx), b));
  $('mBody').querySelectorAll('.dv-del').forEach((b) => b.onclick = () => deleteDeliv(t.id, Number(b.dataset.idx)));
  bindReminderSection(t);
  $('modalBack').classList.add('open');
}

// قسم «تذكيراتي» داخل نافذة المهمة (لكل مستخدم)
function reminderSection(t) {
  if (!state.storeEnabled) {
    return `<div class="rem-box"><label class="rem-title">🔔 تذكيراتي</label>
      <div style="color:var(--muted);font-size:13px">ميزة التذكيرات تتطلب تفعيل التخزين الدائم (DATA_SHEET_ID).</div></div>`;
  }
  const pref = state.reminders[String(t.id)] || { methods: [], offsets: [] };
  const chk = (arr, item) => arr.includes(item.key) ? 'checked' : '';
  const methods = REMINDER_METHODS.map((m) => `<label class="rem-opt"><input type="checkbox" data-rem="method" value="${m.key}" ${chk(pref.methods, m)}> ${m.label}</label>`).join('');
  const offsets = REMINDER_OFFSETS.map((o) => `<label class="rem-opt"><input type="checkbox" data-rem="offset" value="${o.key}" ${chk(pref.offsets, o)}> ${o.label}</label>`).join('');
  const calUrl = state.me && state.me.calToken ? `${location.origin}/api/calendar/${state.me.calToken}.ics` : '';
  const calHint = calUrl
    ? `<div class="rem-cal">لإضافة مهامك إلى تقويم حاسوبك، اشترك بهذا الرابط مرة واحدة:
        <div class="rem-cal-row"><input id="calUrl" readonly value="${esc(calUrl)}"><button class="btn btn-cancel" id="calCopy" type="button">نسخ</button></div></div>`
    : '';
  return `<div class="rem-box">
    <label class="rem-title">🔔 تذكيراتي لهذه المهمة</label>
    <div class="rem-group"><span class="rem-sub">طريقة التذكير:</span>${methods}</div>
    <div class="rem-group"><span class="rem-sub">توقيت التذكير:</span>${offsets}</div>
    <button class="btn btn-save" id="remSave" type="button" style="margin-top:8px">💾 حفظ التذكير</button>
    ${calHint}
  </div>`;
}

function bindReminderSection(t) {
  if (!state.storeEnabled) return;
  const save = $('remSave');
  if (save) save.onclick = async () => {
    const methods = [...document.querySelectorAll('[data-rem="method"]:checked')].map((x) => x.value);
    const offsets = [...document.querySelectorAll('[data-rem="offset"]:checked')].map((x) => x.value);
    save.disabled = true; save.textContent = '... حفظ';
    try {
      const res = await fetch(`/api/tasks/${t.id}/reminder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ methods, offsets }) });
      const data = await res.json(); if (!data.ok) throw new Error(data.error);
      state.reminders[String(t.id)] = { methods, offsets };
      toast('تم حفظ التذكير ✓');
    } catch (e) { toast('تعذّر الحفظ: ' + e.message, true); }
    save.disabled = false; save.textContent = '💾 حفظ التذكير';
  };
  const copy = $('calCopy');
  if (copy) copy.onclick = () => { const i = $('calUrl'); i.select(); document.execCommand('copy'); toast('تم نسخ رابط التقويم ✓'); };
}

function field(label, name, value, type = 'text') {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${esc(value)}"></div>`;
}
function textarea(label, name, value) {
  return `<div class="field"><label>${label}</label><textarea name="${name}">${esc(value)}</textarea></div>`;
}
function selectField(label, name, options, value) {
  return `<div class="field"><label>${label}</label><select name="${name}">${options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
}
// حقل المشروع: قائمة منسدلة من المشاريع الموجودة + خيار «إضافة جديد»
function projectSelectField(value) {
  const projs = (state.filters.projects || []).slice();
  if (value && !projs.includes(value)) projs.unshift(value);
  const opts = projs.map((p) => `<option value="${esc(p)}" ${p === value ? 'selected' : ''}>${esc(p)}</option>`).join('');
  return `<div class="field"><label>المشروع</label>
    <select name="project" id="projSel">${opts}<option value="__new__">➕ إضافة مشروع جديد…</option></select>
    <input name="projectNew" id="projNew" type="text" placeholder="اكتب اسم المشروع الجديد" style="display:none;margin-top:8px"></div>`;
}

function openEdit(t) {
  const isNew = !t;
  t = t || { project: '', dept: '', file: '', type: '', owner: '', deliverable: '', deadlineRaw: '', priority: 'متوسطة', status: 'لم تبدأ', followup: '', source: '', notes: '', isMeeting: false, meetingStatus: '' };
  $('mTitle').textContent = isNew ? 'إضافة مهمة جديدة' : 'تعديل المهمة';
  $('mBody').innerHTML = `<form id="taskForm">
    ${projectSelectField(t.project)}
    <div class="form-row">${field('الملف', 'file', t.file)}${selectField('النوع', 'type', ['', ...TYPES], t.type)}</div>
    ${field('المسؤول المعني (افصل بسطر لكل شخص)', 'owner', t.owner)}
    ${isNew ? textarea('المخرج المطلوب', 'deliverable', t.deliverable) : '<div class="field"><label>المخرجات المطلوبة</label><div class="val" style="color:var(--muted);font-size:13px">تُدار المخرجات (إضافة/تعديل/حذف) من نافذة عرض المهمة.</div></div>'}
    <div class="form-row">${field('الموعد / الدورية', 'deadlineRaw', t.deadlineRaw)}${selectField('الأولوية', 'priority', PRIORITIES, t.priority)}</div>
    ${selectField('الحالة', 'status', STATUSES, t.status)}
    <div class="rem-box" style="margin:0 0 16px">
      <label class="rem-opt" style="font-weight:800;color:var(--navy)"><input type="checkbox" name="meeting" id="mtgChk" ${t.isMeeting ? 'checked' : ''}> 🤝 يوجد اجتماع مرتبط بهذه المهمة</label>
      <div id="mtgStatusWrap" style="margin-top:10px;${t.isMeeting ? '' : 'display:none'}">
        <label class="rem-opt"><input type="checkbox" name="scheduled" ${t.meetingScheduled ? 'checked' : ''}> ✓ تمت جدولة الاجتماع</label>
      </div>
    </div>
    <div class="field"><label>سجلّ المتابعة اليومية</label><div class="val" style="color:var(--muted);font-size:13px">تُدار المتابعة (إضافة/تعديل/حذف الأحداث) من نافذة عرض المهمة — ليبقى السجلّ متوازياً.</div></div>
    <div class="form-row">${field('مصدر المهمة', 'source', t.source)}${field('ملاحظات', 'notes', t.notes)}</div>
  </form>`;
  const mtgChk = $('mtgChk');
  if (mtgChk) mtgChk.onchange = () => { const w = $('mtgStatusWrap'); if (w) w.style.display = mtgChk.checked ? '' : 'none'; };
  const projSel = $('projSel');
  if (projSel) projSel.onchange = () => { const n = $('projNew'); if (n) { n.style.display = projSel.value === '__new__' ? '' : 'none'; if (projSel.value === '__new__') n.focus(); } };
  $('mFoot').innerHTML = `<button class="btn btn-save" id="mSave">💾 حفظ</button><button class="btn btn-cancel" id="mCancel">إلغاء</button>`;
  $('mSave').onclick = () => saveTask(isNew ? null : t.id);
  $('mCancel').onclick = () => (isNew ? closeModal() : openModal(t.id));
  $('modalBack').classList.add('open');
}

async function saveTask(id) {
  const form = $('taskForm');
  const payload = {};
  new FormData(form).forEach((v, k) => { payload[k] = v; });
  // مربّعات الاختيار: FormData يحذفها عند عدم التفعيل — نضبطها صراحةً
  const mc = form.querySelector('[name="meeting"]');
  const sc = form.querySelector('[name="scheduled"]');
  if (mc) payload.meeting = mc.checked;
  payload.scheduled = !!(mc && mc.checked && sc && sc.checked); // الجدولة فقط حين يوجد اجتماع
  // المشروع: «إضافة جديد» → استخدم النصّ المُدخَل
  if (payload.project === '__new__') payload.project = (payload.projectNew || '').trim();
  delete payload.projectNew;
  const btn = $('mSave'); btn.disabled = true; btn.textContent = '... جارٍ الحفظ';
  try {
    const url = id ? `/api/tasks/${id}` : '/api/tasks';
    const method = id ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast(id ? 'تم حفظ التعديلات ✓' : 'تمت إضافة المهمة ✓');
    closeModal();
    await load(true);
  } catch (e) { toast('تعذّر الحفظ: ' + e.message, true); btn.disabled = false; btn.textContent = '💾 حفظ'; }
}

function closeModal() { $('modalBack').classList.remove('open'); }

// ===== Notification bell (in-app) =====
function renderBell() {
  // المتأخرة (غير المنجزة) + مهام اليوم
  const items = state.tasks
    .filter((t) => (t.isOverdue || t.isToday) && !t.isDone)
    .sort((a, b) => (a.diffDays ?? 0) - (b.diffDays ?? 0));
  const cnt = items.length;
  const badge = $('bellCount');
  badge.textContent = cnt;
  badge.style.display = cnt ? '' : 'none';

  const head = `<div class="bp-head">التنبيهات (${cnt})</div>`;
  const body = cnt
    ? items.map((t) => {
        const cls = t.isOverdue ? 'overdue' : 'today';
        return `<div class="bp-item ${cls}" data-id="${t.id}">
          <div class="bp-t">${esc(t.project)}</div>
          <div class="bp-m"><span>${esc(t.owner.split('\n')[0])}</span><span>${relText(t)}</span></div></div>`;
      }).join('')
    : '<div class="bp-empty">لا توجد مهام مستحقّة أو متأخرة 🎉</div>';
  $('bellPanel').innerHTML = head + body;
  $('bellPanel').querySelectorAll('.bp-item').forEach((el) => {
    el.onclick = () => { $('bellPanel').classList.remove('open'); openModal(Number(el.dataset.id)); };
  });
}

// ===== Render dispatch =====
function render() {
  renderUser();
  renderKpis(); renderChips(); renderFilters(); renderBell();
  $('addBtn').style.display = canEdit() ? '' : 'none';
  syncViewTabs();
  if (state.view === 'kanban') renderKanban();
  else if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'meetings') renderMeetings();
  else renderTable();
  $('viewArea').classList.toggle('expanded', state.expanded);
}

async function load(refresh = false) {
  try {
    if (!state.me) { await fetchMe(); await fetchReminders(); }
    await fetchTasks(refresh);
    $('sync').textContent = fmtSync(state.meta.fetchedAt);
    render();
    if (window.Notification && Notification.permission === 'granted') setupPush(false);
  } catch (e) {
    if (e.message === 'redirect') return;
    $('viewArea').innerHTML = `<div class="table-wrap"><div class="empty">تعذّر تحميل المهام: ${esc(e.message)}</div></div>`;
  }
}

// ===== Events =====
$('refreshBtn').onclick = () => load(true);
$('addBtn').onclick = () => openEdit(null);
state.expanded = localStorage.getItem('eo_expanded') === '1';
(function () {
  const eb = $('expandBtn');
  const sync = () => { if (eb) { eb.classList.toggle('active', state.expanded); eb.textContent = state.expanded ? '↕ عرض مضغوط' : '↕ عرض موسّع'; } };
  if (eb) eb.onclick = () => { state.expanded = !state.expanded; localStorage.setItem('eo_expanded', state.expanded ? '1' : '0'); sync(); render(); };
  sync();
})();
$('bellBtn').onclick = (e) => { e.stopPropagation(); $('bellPanel').classList.toggle('open'); };
$('logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };

// ===== Web Push =====
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function setupPush(interactive) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    if (interactive) toast('متصفحك لا يدعم إشعارات Push', true);
    return;
  }
  try {
    const keyRes = await (await fetch('/api/push/key')).json();
    if (!keyRes.key) { if (interactive) toast('إشعارات المتصفح غير مُهيّأة على الخادم', true); return; }
    if (interactive && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('لم تُمنح صلاحية الإشعارات', true); return; }
    }
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const sub = await reg.pushManager.getSubscription() ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(keyRes.key) });
    await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    $('pushBtn').textContent = '🔔';
    $('pushBtn').title = 'إشعارات المتصفح مُفعّلة';
    if (interactive) toast('تم تفعيل إشعارات المتصفح ✓');
  } catch (e) { if (interactive) toast('تعذّر تفعيل الإشعارات: ' + e.message, true); }
}
$('pushBtn').onclick = () => setupPush(true);
document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap')) $('bellPanel').classList.remove('open'); });
document.querySelectorAll('.view-tab[data-view]').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.view-tab[data-view]').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active'); state.view = tab.dataset.view; render();
  };
});
document.addEventListener('click', (e) => { if (!e.target.closest('.ms')) document.querySelectorAll('.ms.open').forEach((x) => x.classList.remove('open')); });
let searchTimer;
$('fSearch').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 200); };
$('resetBtn').onclick = () => { Object.assign(state, { time: 'all', projects: [], owners: [], priorities: [], statuses: [], types: [], search: '' }); $('fSearch').value = ''; render(); };
$('mClose').onclick = closeModal;
$('modalBack').onclick = (e) => { if (e.target === $('modalBack')) closeModal(); };

load();
setInterval(() => { if (!$('modalBack').classList.contains('open')) load(true); }, 30000);
