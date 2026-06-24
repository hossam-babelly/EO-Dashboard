'use strict';

const state = {
  tasks: [],
  summary: {},
  filters: {},
  meta: {},
  me: null,
  dataType: 'tasks', // tasks | meetings
  shape: 'table',    // table | kanban | calendar
  time: 'all',
  projects: [],
  owners: [],
  linked: [],
  priorities: [],
  statuses: [],
  types: [],
  search: '',
  sortKey: 'created',
  sortDir: 'desc',
  expanded: false,
  tableCols: [],
  colWidths: {},        // عرض الأعمدة المخصّص (محفوظ لكل مستخدم)
  expandedRows: new Set(), // صفوف مُوسّعة فردياً في الوضع المضغوط
  newDv: [],
  newEv: [],
  editLinked: [],   // قائمة «مرتبط بـ» المحلية في نافذة الإضافة/التعديل
  editMeetings: [], // قائمة الاجتماعات المحلية في نافذة الإضافة/التعديل
  meetingFilter: 'all', // فلتر عرض الاجتماعات: all | required | scheduled | done
  meetingDateFrom: '',  // فلتر تاريخ الاجتماعات المجدولة (من)
  meetingDateTo: '',    // (إلى)
  calY: null,
  calM: null, // 0-based
};

const STATUSES = ['لم تبدأ', 'قيد التنفيذ', 'منجزة', 'متوقفة'];
const PRIORITIES = ['حرجة', 'عالية', 'متوسطة'];
const TYPES = ['E-mail', 'مجلس الإدارة', 'مكتب تنفيذي', 'تواقيع واعتمادات'];
// حالات الاجتماع الثلاث
const MEETING_STATUS = { required: 'مطلوب', scheduled: 'مجدول', done: 'تم' };
const MEETING_STATUS_CLS = { required: 'mt-unsched', scheduled: 'mt-sched-dt', done: 'mt-sched' };
// أيقونة مختصرة لكل نوع (للبطاقات)
const TYPE_ICON = { 'E-mail': '✉️', 'مجلس الإدارة': '🏛️', 'مكتب تنفيذي': '🏢', 'تواقيع واعتمادات': '✍️' };
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

// أيقونة تيليجرام الرسمية (طائرة ورقية بيضاء داخل دائرة زرقاء) — SVG مضمّن
const TG_ICON = '<svg class="tg-ic" viewBox="0 0 240 240" width="15" height="15" aria-hidden="true" style="vertical-align:-3px"><circle cx="120" cy="120" r="120" fill="#29a9eb"/><path fill="#fff" d="M52 117l116-45c6-2 11 2 9 11l-20 93c-1 6-5 8-11 5l-31-23-15 14c-2 2-4 3-7 3l3-34 62-56c3-2-1-4-4-2l-77 48-33-10c-7-2-7-7 2-10z"/></svg>';

// ===== Auth =====
function canEdit() {
  return !!state.meta.canWrite && !!state.me && (state.me.role === 'admin' || state.me.role === 'editor');
}
function isAdmin() { return !!state.me && state.me.role === 'admin'; }
// تعديل السجل متاح للمحرّر/المدير فقط (المشاهد ممنوع)؛ واسم المستخدم في السجل للمدير فقط
function canEditLog() { return canEdit(); }
async function fetchMe() {
  const res = await fetch('/api/me');
  if (res.status === 401) { location.href = '/login.html'; throw new Error('redirect'); }
  const data = await res.json();
  state.me = data.user;
  state.attachmentsEnabled = !!data.attachmentsEnabled;
  state.telegramEnabled = !!data.telegramEnabled;
  state.telegramBot = data.telegramBot || '';
  state.profile = data.profile || '';
  state.profiles = data.profiles || [];
}
function renderUser() {
  if (!state.me) return;
  const roleAr = { admin: 'مدير', editor: 'محرّر', viewer: 'مشاهد' }[state.me.role] || '';
  $('userChip').innerHTML = `${esc(state.me.name)}<span class="role">${roleAr}</span>`;
  $('userChip').style.display = '';
  $('logoutBtn').style.display = state.me && !state.meta.authDisabled ? '' : 'none';
  const ub = $('usersBtn'); if (ub) ub.style.display = state.me.role === 'admin' ? '' : 'none';
  // المحرّر/المشاهد: زرّ «حسابي» بدل زرّ المستخدمين
  const ab = $('accountBtn'); if (ab) ab.style.display = (state.me.role !== 'admin' && !state.meta.authDisabled) ? '' : 'none';
  // مبدّل البروفايل (يظهر لمن لديه أكثر من بروفايل)
  const ps = $('profileSwitch');
  if (ps) {
    const profs = state.profiles || [];
    if (profs.length > 1) {
      ps.style.display = '';
      ps.innerHTML = profs.map((p) => `<option value="${esc(p.tab)}" ${p.tab === state.profile ? 'selected' : ''}>${esc(p.label || p.tab)}</option>`).join('');
    } else { ps.style.display = 'none'; }
  }
  const pb = $('pushBtn');
  if ('PushManager' in window) {
    pb.style.display = '';
    const granted = window.Notification && Notification.permission === 'granted';
    pb.classList.toggle('on', !!granted);
    pb.title = granted ? 'إشعارات المتصفح مُفعّلة' : 'تفعيل إشعارات المتصفح';
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
  { key: 'telegram', label: TG_ICON + ' تيليجرام' },
];
const REMINDER_OFFSETS = [
  { key: 'morning', label: 'موعد المهمة' },
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
  el.textContent = (window.tr ? tr(msg) : msg);
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
    case 'overdue': return t.isOverdue || t.isUndated; // المهام بلا موعد تُعدّ متأخرة دوماً
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
  if (state.linked.length) list = list.filter((t) => (t.linkedList || []).some((p) => state.linked.includes(p)));
  if (state.priorities.length) list = list.filter((t) => state.priorities.includes(t.priority));
  if (state.statuses.length) list = list.filter((t) => state.statuses.includes(t.status));
  if (state.types.length) list = list.filter((t) => state.types.includes(t.type || '__none__'));
  if (state.search) {
    const q = state.search.trim();
    list = list.filter((t) => [t.project, t.dept, t.file, t.owner, t.linkedTo, t.deliverable, t.notes, t.followup].join(' ').includes(q));
  }
  return list;
}

// هل المهمة الشهرية تقع اليوم؟ (نقارن «يوم N» في نصّ الدورية بيوم الشهر الحالي)
function monthlyToday(t) {
  const m = String(t.recurrence || '').match(/(\d{1,2})/);
  return m ? Number(m[1]) === new Date().getDate() : false;
}
// رتبة الموعد عند الفرز التصاعدي:
// 0 بلا موعد · 1 شهري اليوم · 2 أسبوعي/يوم محدّد اليوم · 3 يومي · 4 دورية أخرى · 5 تواريخ محدّدة
function deadlineRank(t) {
  if (t.isUndated) return 0;
  if (t.isRecurring) {
    const k = t.recurrenceKind;
    if (k === 'monthly') return monthlyToday(t) ? 1 : 4;
    if (k === 'weekday') return t.isToday ? 2 : 4;
    if (k === 'weekly') return 2;
    if (k === 'daily') return 3;
    return 4;
  }
  return 5;
}

function sortList(list) {
  const dir = state.sortDir === 'asc' ? 1 : -1;
  const key = state.sortKey;
  if (key === 'deadline') {
    return [...list].sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1; // المنجزة دائماً في الأسفل
      const ra = deadlineRank(a), rb = deadlineRank(b);
      if (ra !== rb) return (ra - rb) * dir;
      const x = a.deadlineIso || '', y = b.deadlineIso || ''; // ضمن نفس الرتبة: حسب التاريخ
      if (x !== y) return (x < y ? -1 : 1) * dir;
      return 0;
    });
  }
  if (key === 'created') {
    // المهام بلا تاريخ إنشاء تبقى في الأسفل دائماً (في الاتجاهين)
    return [...list].sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      const x = a.createdIso, y = b.createdIso;
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }
  const val = (t) => {
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
// المخرجات: كتل مفصولة بسطر فارغ؛ المخرج المنجَز يبدأ بـ«✓»
// المخرجات: كتل نصّية، والتخصيص كتل متوازية في «assignees» («-» = بلا تخصيص)
function dvRealVal(v) { const s = String(v == null ? '' : v).trim(); return (s && s !== '-' && s !== '—' && s !== '----------') ? s : ''; }
// تطبيع تاريخ (ISO أو D/M/YYYY) إلى YYYY-MM-DD
function toIsoDateC(s) {
  const v = String(s == null ? '' : s).trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`; }
  return '';
}
function relFromDiffC(diff) { return diff == null ? '' : diff < 0 ? `متأخر ${Math.abs(diff)} يوم` : diff === 0 ? 'اليوم' : `بعد ${diff} يوم`; }
function parseDeliverables(raw, assigneesRaw, datesRaw) {
  const aB = fuBlocks(assigneesRaw || '');
  const tB = fuBlocks(datesRaw || '');
  return fuBlocks(raw).map((b, i) => {
    const dateRaw = dvRealVal(tB[i]); const dateIso = toIsoDateC(dateRaw);
    return { idx: i, done: /^✓/.test(b), text: b.replace(/^✓\s*/, ''), assignee: dvRealVal(aB[i]), dateRaw, dateIso, diffDays: dateIso ? dayDiffIso(dateIso, todayISO()) : null };
  });
}
// عناصر المخرجات: نفضّل المصفوفة المحسوبة خادمياً (تتضمّن تصنيف الموعد)، وإلا نحلّلها محلياً
function delivItems(t) { return Array.isArray(t.deliverables) && t.deliverables.length ? t.deliverables : parseDeliverables(t.deliverable, t.assignees, t.dvdates); }
// شارة موعد المخرَج (لونها حسب القرب)
function dvWhenChip(e) {
  if (!e.dateRaw) return '';
  const cls = (e.diffDays != null && e.diffDays <= 0) ? 'dvw-over' : (e.diffDays != null && e.diffDays <= 3) ? 'dvw-soon' : 'dvw-far';
  return `<span class="dv-when ${cls}">📅 ${esc(e.dateRaw)} · ${esc(relFromDiffC(e.diffDays))}</span>`;
}
// قائمة خيارات المستخدمين لاختيار المخصَّص
function userOpts(selected) {
  return (state.users || []).map((u) => `<option value="${esc(u.name)}" ${u.name === selected ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
}
// هل يحقّ للمستخدم الحالي التصرّف بهذا المخرَج؟ (مخصَّص ⇒ المخصَّص أو المدير فقط؛ غير مخصَّص ⇒ أي محرّر)
function canActDeliv(e) {
  if (!canEdit()) return false;
  if (isAdmin()) return true;
  if (!e.assignee) return true;
  return String((state.me && state.me.name) || '').trim() === e.assignee.trim();
}
function dvWhoChip(e) {
  return e.assignee ? `<span class="dv-who" title="مخصَّص لـ ${esc(e.assignee)}">👤 ${esc(e.assignee)}</span>` : '';
}
function dvChip(t, e) {
  const allowed = canActDeliv(e);
  return `<div class="dv-toggle ${e.done ? 'done' : ''}${allowed ? '' : ' locked'}" data-id="${t.id}" data-idx="${e.idx}" title="${allowed ? (e.done ? 'إلغاء التأشير' : 'تأشير كمنجز') : 'مخصَّص لمستخدم آخر'}"><span class="dv-check"></span><span class="dv-txt">${esc(e.text)}${dvWhoChip(e)}${dvWhenChip(e)}</span></div>`;
}
function rowExpanded(t) { return state.expanded || state.expandedRows.has(t.id); }
function deliverableCell(t) {
  const items = delivItems(t);
  if (!items.length) return '<span style="color:var(--muted)">—</span>';
  if (rowExpanded(t)) return `<div class="dv-list">${items.map((e) => dvChip(t, e)).join('')}</div>`;
  const more = items.length > 1 ? `<span class="fu-more row-expand" data-id="${t.id}" style="margin-top:4px;display:inline-block;cursor:pointer">+${items.length - 1}</span>` : '';
  return `<div class="dv-list">${dvChip(t, items[0])}${more}</div>`;
}
async function toggleDelivApi(id, idx) {
  const res = await fetch(`/api/tasks/${id}/deliverable/${idx}/toggle`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
}
async function toggleDeliv(id, idx) {
  try { await toggleDelivApi(id, idx); render(); }
  catch (e) { toast('تعذّر: ' + e.message, true); load(true); }
}
function bindDvToggles(scope) {
  scope.querySelectorAll('.dv-toggle').forEach((el) => el.onclick = (e) => {
    e.stopPropagation();
    const id = Number(el.dataset.id), idx = Number(el.dataset.idx);
    const t = state.tasks.find((x) => x.id === id);
    const ev = t ? delivItems(t).find((x) => x.idx === idx) : null;
    if (!ev) return;
    if (canActDeliv(ev)) toggleDeliv(id, idx);
    else if (canEdit()) toast('هذا المخرج مخصَّص لمستخدم آخر', true);
  });
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
  if (rowExpanded(t)) return `<div class="fu-cell-full">${evs.slice().reverse().map(fuMini).join('')}</div>`;
  const last = evs[evs.length - 1];
  const more = evs.length > 1 ? `<span class="fu-more row-expand" data-id="${t.id}" style="cursor:pointer">+${evs.length - 1}</span>` : '';
  const meta = last.manual
    ? `<div class="fu-meta"><span class="fu-leg">متابعة</span>${more}</div>`
    : `<div class="fu-meta"><b>${esc(last.author)}</b> · ${esc(fuShort(last.date, last.time))} ${more}</div>`;
  const txt = (last.text || '');
  return `<div class="fu-cell">${meta}<div class="fu-text">${esc(txt.slice(0, 90))}${txt.length > 90 ? '…' : ''}</div></div>`;
}
function followupSection(t) {
  const evs = parseFollowup(t.followup, t.log).slice().reverse(); // الأحدث أولاً
  // ✏️ تعديل السجل لأي مستخدم (تاريخ/وقت)؛ 🗑 حذف للمحرّر/المدير فقط
  const acts = (e) => {
    const edit = canEditLog() ? `<button class="fu-ico fu-ed" type="button" data-idx="${e.idx}" title="تعديل">✏️</button>` : '';
    const del = canEdit() ? `<button class="fu-ico fu-del" type="button" data-idx="${e.idx}" title="حذف">🗑</button>` : '';
    return (edit || del) ? `<span class="fu-acts">${edit}${del}</span>` : '';
  };
  const items = evs.length ? evs.map((e) => `
    <div class="fu-item ${e.manual ? 'plain' : ''}" data-idx="${e.idx}">
      <div class="fu-ihead">${e.manual ? '<span class="fu-leg">متابعة (يدوي)</span>' : `${fuAvatar(e.author)}<span class="fu-au">${esc(e.author)}</span><span class="fu-tm">${esc(e.date || '')} ${esc(e.time || '')}</span>`}${acts(e)}</div>
      <div class="fu-ibody">${esc(e.text)}</div></div>`).join('') : '<div class="fu-empty">لا توجد متابعة بعد.</div>';
  const add = canEdit() ? `
    <div class="fu-add">
      <textarea id="fuInput" rows="2" placeholder="أضف تحديث متابعة جديد… (يُسجَّل باسمك ووقته تلقائياً)"></textarea>
      <button class="btn btn-save" id="fuAdd" type="button">➕ إضافة حدث</button>
    </div>` : '';
  return `<div id="fuSection" class="field"><label>سجلّ المتابعة اليومية</label><div class="fu-log">${items}</div>${add}</div>`;
}
function bindFollowup(t) {
  const fuAdd = $('fuAdd');
  if (fuAdd) fuAdd.onclick = () => addFollowup(t.id);
  const sec = $('fuSection'); if (!sec) return;
  sec.querySelectorAll('.fu-ed').forEach((b) => b.onclick = () => startEditEvent(t.id, Number(b.dataset.idx), b));
  sec.querySelectorAll('.fu-del').forEach((b) => b.onclick = () => deleteEvent(t.id, Number(b.dataset.idx)));
}
function refreshFollowup(id) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const el = $('fuSection'); if (el) { el.outerHTML = followupSection(t); bindFollowup(t); }
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
    refreshFollowup(id);
    render();
  } catch (e) {
    toast('تعذّر: ' + e.message, true);
    if (btn) { btn.disabled = false; btn.textContent = '➕ إضافة حدث'; }
  }
}
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function nowHM() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function startEditEvent(id, idx, btn) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const ev = parseFollowup(t.followup, t.log).find((e) => e.idx === idx) || { text: '' };
  const me = (state.me && state.me.firstName) ? state.me.firstName : '';
  const date = ev.date || todayISO();
  const time = ev.time || nowHM();
  const author = ev.author || me;
  const authorRO = isAdmin() ? '' : 'disabled';
  const hint = !isAdmin() ? '<div class="fu-logedit-hint">اسم المستخدم في السجل يعدّله المدير فقط.</div>' : '';
  const item = btn.closest('.fu-item');
  const body = item.querySelector('.fu-ibody');
  body.innerHTML = `<textarea class="fu-eta" rows="2"></textarea>
    <div class="fu-logedit">
      <span class="fu-logedit-lbl">السجل:</span>
      <input type="date" class="fe-date" value="${esc(date)}">
      <input type="time" class="fe-time" value="${esc(time)}">
      <input type="text" class="fe-author" value="${esc(author)}" placeholder="الاسم" ${authorRO}>
    </div>${hint}
    <div class="fu-eacts"><button class="btn btn-save fu-savebtn" type="button">حفظ</button><button class="btn btn-cancel fu-cancelbtn" type="button">إلغاء</button></div>`;
  const ta = body.querySelector('.fu-eta');
  ta.value = ev.text; ta.focus();
  body.querySelector('.fu-savebtn').onclick = () => saveEvent(id, idx, {
    text: ta.value.trim(),
    date: body.querySelector('.fe-date').value,
    time: body.querySelector('.fe-time').value,
    author: body.querySelector('.fe-author').value.trim(),
  });
  body.querySelector('.fu-cancelbtn').onclick = () => refreshFollowup(id);
}
async function saveEvent(id, idx, payload) {
  if (!payload.text) { toast('نصّ الحدث فارغ', true); return; }
  try {
    const res = await fetch(`/api/tasks/${id}/followup/${idx}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم تعديل الحدث ✓'); refreshFollowup(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
async function deleteEvent(id, idx) {
  if (!confirm('حذف هذا الحدث وسجلّه نهائياً؟')) return;
  try {
    const res = await fetch(`/api/tasks/${id}/followup/${idx}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم حذف الحدث ✓'); refreshFollowup(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
// فرق الأيام بين تاريخَي ISO (a − b)
function dayDiffIso(aIso, bIso) {
  const [ay, am, ad] = aIso.split('-').map(Number);
  const [by, bm, bd] = bIso.split('-').map(Number);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86400000);
}
function relText(t) {
  // المهام المنجزة: يتجمّد التعليق على لحظة الإنجاز (الفرق بين الموعد وتاريخ الإنجاز)، فلا يتغيّر يومياً
  if (t.isDone && t.completedIso && t.deadlineIso) {
    const late = dayDiffIso(t.completedIso, t.deadlineIso); // تاريخ الإنجاز − الموعد
    if (late > 0) return `أُنجزت متأخرة ${late} يوم`;
    if (late === 0) return 'أُنجزت في الموعد';
    return `أُنجزت قبل ${Math.abs(late)} يوم`;
  }
  if (t.diffDays == null) return t.recurrence ? 'دورية' : 'بلا موعد';
  if (t.diffDays < 0) return `متأخرة ${Math.abs(t.diffDays)} يوم`;
  if (t.diffDays === 0) return 'اليوم';
  if (t.diffDays === 1) return 'غداً';
  return `بعد ${t.diffDays} يوم`;
}

// ===== KPIs / chips / filters =====
function syncViewTabs() {
  document.querySelectorAll('[data-shape]').forEach((x) => x.classList.toggle('active', x.dataset.shape === state.shape));
  document.querySelectorAll('[data-data]').forEach((x) => x.classList.toggle('active', x.dataset.data === state.dataType));
}

function renderKpis() {
  const s = state.summary;
  const byType = s.byType || {};
  const meet = s.meetings || { total: 0, scheduled: 0, unscheduled: 0 };

  // البطاقات: نُبقي «إجمالي المهام» و«نسبة الإنجاز» فقط (البقية متوفّرة كشرائح فوق الفلاتر)
  const cards = [
    { kind: 'time', key: 'all', cls: '', num: s.total, lbl: tr('إجمالي المهام') },
    { kind: 'time', key: '_done', cls: 'green', num: (s.completion || 0) + '%', lbl: tr('نسبة الإنجاز') },
  ];

  // بطاقة لكل نوع (المعروفة أولاً ثم أي نوع آخر موجود)
  const presentTypes = [
    ...TYPES.filter((t) => byType[t]),
    ...Object.keys(byType).filter((k) => k && !TYPES.includes(k)),
  ];
  presentTypes.forEach((t) => cards.push({ kind: 'type', key: t, cls: 'kpi-type', num: byType[t] || 0, lbl: `${TYPE_ICON[t] || '🏷️'} ${t}` }));
  if (byType['']) cards.push({ kind: 'type', key: '__none__', cls: 'kpi-type', num: byType[''], lbl: '🏷️ ' + tr('بلا نوع') });

  // بطاقة الاجتماعات (التركيز على غير المجدولة)
  if (meet.total) cards.push({ kind: 'meet', key: 'meetings', cls: 'kpi-meet', num: meet.required, lbl: tr('🤝 اجتماعات مطلوبة') });

  const isActive = (c) =>
    (c.kind === 'time' && state.dataType !== 'meetings' && state.time === c.key) ||
    (c.kind === 'type' && state.types.includes(c.key)) ||
    (c.kind === 'meet' && state.dataType === 'meetings');

  $('kpis').innerHTML = cards.map((c) => `
    <div class="kpi ${c.cls || ''} ${isActive(c) ? 'active' : ''}" data-kind="${c.kind}" data-key="${esc(c.key)}">
      <div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`).join('');

  $('kpis').querySelectorAll('.kpi').forEach((el) => {
    el.onclick = () => {
      const { kind, key } = el.dataset;
      if (kind === 'time') { if (key === '_done') return; if (state.dataType === 'meetings') state.dataType = 'tasks'; state.time = state.time === key ? 'all' : key; }
      else if (kind === 'type') { if (state.dataType === 'meetings') state.dataType = 'tasks'; const i = state.types.indexOf(key); if (i > -1) state.types.splice(i, 1); else state.types.push(key); }
      else if (kind === 'meet') { state.dataType = 'meetings'; state.meetingFilter = 'required'; }
      render();
    };
  });
}
function renderChips() {
  $('timeChips').innerHTML = TIME_CHIPS.map((c) =>
    `<button class="chip ${state.time === c.key ? 'active' : ''}" data-time="${c.key}">${tr(c.label)}<span class="c">${countForTime(c.key)}</span></button>`).join('');
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
  const label = sel.length === 0 ? tr('كل ' + all) : (sel.length === 1 ? (sel[0] === '__none__' ? tr('بلا نوع') : sel[0]) : `${sel.length} ${tr('مختار')}`);
  el.innerHTML =
    `<button type="button" class="ms-btn ${sel.length ? 'has' : ''}"><span class="ms-lbl">${esc(label)}</span><span class="ms-ar">▾</span></button>
     <div class="ms-panel">${values.length ? values.map((v) => `<label class="ms-opt"><input type="checkbox" value="${esc(v.value)}" ${sel.includes(v.value) ? 'checked' : ''}><span>${esc(v.value === '__none__' ? tr('بلا نوع') : v.label)}</span></label>`).join('') : `<div class="ms-empty">${tr('لا خيارات')}</div>`}</div>`;
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
  buildMS('msLinked', 'linked', opts(state.filters.linked));
  buildMS('msPriority', 'priorities', opts(state.filters.priorities));
  buildMS('msStatus', 'statuses', opts(state.filters.statuses));
  const typeVals = opts(state.filters.types);
  if (state.summary && state.summary.byType && state.summary.byType['']) typeVals.push({ value: '__none__', label: 'بلا نوع' });
  buildMS('msType', 'types', typeVals);
}

// ===== Table view =====
// مجموعة كل المسؤولين المعنيين في كامل التطبيق (لتمييز بطاقات «مرتبط بـ» المطابِقة لأحدهم)
function allOwnersSet() {
  return new Set((state.filters.owners || []).map((o) => o.trim()).filter(Boolean));
}
// خانة المسؤول المعني + بطاقة لكل شخص في «مرتبط بـ» أسفلها
// (البطاقة التي يطابق محتواها أحد المسؤولين المعنيين في كامل الرابط تأخذ لوناً داكناً مميّزاً)
function ownerCell(t) {
  const owners = allOwnersSet();
  const cards = (t.linkedList || []).map((p) => {
    const isOwner = owners.has(p.trim());
    return `<div class="linked-card${isOwner ? ' is-owner' : ''}">🔗 ${esc(p)}</div>`;
  }).join('');
  return `${esc(t.owner)}${cards ? `<div class="linked-cards">${cards}</div>` : ''}`;
}
function deadlineCellHtml(t) {
  const dlCls = t.isOverdue ? 'overdue' : t.isSoon3 ? 'soon' : '';
  const dl = t.deadlineIso || (t.deadlineRaw ? esc(t.deadlineRaw) : '—');
  return `<div class="deadline-cell ${dlCls}"><span class="iso">${dl}</span><span class="rel">${relText(t)}</span></div>`;
}
// كل أعمدة الجدول المتاحة (مفتاح + عنوان + فرز + مُصيِّر)
const TABLE_COLS = [
  { k: 'num', label: 'م', r: (t) => esc(t.num) },
  { k: 'project', label: 'المشروع', sort: 'project', r: (t) => esc(t.project) },
  { k: 'file', label: 'الملف', sort: 'file', r: (t) => esc(t.file) },
  { k: 'type', label: 'النوع', sort: 'type', r: (t) => typeCell(t.type) },
  { k: 'owner', label: 'المسؤول المعني', sort: 'owner', cls: 'cell-owner', r: ownerCell },
  { k: 'deliverable', label: 'المخرج المطلوب', cls: 'fu-col', r: deliverableCell },
  { k: 'deadline', label: 'الموعد', sort: 'deadline', r: deadlineCellHtml },
  { k: 'priority', label: 'الأولوية', sort: 'priority', r: (t) => `<span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span>` },
  { k: 'status', label: 'الحالة', sort: 'status', r: (t) => `<span class="badge st ${stClass(t.status)}">${esc(t.status)}</span>` },
  { k: 'followup', label: 'المتابعة', cls: 'fu-col', r: followupCell },
  { k: 'created', label: 'تاريخ الإنشاء', sort: 'created', r: (t) => esc(t.created || '—') },
  { k: 'notes', label: 'ملاحظات', r: (t) => esc(t.notes) },
];
const DEFAULT_TABLE_COLS = ['project', 'file', 'type', 'owner', 'deliverable', 'deadline', 'status', 'followup', 'created', 'notes'];
function activeTableCols() {
  const sel = (state.tableCols && state.tableCols.length) ? state.tableCols : DEFAULT_TABLE_COLS;
  return TABLE_COLS.filter((c) => sel.includes(c.k));
}

// ===== أعمدة جدول الاجتماعات (مُصيِّراتها تأخذ السياق {t, m, idx}) =====
const MEETING_COLS = [
  { k: 'meetingName', label: 'اسم الاجتماع', r: ({ m }) => `<span class="mtg-name-cell">🤝 ${esc(m.title)}</span>` },
  { k: 'project', label: 'المشروع', r: ({ t }) => esc(t.project) },
  { k: 'file', label: 'الملف', r: ({ t }) => esc(t.file) },
  { k: 'type', label: 'النوع', r: ({ t }) => typeCell(t.type) },
  { k: 'owner', label: 'المسؤول', cls: 'cell-owner', r: ({ t }) => esc(t.owner) },
  { k: 'priority', label: 'الأولوية', r: ({ t }) => `<span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span>` },
  { k: 'mtgdate', label: 'موعد الاجتماع', r: ({ m }) => m.status === 'scheduled' && m.datetime ? `<span class="iso">${esc(m.datetime)}</span>` : '<span style="color:var(--muted)">—</span>' },
  { k: 'deadline', label: 'موعد المهمة', r: ({ t }) => { const dl = t.deadlineIso || (t.deadlineRaw ? esc(t.deadlineRaw) : '—'); return `<div class="deadline-cell"><span class="iso">${dl}</span><span class="rel">${relText(t)}</span></div>`; } },
  { k: 'status', label: 'حالة الاجتماع', r: ({ m }) => meetingStatusBadge(m) },
];
const DEFAULT_MEETING_COLS = ['meetingName', 'project', 'file', 'owner', 'mtgdate', 'status'];
// شارة حالة الاجتماع (مطلوب/مجدول+تاريخ/تم)
function meetingStatusBadge(m) {
  const lbl = MEETING_STATUS[m.status] || 'مطلوب';
  const cls = MEETING_STATUS_CLS[m.status] || 'mt-unsched';
  const dt = (m.status === 'scheduled' && m.datetime) ? ` <span class="mt-dt">${esc(m.datetime)}</span>` : '';
  return `<span class="badge ${cls}">${tr(lbl)}</span>${dt}`;
}
function activeMeetingCols() {
  const sel = (state.meetingCols && state.meetingCols.length) ? state.meetingCols : DEFAULT_MEETING_COLS;
  return MEETING_COLS.filter((c) => sel.includes(c.k));
}

// لوحة «⚙ الأعمدة» — تتكيّف حسب العرض الحالي (جدول المهام أو جدول الاجتماعات)
function buildColsPanel() {
  const el = $('colsPanel'); if (!el) return;
  const meetings = state.dataType === 'meetings';
  const COLS = meetings ? MEETING_COLS : TABLE_COLS;
  const sel = meetings ? state.meetingCols : state.tableCols;
  const lsKey = meetings ? 'eo_meetingcols' : 'eo_tablecols_v2';
  el.innerHTML = COLS.map((c) => `<label class="ms-opt"><input type="checkbox" value="${c.k}" ${sel.includes(c.k) ? 'checked' : ''}><span>${esc(c.label)}</span></label>`).join('');
  el.querySelectorAll('input').forEach((inp) => inp.onchange = () => {
    const i = sel.indexOf(inp.value);
    if (inp.checked && i === -1) sel.push(inp.value);
    else if (!inp.checked && i > -1) sel.splice(i, 1);
    localStorage.setItem(lsKey, JSON.stringify(sel));
    render();
  });
}

function renderTable() {
  const list = sortList(applyFilters());
  $('countLine').textContent = `عرض ${list.length} من ${state.tasks.length} مهمة`;
  if (!list.length) { $('viewArea').innerHTML = '<div class="table-wrap"><div class="empty">لا توجد مهام مطابقة للفلاتر.</div></div>'; return; }
  const arrow = (k) => state.sortKey === k ? `<span class="arrow">${state.sortDir === 'asc' ? '▲' : '▼'}</span>` : '';
  const cols = activeTableCols();
  const wStyle = (k) => state.colWidths[k] ? ` style="width:${state.colWidths[k]}px"` : '';
  const ths = cols.map((c) => `<th data-k="${c.k}"${c.sort ? ` data-sort="${c.sort}"` : ''}${wStyle(c.k)}><span class="th-lbl">${tr(c.label)} ${c.sort ? arrow(c.sort) : ''}</span><span class="col-resizer" data-k="${c.k}"></span></th>`).join('');
  // زر توسيع/طيّ الصف الفردي (في الوضع المضغوط) — متاح لكل المهام
  const rows = list.map((t) => {
    const exp = state.expandedRows.has(t.id);
    const rowCls = (t.isDone ? 'row-done' : t.isOverdue ? 'row-overdue' : t.isSoon3 ? 'row-soon' : '') + (exp && !state.expanded ? ' row-exp' : '');
    const tds = cols.map((c, ci) => {
      const toggle = (ci === 0 && !state.expanded)
        ? `<button class="row-toggle" data-id="${t.id}" title="${exp ? 'طيّ' : 'توسيع'}">${exp ? '▴' : '▾'}</button>` : '';
      return `<td class="${c.cls || ''}${ci === 0 ? ' rt-cell' : ''}">${c.r(t)}${toggle}</td>`;
    }).join('');
    return `<tr class="${rowCls}" data-id="${t.id}">${tds}</tr>`;
  }).join('');
  $('viewArea').innerHTML = `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table></div>`;
  $('viewArea').querySelectorAll('th[data-sort]').forEach((th) => {
    th.querySelector('.th-lbl').onclick = () => { const k = th.dataset.sort; if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = k; state.sortDir = 'asc'; } renderTable(); };
  });
  bindColResizers($('viewArea'));
  $('viewArea').querySelectorAll('tbody tr').forEach((tr) => { tr.onclick = () => openModal(Number(tr.dataset.id)); });
  $('viewArea').querySelectorAll('.row-toggle, .row-expand').forEach((el) => el.onclick = (e) => { e.stopPropagation(); toggleRow(Number(el.dataset.id)); });
  bindDvToggles($('viewArea'));
}

function toggleRow(id) {
  if (state.expandedRows.has(id)) state.expandedRows.delete(id); else state.expandedRows.add(id);
  renderTable();
}

// سحب حدّ العمود لتغيير عرضه (RTL)، ويُحفظ في localStorage لكل مستخدم
function bindColResizers(scope) {
  scope.querySelectorAll('.col-resizer').forEach((r) => {
    r.onclick = (e) => e.stopPropagation();
    r.onmousedown = (e) => {
      e.preventDefault(); e.stopPropagation();
      const th = r.closest('th'); const k = r.dataset.k;
      const startX = e.clientX; const startW = th.offsetWidth;
      const move = (ev) => { const w = Math.max(50, startW + (startX - ev.clientX)); th.style.width = w + 'px'; };
      const up = () => {
        document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        state.colWidths[k] = th.offsetWidth;
        try { localStorage.setItem('eo_colwidths', JSON.stringify(state.colWidths)); } catch { /* تجاهل */ }
      };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    };
  });
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
      return `<div class="cal-task ${cls}" data-id="${t.id}" title="${esc(t.deliverable)}"><span class="cal-p">${esc(t.project)}</span>${t.file ? `<span class="cal-f">${esc(t.file)}</span>` : ''}</div>`;
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
  const items = delivItems(t);
  const ed = canEdit();
  const acts = (e) => {
    if (!ed) return '';
    if (!canActDeliv(e)) return '<span class="fu-acts dv-locked" title="مخصَّص لمستخدم آخر">🔒</span>';
    return `<span class="fu-acts"><button class="fu-ico dv-chk" type="button" data-idx="${e.idx}" title="${e.done ? 'إلغاء التأشير' : 'تأشير منجز'}">${e.done ? '☑' : '☐'}</button><button class="fu-ico dv-ed" type="button" data-idx="${e.idx}" title="تعديل">✏️</button><button class="fu-ico dv-del" type="button" data-idx="${e.idx}" title="حذف">🗑</button></span>`;
  };
  // تخصيص/إعادة تخصيص المخرَج محصور كذلك: غير المخصَّص يخصّصه أي محرّر، وبمجرد تخصيصه يعيد تخصيصه المخصَّص أو المدير فقط
  const assignRow = (e) => (ed && canActDeliv(e)) ? `<div class="dv-assign-row"><span>${tr('المخصَّص:')}</span><select class="dv-assign" data-idx="${e.idx}"><option value="">${tr('— بلا —')}</option>${userOpts(e.assignee)}</select></div>` : '';
  // صفّ موعد المخرَج: تاريخ اختياري يُدرِج المهمة في اللوحة/التذكير عند اقترابه دون التأثير على موعد المهمة العام
  const dateRow = (e) => (ed && canActDeliv(e))
    ? `<div class="dv-assign-row"><span>${tr('موعد المخرج:')}</span><input type="date" class="dv-date" data-idx="${e.idx}" value="${esc(e.dateIso || '')}">${e.dateRaw ? `<button class="fu-ico dv-date-clr" data-idx="${e.idx}" type="button" title="إزالة الموعد">✕</button>` : ''}</div>`
    : '';
  const list = items.length ? items.map((e) => `
    <div class="fu-item plain ${e.done ? 'dv-done' : ''}" data-idx="${e.idx}">
      <div class="fu-ihead"><span class="dv-num">${tr('مخرج')} ${e.idx + 1}</span>${dvWhoChip(e)}${dvWhenChip(e)}${acts(e)}</div>
      <div class="fu-ibody">${esc(e.text)}</div>${assignRow(e)}${dateRow(e)}</div>`).join('') : `<div class="fu-empty">${tr('لا توجد مخرجات بعد.')}</div>`;
  const add = ed ? `<div class="fu-add"><textarea id="dvInput" rows="2" placeholder="${tr('أضف مخرجاً مطلوباً جديداً…')}"></textarea><button class="btn btn-save" id="dvAdd" type="button">${tr('➕ إضافة مخرج')}</button></div>` : '';
  return `<div id="dvSection" class="field"><label>${tr('المخرجات المطلوبة')}</label><div class="fu-log">${list}</div>${add}</div>`;
}
async function setDelivDate(id, idx, date) {
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable/${idx}/date`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }) });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast(date ? 'تم ضبط موعد المخرج ✓' : 'تم إزالة موعد المخرج ✓');
    refreshDeliverable(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
async function setDelivAssignee(id, idx, assignee) {
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable/${idx}/assignee`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assignee }) });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast(assignee ? `تم تخصيص المخرج لـ ${assignee} ✓` : 'تم إلغاء تخصيص المخرج ✓');
    refreshDeliverable(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
function bindDeliverable(t) {
  const dvAdd = $('dvAdd');
  if (dvAdd) dvAdd.onclick = () => addDeliverable(t.id);
  const sec = $('dvSection'); if (!sec) return;
  sec.querySelectorAll('.dv-chk').forEach((b) => b.onclick = async () => { try { await toggleDelivApi(t.id, Number(b.dataset.idx)); refreshDeliverable(t.id); render(); } catch (e) { toast('تعذّر: ' + e.message, true); } });
  sec.querySelectorAll('.dv-ed').forEach((b) => b.onclick = () => startEditDeliv(t.id, Number(b.dataset.idx), b));
  sec.querySelectorAll('.dv-del').forEach((b) => b.onclick = () => deleteDeliv(t.id, Number(b.dataset.idx)));
  sec.querySelectorAll('.dv-assign').forEach((s) => s.onchange = () => setDelivAssignee(t.id, Number(s.dataset.idx), s.value));
  sec.querySelectorAll('.dv-date').forEach((d) => d.onchange = () => setDelivDate(t.id, Number(d.dataset.idx), d.value));
  sec.querySelectorAll('.dv-date-clr').forEach((b) => b.onclick = () => setDelivDate(t.id, Number(b.dataset.idx), ''));
}
function refreshDeliverable(id) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const el = $('dvSection'); if (el) { el.outerHTML = deliverableSection(t); bindDeliverable(t); }
}
async function addDeliverable(id) {
  const inp = $('dvInput'); const text = inp ? inp.value.trim() : '';
  if (!text) { toast('اكتب نصّ المخرج أولاً', true); return; }
  const btn = $('dvAdd'); if (btn) { btn.disabled = true; btn.textContent = '... إضافة'; }
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تمت إضافة المخرج ✓'); refreshDeliverable(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); if (btn) { btn.disabled = false; btn.textContent = '➕ إضافة مخرج'; } }
}
function startEditDeliv(id, idx, btn) {
  const body = btn.closest('.fu-item').querySelector('.fu-ibody'); const cur = body.textContent;
  body.innerHTML = `<textarea class="fu-eta" rows="3"></textarea><div class="fu-eacts"><button class="btn btn-save dv-savebtn" type="button">حفظ</button><button class="btn btn-cancel dv-cancelbtn" type="button">إلغاء</button></div>`;
  const ta = body.querySelector('.fu-eta'); ta.value = cur; ta.focus();
  body.querySelector('.dv-savebtn').onclick = () => saveDeliv(id, idx, ta.value.trim());
  body.querySelector('.dv-cancelbtn').onclick = () => refreshDeliverable(id);
}
async function saveDeliv(id, idx, text) {
  if (!text) { toast('نصّ المخرج فارغ', true); return; }
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable/${idx}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم تعديل المخرج ✓'); refreshDeliverable(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}
async function deleteDeliv(id, idx) {
  if (!confirm('حذف هذا المخرج؟')) return;
  try {
    const res = await fetch(`/api/tasks/${id}/deliverable/${idx}`, { method: 'DELETE' });
    const data = await res.json(); if (!data.ok) throw new Error(data.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, data.task);
    toast('تم حذف المخرج ✓'); refreshDeliverable(id); render();
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}

// ===== أقسام محلية للمهمة الجديدة (تُجمَع في الذاكرة ثم تُرسَل عند الحفظ) =====
// عناصر state.newDv كائنات { text, assignee, date } لدعم تخصيص المخرجات وموعدها قبل حفظ المهمة الجديدة
function localDeliverableSection() {
  const list = state.newDv.length ? state.newDv.map((b, i) => `
    <div class="fu-item plain" data-idx="${i}">
      <div class="fu-ihead"><span class="dv-num">مخرج ${i + 1}</span>${b.assignee ? `<span class="dv-who">👤 ${esc(b.assignee)}</span>` : ''}${b.date ? `<span class="dv-when dvw-soon">📅 ${esc(b.date)}</span>` : ''}<span class="fu-acts"><button class="fu-ico ldv-ed" type="button" data-idx="${i}">✏️</button><button class="fu-ico ldv-del" type="button" data-idx="${i}">🗑</button></span></div>
      <div class="fu-ibody">${esc(b.text)}</div>
      <div class="dv-assign-row"><span>المخصَّص:</span><select class="ldv-assign" data-idx="${i}"><option value="">— بلا —</option>${userOpts(b.assignee)}</select></div>
      <div class="dv-assign-row"><span>موعد المخرج:</span><input type="date" class="ldv-date" data-idx="${i}" value="${esc(b.date || '')}"></div></div>`).join('') : '<div class="fu-empty">لا توجد مخرجات بعد.</div>';
  return `<div id="ldvSection" class="field"><label>المخرجات المطلوبة</label><div class="fu-log">${list}</div>
    <div class="fu-add"><textarea id="ldvInput" rows="2" placeholder="أضف مخرجاً مطلوباً…"></textarea><button class="btn btn-save" id="ldvAdd" type="button">➕ إضافة مخرج</button></div></div>`;
}
function refreshLocalDv() { const el = $('ldvSection'); if (el) { el.outerHTML = localDeliverableSection(); bindLocalDeliverable(); } }
function bindLocalDeliverable() {
  const a = $('ldvAdd');
  if (a) a.onclick = () => { const v = $('ldvInput').value.trim().replace(/\n\s*\n+/g, '\n'); if (!v) { toast('اكتب نصّ المخرج', true); return; } state.newDv.push({ text: v, assignee: '', date: '' }); refreshLocalDv(); };
  $('ldvSection').querySelectorAll('.ldv-del').forEach((b) => b.onclick = () => { state.newDv.splice(Number(b.dataset.idx), 1); refreshLocalDv(); });
  $('ldvSection').querySelectorAll('.ldv-assign').forEach((s) => s.onchange = () => { if (state.newDv[Number(s.dataset.idx)]) state.newDv[Number(s.dataset.idx)].assignee = s.value; refreshLocalDv(); });
  $('ldvSection').querySelectorAll('.ldv-date').forEach((d) => d.onchange = () => { if (state.newDv[Number(d.dataset.idx)]) state.newDv[Number(d.dataset.idx)].date = d.value; });
  $('ldvSection').querySelectorAll('.ldv-ed').forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.idx), body = b.closest('.fu-item').querySelector('.fu-ibody'), cur = body.textContent;
    body.innerHTML = `<textarea class="fu-eta" rows="3"></textarea><div class="fu-eacts"><button class="btn btn-save" type="button" id="ldvS">حفظ</button><button class="btn btn-cancel" type="button" id="ldvC">إلغاء</button></div>`;
    const ta = body.querySelector('.fu-eta'); ta.value = cur; ta.focus();
    $('ldvS').onclick = () => { const v = ta.value.trim().replace(/\n\s*\n+/g, '\n'); if (v && state.newDv[i]) { state.newDv[i].text = v; } refreshLocalDv(); };
    $('ldvC').onclick = () => refreshLocalDv();
  });
}
function localEventSection() {
  const me = (state.me && state.me.firstName) ? state.me.firstName : 'أنت';
  const list = state.newEv.length ? state.newEv.map((b, i) => `
    <div class="fu-item" data-idx="${i}">
      <div class="fu-ihead">${fuAvatar(me)}<span class="fu-au">${esc(me)}</span><span class="fu-tm">عند الحفظ</span><span class="fu-acts"><button class="fu-ico lev-ed" type="button" data-idx="${i}">✏️</button><button class="fu-ico lev-del" type="button" data-idx="${i}">🗑</button></span></div>
      <div class="fu-ibody">${esc(b)}</div></div>`).join('') : '<div class="fu-empty">لا أحداث بعد.</div>';
  return `<div id="levSection" class="field"><label>سجلّ المتابعة اليومية</label><div class="fu-log">${list}</div>
    <div class="fu-add"><textarea id="levInput" rows="2" placeholder="أضف حدث متابعة…"></textarea><button class="btn btn-save" id="levAdd" type="button">➕ إضافة حدث</button></div></div>`;
}
function refreshLocalEv() { const el = $('levSection'); if (el) { el.outerHTML = localEventSection(); bindLocalEvent(); } }
function bindLocalEvent() {
  const a = $('levAdd');
  if (a) a.onclick = () => { const v = $('levInput').value.replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim(); if (!v) { toast('اكتب نصّ الحدث', true); return; } state.newEv.push(v); refreshLocalEv(); };
  $('levSection').querySelectorAll('.lev-del').forEach((b) => b.onclick = () => { state.newEv.splice(Number(b.dataset.idx), 1); refreshLocalEv(); });
  $('levSection').querySelectorAll('.lev-ed').forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.idx), body = b.closest('.fu-item').querySelector('.fu-ibody'), cur = body.textContent;
    body.innerHTML = `<textarea class="fu-eta" rows="2"></textarea><div class="fu-eacts"><button class="btn btn-save" type="button" id="levS">حفظ</button><button class="btn btn-cancel" type="button" id="levC">إلغاء</button></div>`;
    const ta = body.querySelector('.fu-eta'); ta.value = cur; ta.focus();
    $('levS').onclick = () => { const v = ta.value.replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim(); if (v) { state.newEv[i] = v; } refreshLocalEv(); };
    $('levC').onclick = () => refreshLocalEv();
  });
}

// ===== «مرتبط بـ» (متعدّد) في نافذة الإضافة/التعديل =====
// المرشّحون = المسؤولون + المرتبطون الموجودون مسبقاً
function linkedCandidates() {
  return [...new Set([...(state.filters.owners || []), ...(state.filters.linked || [])])].sort((a, b) => a.localeCompare(b, 'ar'));
}
function linkedEditSection() {
  const chips = state.editLinked.length
    ? state.editLinked.map((p, i) => `<span class="rem-date">${esc(p)} <button type="button" class="elink-del" data-idx="${i}" aria-label="حذف">✕</button></span>`).join('')
    : '<span style="color:var(--muted);font-size:13px">لا يوجد (اختياري)</span>';
  const opts = linkedCandidates().filter((p) => !state.editLinked.includes(p)).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  return `<div id="elinkSection" class="field"><label>مرتبط بـ <span style="color:var(--muted);font-weight:400;font-size:11.5px">(اختياري — يمكن اختيار أكثر من شخص)</span></label>
    <div id="elinkChips" class="rem-dates" style="margin-bottom:8px">${chips}</div>
    <select id="elinkPick"><option value="">➕ اختر شخصاً لإضافته…</option>${opts}<option value="__new__">✎ اسم جديد…</option></select>
    <div class="rem-cal-row" id="elinkNewRow" style="display:none;margin-top:8px"><input id="elinkNewInput" type="text" placeholder="اكتب الاسم ثم اضغط أضف"><button class="btn btn-save" id="elinkNewAdd" type="button">أضف</button></div>
  </div>`;
}
function refreshLinked() { const el = $('elinkSection'); if (el) { el.outerHTML = linkedEditSection(); bindLinked(); } }
function addLinked(name) {
  const v = String(name || '').trim();
  if (!v) return;
  if (!state.editLinked.includes(v)) state.editLinked.push(v);
  refreshLinked();
}
function bindLinked() {
  const sec = $('elinkSection'); if (!sec) return;
  const sel = $('elinkPick');
  if (sel) sel.onchange = () => {
    const v = sel.value;
    if (v === '__new__') { const r = $('elinkNewRow'); if (r) r.style.display = ''; const ni = $('elinkNewInput'); if (ni) ni.focus(); sel.value = ''; }
    else if (v) addLinked(v);
  };
  const add = $('elinkNewAdd'); if (add) add.onclick = () => { const ni = $('elinkNewInput'); if (ni) addLinked(ni.value); };
  sec.querySelectorAll('.elink-del').forEach((b) => b.onclick = () => { state.editLinked.splice(Number(b.dataset.idx), 1); refreshLinked(); });
}

// ===== المسؤول المعني (متعدّد، من المستخدمين فقط — بلا إضافة جديد) =====
function ownerCandidates() {
  return [...new Set((state.users || []).map((u) => u.name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
}
function ownerEditSection() {
  const chips = state.editOwner.length
    ? state.editOwner.map((p, i) => `<span class="rem-date">${esc(p)} <button type="button" class="eowner-del" data-idx="${i}" aria-label="حذف">✕</button></span>`).join('')
    : '<span style="color:var(--muted);font-size:13px">لا أحد</span>';
  const opts = ownerCandidates().filter((p) => !state.editOwner.includes(p)).map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  return `<div id="eownerSection" class="field"><label>المسؤول المعني <span style="color:var(--muted);font-weight:400;font-size:11.5px">(من المستخدمين)</span></label>
    <div id="eownerChips" class="rem-dates" style="margin-bottom:8px">${chips}</div>
    <select id="eownerPick"><option value="">➕ اختر مستخدماً…</option>${opts}</select>
  </div>`;
}
function refreshOwner() { const el = $('eownerSection'); if (el) { el.outerHTML = ownerEditSection(); bindOwner(); } }
function addOwner(name) {
  const v = String(name || '').trim();
  if (!v) return;
  if (!state.editOwner.includes(v)) state.editOwner.push(v);
  refreshOwner();
}
function bindOwner() {
  const sec = $('eownerSection'); if (!sec) return;
  const sel = $('eownerPick');
  if (sel) sel.onchange = () => { if (sel.value) addOwner(sel.value); };
  sec.querySelectorAll('.eowner-del').forEach((b) => b.onclick = () => { state.editOwner.splice(Number(b.dataset.idx), 1); refreshOwner(); });
}
// جلب قائمة المستخدمين (لاختيار المسؤول المعني)
async function fetchUsers() {
  try { const d = await (await fetch('/api/users/list')).json(); state.users = d.ok ? (d.users || []) : []; }
  catch { state.users = []; }
}

// ===== الاجتماعات (متعدّدة، كل واحد بعنوان وحالة ثلاثية) في نافذة الإضافة/التعديل =====
// datetime داخلي «YYYY-MM-DD HH:MM» ⇄ قيمة input datetime-local «YYYY-MM-DDTHH:MM»
function dtToInput(dt) { return String(dt || '').replace(' ', 'T').slice(0, 16); }
function dtFromInput(v) { return String(v || '').replace('T', ' ').slice(0, 16); }
function meetingsEditSection() {
  const statusSel = (i, st) => `<select class="emtg-status" data-idx="${i}">${Object.entries(MEETING_STATUS).map(([k, l]) => `<option value="${k}" ${st === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const list = state.editMeetings.length ? state.editMeetings.map((m, i) => `
    <div class="fu-item plain" data-idx="${i}">
      <div class="fu-ihead"><span class="dv-num">اجتماع ${i + 1}</span>
        ${statusSel(i, m.status || 'required')}
        <input type="datetime-local" class="emtg-dt" data-idx="${i}" value="${esc(dtToInput(m.datetime))}" style="${(m.status === 'scheduled') ? '' : 'display:none'};max-width:185px">
        <span class="fu-acts"><button class="fu-ico emtg-ed" type="button" data-idx="${i}" title="تعديل العنوان">✏️</button><button class="fu-ico emtg-del" type="button" data-idx="${i}" title="حذف">🗑</button></span>
      </div>
      <div class="fu-ibody">${esc(m.title)}</div></div>`).join('') : '<div class="fu-empty">لا اجتماعات. أضف اجتماعاً ليظهر في عرض الاجتماعات.</div>';
  return `<div id="emtgSection" class="field"><label>🤝 الاجتماعات</label><div class="fu-log">${list}</div>
    <div class="fu-add"><input id="emtgInput" type="text" placeholder="عنوان الاجتماع…"><button class="btn btn-save" id="emtgAdd" type="button">➕ إضافة اجتماع</button></div></div>`;
}
function refreshMeetingsEdit() { const el = $('emtgSection'); if (el) { el.outerHTML = meetingsEditSection(); bindMeetingsEdit(); } }
function bindMeetingsEdit() {
  const sec = $('emtgSection'); if (!sec) return;
  const add = $('emtgAdd');
  if (add) add.onclick = () => {
    const inp = $('emtgInput'); const v = inp ? inp.value.trim() : '';
    if (!v) { toast('اكتب عنوان الاجتماع', true); return; }
    state.editMeetings.push({ title: v, status: 'required', datetime: '' });
    refreshMeetingsEdit();
  };
  // تغيير الحالة: عند «مجدول» يظهر حقل التاريخ/الوقت
  sec.querySelectorAll('.emtg-status').forEach((s) => s.onchange = () => {
    const i = Number(s.dataset.idx); if (!state.editMeetings[i]) return;
    state.editMeetings[i].status = s.value;
    if (s.value !== 'scheduled') state.editMeetings[i].datetime = '';
    refreshMeetingsEdit();
  });
  sec.querySelectorAll('.emtg-dt').forEach((d) => d.onchange = () => { const i = Number(d.dataset.idx); if (state.editMeetings[i]) state.editMeetings[i].datetime = dtFromInput(d.value); });
  sec.querySelectorAll('.emtg-del').forEach((b) => b.onclick = () => { state.editMeetings.splice(Number(b.dataset.idx), 1); refreshMeetingsEdit(); });
  sec.querySelectorAll('.emtg-ed').forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.idx), body = b.closest('.fu-item').querySelector('.fu-ibody'), cur = body.textContent;
    body.innerHTML = `<input type="text" class="fu-eta emtg-eta" value="${esc(cur)}"><div class="fu-eacts"><button class="btn btn-save" type="button" id="emtgS">حفظ</button><button class="btn btn-cancel" type="button" id="emtgC">إلغاء</button></div>`;
    const ta = body.querySelector('.emtg-eta'); ta.focus();
    $('emtgS').onclick = () => { const v = ta.value.trim(); if (v) state.editMeetings[i].title = v; refreshMeetingsEdit(); };
    $('emtgC').onclick = () => refreshMeetingsEdit();
  });
}

// ===== Meetings view (كل اجتماع بسطر مستقل) =====
// تطبيق الفلاتر العامة (مشروع/مسؤول/مرتبط بـ/نوع/بحث) على مهمة فيها اجتماعات
function meetingTaskMatches(t) {
  if (state.projects.length && !state.projects.includes(t.project)) return false;
  if (state.owners.length && !t.owners.some((o) => state.owners.includes(o))) return false;
  if (state.linked.length && !(t.linkedList || []).some((p) => state.linked.includes(p))) return false;
  if (state.types.length && !state.types.includes(t.type || '__none__')) return false;
  if (state.search) {
    const q = state.search.trim();
    if (![t.project, t.dept, t.file, t.owner, t.linkedTo, t.deliverable, t.notes, t.followup].join(' ').includes(q)) return false;
  }
  return true;
}

// ضمن مدى تاريخ الاجتماعات المجدولة (إن ضُبط)
function meetingInDateRange(m) {
  if (m.status !== 'scheduled' || !m.datetime) return !(state.meetingDateFrom || state.meetingDateTo);
  const d = m.datetime.slice(0, 10);
  if (state.meetingDateFrom && d < state.meetingDateFrom) return false;
  if (state.meetingDateTo && d > state.meetingDateTo) return false;
  return true;
}

function renderMeetings() {
  const tasks = state.tasks.filter((t) => t.meetings && t.meetings.length && meetingTaskMatches(t));
  let rows = [];
  tasks.forEach((t) => (t.meetings || []).forEach((m, idx) => rows.push({ t, m, idx })));
  const totalAll = rows.length;
  const cnt = (st) => rows.filter((r) => r.m.status === st).length;
  const counts = { required: cnt('required'), scheduled: cnt('scheduled'), done: cnt('done') };

  if (state.meetingFilter !== 'all') rows = rows.filter((r) => r.m.status === state.meetingFilter);
  // فلتر التاريخ يُطبَّق على الاجتماعات المجدولة فقط
  const dateActive = !!(state.meetingDateFrom || state.meetingDateTo);
  if (dateActive) rows = rows.filter((r) => r.m.status === 'scheduled' && meetingInDateRange(r.m));

  // مطلوب أولاً ثم مجدول (حسب موعد الاجتماع) ثم تم
  const order = { required: 0, scheduled: 1, done: 2 };
  rows.sort((a, b) => {
    if (order[a.m.status] !== order[b.m.status]) return order[a.m.status] - order[b.m.status];
    const x = (a.m.datetime || a.t.deadlineIso || '9999'), y = (b.m.datetime || b.t.deadlineIso || '9999');
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const fchips = [
    { k: 'all', lbl: 'الكل', c: totalAll },
    { k: 'required', lbl: 'مطلوب', c: counts.required },
    { k: 'scheduled', lbl: 'مجدول', c: counts.scheduled },
    { k: 'done', lbl: 'تم', c: counts.done },
  ].map((c) => `<button class="chip ${state.meetingFilter === c.k ? 'active' : ''}" data-mf="${c.k}">${c.lbl}<span class="c">${c.c}</span></button>`).join('');
  // فلتر التاريخ للاجتماعات المجدولة (تاريخ محدّد = ضبط «من» و«إلى» بنفس اليوم)
  const dateBar = `<div class="mtg-datefilter">📅 الاجتماعات المجدولة بين:
    <input type="date" id="mtgFrom" value="${esc(state.meetingDateFrom)}"> و
    <input type="date" id="mtgTo" value="${esc(state.meetingDateTo)}">
    ${dateActive ? '<button class="btn btn-cancel" id="mtgDateClear" type="button">مسح التاريخ</button>' : ''}</div>`;

  $('countLine').textContent = `${rows.length} اجتماع معروض — الإجمالي ${totalAll} (مطلوب ${counts.required} · مجدول ${counts.scheduled} · تم ${counts.done})`;

  if (!rows.length) {
    $('viewArea').innerHTML = `<div class="mtg-filter chips">${fchips}</div>${dateBar}<div class="table-wrap"><div class="empty">لا توجد اجتماعات مطابقة. أضف اجتماعاً من نافذة المهمة (إضافة/تعديل).</div></div>`;
    bindMeetingFilter();
    return;
  }

  const cols = activeMeetingCols();
  const editable = canEdit();
  const ths = cols.map((c) => `<th>${tr(c.label)}</th>`).join('') + (state.storeEnabled ? `<th>${tr('تذكير')}</th>` : '') + (editable ? `<th>${tr('تغيير الحالة')}</th>` : '');
  const body = rows.map((row) => {
    const { t, m, idx } = row;
    const tds = cols.map((c) => `<td class="${c.cls || ''}">${c.r(row)}</td>`).join('');
    // زرّ تذكير لكل اجتماع (متاح لكل مستخدم — يضبط تذكيره الخاص)
    const remPref = state.reminders && state.reminders[`${t.id}#m${idx}`];
    const remSet = remPref && (remPref.methods || []).length;
    const bellCell = state.storeEnabled
      ? `<td class="mt-rem"><button class="mtg-bell${remSet ? ' on' : ''}" data-id="${t.id}" data-idx="${idx}" title="${remSet ? 'تذكير مضبوط — تعديل' : 'ضبط تذكير لهذا الاجتماع'}">🔔</button></td>`
      : '';
    const ctrl = editable ? `<td class="mt-ctrl">
        <select class="mt-status" data-id="${t.id}" data-idx="${idx}">${Object.entries(MEETING_STATUS).map(([k, l]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="datetime-local" class="mt-dt" data-id="${t.id}" data-idx="${idx}" value="${esc(dtToInput(m.datetime))}" style="${m.status === 'scheduled' ? '' : 'display:none'}">
      </td>` : '';
    return `<tr class="${m.status === 'done' ? 'row-done' : ''}" data-id="${t.id}">${tds}${bellCell}${ctrl}</tr>`;
  }).join('');
  $('viewArea').innerHTML = `<div class="mtg-filter chips">${fchips}</div>${dateBar}<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${body}</tbody></table></div>`;
  bindMeetingFilter();
  $('viewArea').querySelectorAll('tbody tr').forEach((tr) => {
    tr.onclick = (e) => { if (e.target.closest('.mt-ctrl') || e.target.closest('.mt-rem')) return; openModal(Number(tr.dataset.id)); };
  });
  $('viewArea').querySelectorAll('.mtg-bell').forEach((b) => b.onclick = (e) => { e.stopPropagation(); openMeetingReminder(Number(b.dataset.id), Number(b.dataset.idx)); });
  // تغيير حالة اجتماع من العرض مباشرةً
  $('viewArea').querySelectorAll('.mt-status').forEach((s) => s.onchange = async () => {
    const id = Number(s.dataset.id), idx = Number(s.dataset.idx);
    const dtEl = s.closest('.mt-ctrl').querySelector('.mt-dt');
    const datetime = s.value === 'scheduled' ? dtFromInput(dtEl ? dtEl.value : '') : '';
    await setMeetingStatus(id, idx, s.value, datetime);
  });
  $('viewArea').querySelectorAll('.mt-dt').forEach((d) => d.onchange = async () => {
    await setMeetingStatus(Number(d.dataset.id), Number(d.dataset.idx), 'scheduled', dtFromInput(d.value));
  });
}

function bindMeetingFilter() {
  document.querySelectorAll('[data-mf]').forEach((b) => b.onclick = () => { state.meetingFilter = b.dataset.mf; renderMeetings(); });
  const from = $('mtgFrom'); if (from) from.onchange = () => { state.meetingDateFrom = from.value; renderMeetings(); };
  const to = $('mtgTo'); if (to) to.onchange = () => { state.meetingDateTo = to.value; renderMeetings(); };
  const clr = $('mtgDateClear'); if (clr) clr.onclick = () => { state.meetingDateFrom = ''; state.meetingDateTo = ''; renderMeetings(); };
}

// تغيير حالة اجتماع واحد بالموضع (يرسل المصفوفة الكاملة بعد التعديل)
async function setMeetingStatus(id, idx, status, datetime) {
  const t = state.tasks.find((x) => x.id === id); if (!t) return;
  const meetings = (t.meetings || []).map((m, i) => i === idx ? { title: m.title, status, datetime: status === 'scheduled' ? (datetime || m.datetime || '') : '' } : { title: m.title, status: m.status, datetime: m.datetime });
  try {
    const res = await fetch(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetings }) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    Object.assign(t, data.task);
    toast('تم تحديث حالة الاجتماع ✓');
    render();
  } catch (e) { toast('تعذّر التحديث: ' + e.message, true); load(true); }
}

// صفوف الاجتماعات المطابقة للفلاتر (تُستخدم في كانبان/تقويم الاجتماعات)
function meetingRows() {
  const rows = [];
  state.tasks.filter((t) => t.meetings && t.meetings.length && meetingTaskMatches(t))
    .forEach((t) => (t.meetings || []).forEach((m, idx) => rows.push({ t, m, idx })));
  return rows;
}

// ===== Meetings — Kanban (أعمدة حسب الحالة) =====
const MEETING_KCOLS = ['required', 'scheduled', 'done'];
function renderMeetingsKanban() {
  const rows = meetingRows();
  $('countLine').textContent = `${rows.length} اجتماع` + (canEdit() ? ' — اسحب البطاقة لتغيير الحالة' : '');
  const byStatus = { required: [], scheduled: [], done: [] };
  rows.forEach((r) => { (byStatus[r.m.status] || byStatus.required).push(r); });
  const card = (r) => `<div class="kcard" data-id="${r.t.id}" data-idx="${r.idx}">
      <div class="kp">🤝 ${esc(r.m.title)}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:5px">${esc(r.t.project)}${r.t.file ? ' — ' + esc(r.t.file) : ''}</div>
      <div class="km"><span>${esc((r.t.owner || '').split('\n')[0])}</span><span class="kdl">${r.m.status === 'scheduled' ? esc(r.m.datetime || '') : ''}</span></div></div>`;
  $('viewArea').innerHTML = `<div class="kanban kanban-mtg">${MEETING_KCOLS.map((s) => `
    <div class="kcol"><div class="kcol-head"><span>${MEETING_STATUS[s]}</span><span class="c">${byStatus[s].length}</span></div>
    <div class="kbody ${canEdit() ? '' : 'disabled'}" data-status="${s}">${byStatus[s].map(card).join('')}</div></div>`).join('')}</div>`;
  $('viewArea').querySelectorAll('.kcard').forEach((el) => { el.onclick = () => openModal(Number(el.dataset.id)); });
  if (canEdit() && window.Sortable) {
    $('viewArea').querySelectorAll('.kbody').forEach((col) => {
      Sortable.create(col, {
        group: 'mtgkanban', animation: 150, ghostClass: 'sortable-ghost',
        onEnd: async (evt) => {
          const ns = evt.to.dataset.status; if (evt.from.dataset.status === ns) return;
          const id = Number(evt.item.dataset.id), idx = Number(evt.item.dataset.idx);
          const t = state.tasks.find((x) => x.id === id); const m = t && t.meetings[idx];
          await setMeetingStatus(id, idx, ns, ns === 'scheduled' ? (m && m.datetime) || '' : '');
        },
      });
    });
  }
}

// ===== Meetings — Calendar (حسب موعد الاجتماع المجدول) =====
function renderMeetingsCalendar() {
  const rows = meetingRows().filter((r) => r.m.status === 'scheduled' && r.m.datetime);
  if (state.calY == null) { const d = new Date(); state.calY = d.getFullYear(); state.calM = d.getMonth(); }
  const y = state.calY, m = state.calM;
  const monthName = new Date(y, m, 1).toLocaleDateString('ar-SY-u-nu-latn', { month: 'long', year: 'numeric' });
  const startDow = (new Date(y, m, 1).getDay() + 1) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const byDay = {};
  rows.forEach((r) => { const [ty, tm, td] = r.m.datetime.slice(0, 10).split('-').map(Number); if (ty === y && tm === m + 1) (byDay[td] || (byDay[td] = [])).push(r); });
  const dows = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  let cells = dows.map((d) => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = (new Date(y, m, d).getDay() + 1) % 7;
    const tHtml = (byDay[d] || []).map((r) => `<div class="cal-task" data-id="${r.t.id}" title="${esc(r.t.project)}"><span class="cal-p">🤝 ${esc(r.m.title)}</span><span class="cal-f">${esc((r.m.datetime || '').slice(11))} · ${esc(r.t.project)}</span></div>`).join('');
    cells += `<div class="cal-cell ${iso === todayStr ? 'today' : ''} ${dow === 6 ? 'fri' : ''}"><div class="d">${d}</div>${tHtml}</div>`;
  }
  $('countLine').textContent = `${rows.length} اجتماع مجدول (تظهر الاجتماعات ذات التاريخ فقط)`;
  $('viewArea').innerHTML = `<div class="table-wrap" style="padding:16px">
    <div class="cal-head"><button id="calPrev">‹ السابق</button><h3>${monthName}</h3><button id="calNext">التالي ›</button></div>
    <div class="cal-grid">${cells}</div></div>`;
  $('calPrev').onclick = () => { state.calM--; if (state.calM < 0) { state.calM = 11; state.calY--; } renderMeetingsCalendar(); };
  $('calNext').onclick = () => { state.calM++; if (state.calM > 11) { state.calM = 0; state.calY++; } renderMeetingsCalendar(); };
  $('viewArea').querySelectorAll('.cal-task').forEach((el) => { el.onclick = () => openModal(Number(el.dataset.id)); });
}

// ===== Modal: view + edit =====
function openModal(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  closeMeetingReminder(); // تفريغ لوحة تذكير الاجتماع لتفادي تعارض مُعرّفات لوحتَي التذكير
  resetRemContext();
  $('mTitle').textContent = `${t.project}${t.file ? ' — ' + t.file : ''}`;
  const F = (label, val) => val ? `<div class="field"><label>${tr(label)}</label><div class="val">${esc(val)}</div></div>` : '';
  const meetingField = (t.meetings && t.meetings.length)
    ? `<div class="field"><label>${tr('🤝 الاجتماعات')}</label><div class="val">${t.meetings.map((m) => `<div class="mtg-row">${meetingStatusBadge(m)} <span class="mtg-name">${esc(m.title)}</span></div>`).join('')}</div></div>`
    : '';
  $('mBody').innerHTML =
    F('المشروع', t.project) + F('الملف', t.file) + F('النوع', t.type) + F('مرتبط بـ', t.linkedTo) + F('المسؤول المعني', t.owner) +
    deliverableSection(t) +
    `<div class="field"><label>${tr('الموعد / الدورية')}</label><div class="val">${esc(t.deadlineRaw || '—')} <span style="color:var(--muted)">(${relText(t)})</span></div></div>` +
    `<div class="field"><label>${tr('الأولوية')}</label><div class="val"><span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span></div></div>` +
    `<div class="field"><label>${tr('الحالة')}</label><div class="val"><span class="badge st ${stClass(t.status)}">${esc(t.status)}</span></div></div>` +
    meetingField +
    followupSection(t) + F('ملاحظات', t.notes) +
    attachmentsSection(t) +
    reminderSection(t);
  $('mHeadActions').innerHTML = canEdit() ? `<button class="mh-icon" id="mEdit" title="تعديل المهمة">✏️</button><button class="mh-icon mh-del" id="mDel" title="حذف المهمة">🗑</button>` : '';
  $('mFoot').innerHTML = '';
  if (canEdit()) { $('mEdit').onclick = () => openEdit(t); $('mDel').onclick = () => removeTask(t.id); }
  bindFollowup(t);
  bindDeliverable(t);
  bindAttachments(t);
  bindReminderSection(t);
  $('modalBack').classList.add('open');
}

// ===== المرفقات (Google Drive) داخل نافذة المهمة =====
function parseAttachments(raw) {
  return fuBlocks(raw).map((b, i) => { const lines = b.split('\n'); return { idx: i, name: (lines[0] || 'مرفق').trim(), url: (lines[1] || lines[0] || '').trim() }; });
}
function attachmentsSection(t) {
  if (!state.attachmentsEnabled) return ''; // غير مفعّل (يحتاج إعداد Drive)
  const items = parseAttachments(t.attachments);
  const ed = canEdit();
  const list = items.length
    ? items.map((a) => `<div class="att-item"><a class="att-link" href="${esc(a.url)}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>${ed ? `<button class="fu-ico att-del" type="button" data-idx="${a.idx}" title="حذف">🗑</button>` : ''}</div>`).join('')
    : '<div class="fu-empty">لا مرفقات.</div>';
  const add = ed ? `<div class="att-add"><input type="file" id="attInput"><button class="btn btn-save" id="attUpload" type="button">⬆ رفع مرفق</button></div>` : '';
  return `<div id="attSection" class="field"><label>📎 المرفقات</label><div class="fu-log">${list}</div>${add}</div>`;
}
function refreshAttachments(id) { const t = state.tasks.find((x) => x.id === id); if (!t) return; const el = $('attSection'); if (el) { el.outerHTML = attachmentsSection(t); bindAttachments(t); } }
function bindAttachments(t) {
  if (!state.attachmentsEnabled) return;
  const up = $('attUpload'); if (up) up.onclick = () => uploadAttachment(t.id);
  const sec = $('attSection'); if (sec) sec.querySelectorAll('.att-del').forEach((b) => b.onclick = () => deleteAttachment(t.id, Number(b.dataset.idx)));
}
async function uploadAttachment(id) {
  const inp = $('attInput'); const f = inp && inp.files && inp.files[0];
  if (!f) { toast('اختر ملفاً أولاً', true); return; }
  if (f.size > 8 * 1024 * 1024) { toast('الحجم يتجاوز ٨ ميغابايت', true); return; }
  const btn = $('attUpload'); if (btn) { btn.disabled = true; btn.textContent = '... رفع'; }
  try {
    const data = await new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result).split(',')[1]); fr.onerror = reject; fr.readAsDataURL(f); });
    const res = await fetch(`/api/tasks/${id}/attachment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, mime: f.type, data }) });
    const d = await res.json(); if (!d.ok) throw new Error(d.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, d.task);
    toast('تم رفع المرفق ✓'); refreshAttachments(id);
  } catch (e) { toast('تعذّر الرفع: ' + e.message, true); }
  if (btn) { btn.disabled = false; btn.textContent = '⬆ رفع مرفق'; }
}
async function deleteAttachment(id, idx) {
  if (!confirm('حذف هذا المرفق؟')) return;
  try {
    const res = await fetch(`/api/tasks/${id}/attachment/${idx}`, { method: 'DELETE' });
    const d = await res.json(); if (!d.ok) throw new Error(d.error);
    const t = state.tasks.find((x) => x.id === id); if (t) Object.assign(t, d.task);
    toast('تم حذف المرفق ✓'); refreshAttachments(id);
  } catch (e) { toast('تعذّر: ' + e.message, true); }
}

// قسم «تذكيراتي» داخل نافذة المهمة (لكل مستخدم)
// تهيئة سياق تذكيرات المهمة عند فتحها (المستخدم المُحدَّد + خريطة تذكيراته)
function resetRemContext() { state.remUser = state.me ? state.me.email : ''; state.remMap = state.reminders || {}; }
function remUserName() {
  if (!state.me) return '';
  if (state.remUser === state.me.email) return state.me.name;
  const u = (state.users || []).find((x) => x.email === state.remUser);
  return u ? u.name : state.remUser;
}
// التفضيل الافتراضي: المسؤول المعني يحصل على إشعار متصفح قبل يوم الساعة 09:00 (قابل للتعديل/الإلغاء)
function remDefaultPref(t) {
  const isOwner = (t.owners || []).map((o) => o.trim()).includes(String(remUserName() || '').trim());
  return isOwner
    ? { methods: ['telegram'], days: ['1d'], dates: [], times: [{ t: '10:00', count: 1, every: 0 }] }
    : { methods: [], days: [], dates: [], times: [] };
}
// تسمية «أيام التذكير» — «موعد المهمة» للمهمة، و«موعد الاجتماع» لتذكير اجتماع
function offsetLabel(o, mIdx) {
  if (mIdx != null && o.key === 'morning') return 'موعد الاجتماع';
  return o.label;
}
function remTimeRow(tm) {
  tm = tm || {};
  return `<div class="rem-time-row">
    <input type="time" class="rt-t" value="${esc(tm.t || '09:00')}">
    <span>${tr('كرّر')}</span><input type="number" class="rt-count" min="1" max="20" value="${esc(tm.count || 1)}" title="عدد مرات التكرار">
    <span>${tr('مرّة، كل')}</span><input type="number" class="rt-every" min="0" max="720" value="${esc(tm.every || 0)}" title="فترة التكرار بالدقائق">
    <span>${tr('دقيقة')}</span><button type="button" class="rt-del" title="حذف التوقيت">✕</button>
  </div>`;
}
function reminderSection(t, mIdx) {
  if (!state.storeEnabled) {
    return `<div id="remSection" class="rem-box"><label class="rem-title">🔔 التذكيرات</label>
      <div style="color:var(--muted);font-size:13px">ميزة التذكيرات تتطلب تفعيل التخزين الدائم (DATA_SHEET_ID).</div></div>`;
  }
  const remKey = (mIdx == null) ? String(t.id) : `${t.id}#m${mIdx}`;
  const saved = (state.remMap || {})[remKey];
  const pref = saved || (mIdx == null ? remDefaultPref(t) : { methods: [], days: [], dates: [], times: [] });
  const chk = (arr, item) => (arr || []).includes(item.key) ? 'checked' : '';
  const methods = REMINDER_METHODS.map((m) => `<label class="rem-opt"><input type="checkbox" data-rem="method" value="${m.key}" ${chk(pref.methods, m)}> ${tr(m.label)}</label>`).join('');
  const days = REMINDER_OFFSETS.map((o) => `<label class="rem-opt"><input type="checkbox" data-rem="day" value="${o.key}" ${chk(pref.days, o)}> ${tr(offsetLabel(o, mIdx))}</label>`).join('');
  const datesHtml = (pref.dates || []).map((d) => remDateChip(d)).join('');
  const timesHtml = (pref.times && pref.times.length ? pref.times : [{ t: '09:00', count: 1, every: 0 }]).map(remTimeRow).join('');
  const userPicker = isAdmin()
    ? `<div class="rem-group"><span class="rem-sub">${tr('إعدادات المستخدم:')}</span>
        <select id="remUserSel">${(state.users || []).map((u) => `<option value="${esc(u.email)}" ${u.email === state.remUser ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>`
    : '';
  const calUrl = state.me && state.me.calToken ? `${location.origin}/api/calendar/${state.me.calToken}.ics` : '';
  const calHint = calUrl
    ? `<div class="rem-cal">لإضافة المهام إلى تقويم الحاسوب، اشترك بهذا الرابط مرة واحدة:
        <div class="rem-cal-row"><input id="calUrl" readonly value="${esc(calUrl)}"><button class="btn btn-cancel" id="calCopy" type="button">نسخ</button></div></div>`
    : '';
  return `<div id="remSection" class="rem-box">
    <label class="rem-title">${mIdx == null ? tr('🔔 تذكيرات هذه المهمة') : tr('🔔 تذكير هذا الاجتماع')}</label>
    ${userPicker}
    <div class="rem-group"><span class="rem-sub">${tr('طريقة التذكير:')}</span>${methods}</div>
    <div class="rem-group"><span class="rem-sub">${tr('أيام التذكير:')}</span>${days}</div>
    <div class="rem-group" style="align-items:flex-start"><span class="rem-sub">${tr('+ تواريخ ثابتة:')}</span>
      <div style="flex:1">
        <div id="remDates" class="rem-dates">${datesHtml}</div>
        <div class="rem-cal-row" style="margin-top:6px"><input type="date" id="remDateInput"><button class="btn btn-cancel" id="remDateAdd" type="button">${tr('➕ أضف تاريخاً')}</button></div>
      </div>
    </div>
    <div class="rem-group" style="align-items:flex-start"><span class="rem-sub">${tr('توقيت التذكير (سوريا):')}</span>
      <div style="flex:1">
        <div id="remTimesList">${timesHtml}</div>
        <button class="btn btn-cancel" id="remTimeAdd" type="button" style="margin-top:4px">${tr('➕ أضف توقيتاً')}</button>
      </div>
    </div>
    <button class="btn btn-save" id="remSave" type="button" style="margin-top:8px">${tr('💾 حفظ التذكير')}</button>
    <div style="font-size:11.5px;color:var(--muted);margin-top:6px">تُطلَق التذكيرات بكل الطرق المختارة في الأيام والأوقات المحدّدة، أثناء فتح المستلِم للوحة بحسابه.</div>
    ${calHint}
  </div>`;
}

function remDateChip(d) {
  return `<span class="rem-date" data-date="${esc(d)}">${esc(d)} <button type="button" class="rem-date-x" data-date="${esc(d)}" aria-label="حذف">✕</button></span>`;
}
function refreshReminderSection(t, mIdx) { const el = $('remSection'); if (el) { el.outerHTML = reminderSection(t, mIdx); bindReminderSection(t, mIdx); } }
function bindReminderSection(t, mIdx) {
  if (!state.storeEnabled) return;
  // مبدّل المستخدم (المدير): جلب تذكيرات المستخدم المختار لهذه المهمة/الاجتماع
  const usel = $('remUserSel');
  if (usel) usel.onchange = async () => {
    const email = usel.value;
    try {
      if (email === state.me.email) { state.remUser = email; state.remMap = state.reminders; }
      else { const d = await (await fetch('/api/reminders?user=' + encodeURIComponent(email))).json(); state.remUser = email; state.remMap = d.ok ? (d.reminders || {}) : {}; }
      refreshReminderSection(t, mIdx);
    } catch (e) { toast('تعذّر جلب إعدادات المستخدم: ' + e.message, true); }
  };
  const datesBox = $('remDates');
  const dateAdd = $('remDateAdd');
  if (dateAdd) dateAdd.onclick = () => {
    const inp = $('remDateInput'); const v = inp ? inp.value : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('اختر تاريخاً صالحاً', true); return; }
    if ([...datesBox.querySelectorAll('.rem-date')].some((x) => x.dataset.date === v)) return;
    datesBox.insertAdjacentHTML('beforeend', remDateChip(v));
    if (inp) inp.value = '';
  };
  if (datesBox) datesBox.onclick = (e) => { const x = e.target.closest('.rem-date-x'); if (x) x.closest('.rem-date').remove(); };
  // قائمة التوقيتات: إضافة/حذف
  const timesList = $('remTimesList');
  const timeAdd = $('remTimeAdd');
  if (timeAdd) timeAdd.onclick = () => { timesList.insertAdjacentHTML('beforeend', remTimeRow({ t: '09:00', count: 1, every: 0 })); };
  if (timesList) timesList.onclick = (e) => { const x = e.target.closest('.rt-del'); if (x) x.closest('.rem-time-row').remove(); };
  const save = $('remSave');
  if (save) save.onclick = async () => {
    const methods = [...document.querySelectorAll('[data-rem="method"]:checked')].map((x) => x.value);
    const daysSel = [...document.querySelectorAll('[data-rem="day"]:checked')].map((x) => x.value);
    const dates = [...(datesBox ? datesBox.querySelectorAll('.rem-date') : [])].map((x) => x.dataset.date);
    const times = [...document.querySelectorAll('#remTimesList .rem-time-row')].map((r) => ({
      t: r.querySelector('.rt-t').value,
      count: Number(r.querySelector('.rt-count').value) || 1,
      every: Number(r.querySelector('.rt-every').value) || 0,
    })).filter((x) => /^\d{1,2}:\d{2}$/.test(x.t));
    save.disabled = true; save.textContent = '... حفظ';
    try {
      const body = { methods, days: daysSel, dates, times };
      if (mIdx != null) body.meeting = mIdx;
      if (state.remUser && state.remUser !== state.me.email) body.user = state.remUser;
      const res = await fetch(`/api/tasks/${t.id}/reminder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json(); if (!data.ok) throw new Error(data.error);
      const pref = { methods, days: daysSel, dates, times };
      const remKey = (mIdx == null) ? String(t.id) : `${t.id}#m${mIdx}`;
      (state.remMap || (state.remMap = {}))[remKey] = pref;
      if (state.remUser === state.me.email) state.reminders[remKey] = pref;
      toast('تم حفظ التذكير ✓');
      if (mIdx == null) scheduleReminders(); else render();
    } catch (e) { toast('تعذّر الحفظ: ' + e.message, true); }
    save.disabled = false; save.textContent = '💾 حفظ التذكير';
  };
  const copy = $('calCopy');
  if (copy) copy.onclick = () => { const i = $('calUrl'); i.select(); document.execCommand('copy'); toast('تم نسخ رابط التقويم ✓'); };
}

function field(label, name, value, type = 'text') {
  return `<div class="field"><label>${tr(label)}</label><input name="${name}" type="${type}" value="${esc(value)}"></div>`;
}
function textarea(label, name, value) {
  return `<div class="field"><label>${tr(label)}</label><textarea name="${name}">${esc(value)}</textarea></div>`;
}
function selectField(label, name, options, value) {
  return `<div class="field"><label>${tr(label)}</label><select name="${name}">${options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
}
// حقل الموعد: تاريخ محدد (تقويم) / دورية / غير محدد
const DL_WEEKDAYS = ['كل السبت', 'كل الأحد', 'كل الإثنين', 'كل الثلاثاء', 'كل الأربعاء', 'كل الخميس'];
function deadlineField(t) {
  let mode = 'none', dateVal = '', recur = 'يوميا', mday = 1;
  if (t.deadlineIso) { mode = 'date'; dateVal = t.deadlineIso; }
  else if (t.recurrence) {
    mode = 'recur';
    const rc = String(t.recurrence);
    if (/يوميا|يومي/.test(rc)) recur = 'يوميا';
    else { const wd = DL_WEEKDAYS.find((d) => rc.includes(d) || rc.includes(d.replace('كل ال', '').replace('كل ', '')));
      if (wd) recur = wd;
      else if (/شهر/.test(rc)) { recur = 'شهري'; const mm = rc.match(/(\d{1,2})/); if (mm) mday = Number(mm[1]); }
      else recur = 'أسبوعي'; }
  }
  const recurOpts = ['يوميا', 'أسبوعي', ...DL_WEEKDAYS, 'شهري'];
  return `<div class="field"><label>الموعد / الدورية</label>
    <select id="dlMode">
      <option value="date" ${mode === 'date' ? 'selected' : ''}>📅 تاريخ محدد</option>
      <option value="recur" ${mode === 'recur' ? 'selected' : ''}>🔁 دورية</option>
      <option value="none" ${mode === 'none' ? 'selected' : ''}>— غير محدد</option>
    </select>
    <input type="date" id="dlDate" value="${esc(dateVal)}" style="margin-top:8px;${mode === 'date' ? '' : 'display:none'}">
    <div id="dlRecurWrap" style="margin-top:8px;${mode === 'recur' ? '' : 'display:none'}">
      <select id="dlRecur">${recurOpts.map((o) => `<option ${o === recur ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <input type="number" id="dlMday" min="1" max="31" value="${mday}" placeholder="يوم الشهر" style="margin-top:8px;${recur === 'شهري' ? '' : 'display:none'}">
    </div></div>`;
}

// حقل قائمة منسدلة من القيم الموجودة + خيار «إضافة جديد» (يصلح للمشروع/المسؤول/مرتبط بـ)
function pickField(label, name, values, value, multiline) {
  const list = (values || []).slice();
  if (value && !list.includes(value)) list.unshift(value);
  const opts = list.map((p) => `<option value="${esc(p)}" ${p === value ? 'selected' : ''}>${esc(p)}</option>`).join('');
  const ni = multiline
    ? `<textarea name="${name}New" id="${name}New" rows="2" placeholder="قيمة جديدة (سطر لكل قيمة)" style="display:none;margin-top:8px"></textarea>`
    : `<input name="${name}New" id="${name}New" type="text" placeholder="قيمة جديدة" style="display:none;margin-top:8px">`;
  return `<div class="field"><label>${tr(label)}</label>
    <select name="${name}" id="${name}Sel">${opts}<option value="__new__">${tr('➕ إضافة جديد…')}</option></select>${ni}</div>`;
}

function openEdit(t) {
  const isNew = !t;
  closeMeetingReminder(); // تفريغ لوحة تذكير الاجتماع لتفادي تعارض المُعرّفات
  t = t || { project: '', file: '', type: '', linkedTo: '', linkedList: [], owner: '', owners: [], deliverable: '', deadlineRaw: '', priority: 'متوسطة', status: 'لم تبدأ', followup: '', notes: '', created: '', createdIso: '', meetings: [] };
  if (isNew) { state.newDv = []; state.newEv = []; }
  // قوائم «مرتبط بـ» والمسؤولين والاجتماعات المحلية (نسخة قابلة للتعديل)
  state.editLinked = isNew ? [] : ((t.linkedList && t.linkedList.length) ? t.linkedList.slice() : []);
  state.editOwner = isNew ? [] : ((t.owners && t.owners.length) ? t.owners.slice() : []);
  state.editMeetings = isNew ? [] : (t.meetings || []).map((m) => ({ title: m.title, status: m.status || 'required', datetime: m.datetime || '' }));
  const createdVal = isNew ? todayISO() : (t.createdIso || t.created || '');
  $('mTitle').textContent = isNew ? tr('إضافة مهمة جديدة') : tr('تعديل المهمة');
  $('mBody').innerHTML = `<form id="taskForm">
    ${pickField('المشروع', 'project', state.filters.projects, t.project, false)}
    <div class="form-row">${field('الملف', 'file', t.file)}${selectField('النوع', 'type', ['', ...TYPES], t.type)}</div>
    ${linkedEditSection()}
    ${ownerEditSection()}
    ${isNew ? localDeliverableSection() : deliverableSection(t)}
    ${deadlineField(t)}
    <div class="form-row">${selectField('الأولوية', 'priority', PRIORITIES, t.priority)}${selectField('الحالة', 'status', STATUSES, t.status)}</div>
    ${meetingsEditSection()}
    ${isNew ? localEventSection() : followupSection(t)}
    <div class="form-row">${field('تاريخ إنشاء المهمة', 'created', createdVal, 'date')}${field('ملاحظات', 'notes', t.notes)}</div>
  </form>`;
  $('mBody').querySelectorAll('select[id$="Sel"]').forEach((sel) => {
    const ne = document.getElementById(sel.id.replace(/Sel$/, 'New'));
    if (ne) {
      const sync = () => { ne.style.display = sel.value === '__new__' ? '' : 'none'; };
      sel.onchange = () => { sync(); if (sel.value === '__new__') ne.focus(); };
      sync(); // ضبط الحالة الأولية — مهمّ للبروفايل الفارغ حيث «إضافة جديد» هي الخيار الوحيد المُختار تلقائياً
    }
  });
  const dlMode = $('dlMode');
  if (dlMode) {
    dlMode.onchange = () => { $('dlDate').style.display = dlMode.value === 'date' ? '' : 'none'; $('dlRecurWrap').style.display = dlMode.value === 'recur' ? '' : 'none'; };
    const dlRecur = $('dlRecur');
    if (dlRecur) dlRecur.onchange = () => { $('dlMday').style.display = dlRecur.value === 'شهري' ? '' : 'none'; };
  }
  bindLinked();
  bindOwner();
  bindMeetingsEdit();
  if (isNew) { bindLocalDeliverable(); bindLocalEvent(); } else { bindDeliverable(t); bindFollowup(t); }
  $('mHeadActions').innerHTML = `<button class="mh-icon mh-save" id="mSave" title="حفظ">💾</button>`;
  $('mFoot').innerHTML = `<button class="btn btn-cancel" id="mCancel">إلغاء</button>`;
  $('mSave').onclick = () => saveTask(isNew ? null : t.id);
  $('mCancel').onclick = () => (isNew ? closeModal() : openModal(t.id));
  $('modalBack').classList.add('open');
}

async function saveTask(id) {
  const form = $('taskForm');
  const payload = {};
  new FormData(form).forEach((v, k) => { payload[k] = v; });
  // الاجتماعات و«مرتبط بـ» والمسؤولون من القوائم المحلية (كل شخص بسطر مستقل)
  payload.meetings = state.editMeetings.map((m) => ({ title: m.title, status: m.status || 'required', datetime: m.status === 'scheduled' ? (m.datetime || '') : '' }));
  payload.linkedTo = state.editLinked.join('\n');
  payload.owner = state.editOwner.join('\n');
  // القائمة المنسدلة للمشروع: «إضافة جديد» → استخدم النصّ المُدخَل
  ['project'].forEach((k) => {
    if (payload[k] === '__new__') payload[k] = (payload[k + 'New'] || '').trim();
    delete payload[k + 'New'];
  });
  // مهمة جديدة: المخرجات (مع تخصيصها المتوازي) والأحداث من القوائم المحلية
  if (!id) {
    payload.deliverable = state.newDv.map((d) => d.text).join('\n\n');
    payload.dvowners = state.newDv.map((d) => (d.assignee || '-')).join('\n\n');
    payload.dvdates = state.newDv.map((d) => (d.date || '-')).join('\n\n');
    payload.events = state.newEv.slice();
  }
  // الموعد: من خيار التاريخ/الدورية/غير محدد
  const dlMode = form.querySelector('#dlMode');
  if (dlMode) {
    if (dlMode.value === 'date') { const v = form.querySelector('#dlDate').value; payload.deadlineRaw = v ? v.split('-').reverse().map(Number).join('/') : ''; }
    else if (dlMode.value === 'recur') { let r = form.querySelector('#dlRecur').value; if (r === 'شهري') r = `شهري - يوم ${form.querySelector('#dlMday').value || 1}`; payload.deadlineRaw = r; }
    else payload.deadlineRaw = '';
  }
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

async function removeTask(id) {
  if (!confirm('حذف هذه المهمة نهائياً من الملف؟ لا يمكن التراجع.')) return;
  try {
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    toast('تم حذف المهمة ✓');
    closeModal();
    await load(true);
  } catch (e) { toast('تعذّر الحذف: ' + e.message, true); }
}

function closeModal() { $('modalBack').classList.remove('open'); $('mBody').innerHTML = ''; }

// نافذة تذكير اجتماع محدّد (تُفتح من زرّ الجرس في قائمة الاجتماعات) — تعيد استخدام لوحة التذكير نفسها
function openMeetingReminder(taskId, mIdx) {
  const t = state.tasks.find((x) => x.id === taskId); if (!t) return;
  const m = (t.meetings || [])[mIdx]; if (!m) return;
  closeModal(); // تفريغ لوحة تذكير المهمة لتفادي تعارض مُعرّفات لوحتَي التذكير
  resetRemContext();
  $('mtgRemTitle').textContent = `🔔 تذكير الاجتماع: ${m.title}`;
  const when = m.datetime
    ? `موعد الاجتماع: <b>${esc(m.datetime)}</b>`
    : 'الاجتماع غير مجدول (بلا تاريخ) — استخدم «تواريخ ثابتة» لضبط التذكير';
  $('mtgRemBody').innerHTML =
    `<div class="field"><label>الاجتماع</label><div class="val">${esc(m.title)} — <span style="color:var(--muted)">${when}</span></div></div>` +
    reminderSection(t, mIdx);
  bindReminderSection(t, mIdx);
  $('mtgRemBack').classList.add('open');
}
function closeMeetingReminder() { $('mtgRemBack').classList.remove('open'); $('mtgRemBody').innerHTML = ''; }

// ===== محرّك تذكيرات المهام (إشعارات المتصفح أثناء فتح اللوحة) =====
const REM_OFFSET_DAYS = { morning: 0, '1d': 1, '3d': 3, '7d': 7 };
const REM_DEFAULT_TIME = '09:00';
let _remTimers = [];

function showLocalNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: '/assets/logo-mark.png', tag: title + body })).catch(() => { new Notification(title, { body }); });
    } else { new Notification(title, { body }); }
  } catch { /* تجاهل */ }
}

// أحداث التذكير المستحقّة للمستخدم الحالي (افتراضي للمسؤول + التذكيرات المضبوطة) — كل الطرق تخضع للأيام والأوقات
function reminderEvents() {
  const me = state.me; if (!me) return [];
  const myName = String(me.name || '').trim();
  const events = [];
  for (const t of state.tasks) {
    if (t.isDone) continue;
    const isOwner = (t.owners || []).map((o) => o.trim()).includes(myName);
    let pref = (state.reminders || {})[String(t.id)];
    if (!pref && isOwner) pref = { methods: ['telegram'], days: ['1d'], dates: [], times: [{ t: '10:00', count: 1, every: 0 }] };
    if (!pref || !(pref.methods || []).length) continue;
    const times = (pref.times && pref.times.length) ? pref.times : [{ t: '09:00', count: 1, every: 0 }];
    const ownerNote = (!isOwner && t.owner) ? ` — المسؤول: ${t.owner.split('\n')[0]}` : '';
    const body = `${t.project}${t.file ? ' — ' + t.file : ''}${ownerNote}`;
    // تواريخ الإطلاق = (الموعد − أيام التذكير) + التواريخ الثابتة
    const dayDates = [];
    for (const off of (pref.days || [])) { if (REM_OFFSET_DAYS[off] == null || !t.deadlineIso) continue; const [y, m, d] = t.deadlineIso.split('-').map(Number); dayDates.push(new Date(y, m - 1, d - REM_OFFSET_DAYS[off])); }
    for (const fd of (pref.dates || [])) { if (/^\d{4}-\d{2}-\d{2}$/.test(fd)) { const [y, m, d] = fd.split('-').map(Number); dayDates.push(new Date(y, m - 1, d)); } }
    for (const dd of dayDates) {
      times.forEach((tm, ti) => {
        const [hh, mm] = String(tm.t || '09:00').split(':').map(Number);
        const base = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate(), hh || 0, mm || 0, 0, 0);
        const count = Math.max(1, Number(tm.count) || 1), every = Math.max(0, Number(tm.every) || 0);
        for (let i = 0; i < count; i++) {
          events.push({ taskId: t.id, fireAt: new Date(base.getTime() + i * every * 60000), tag: `${dd.toISOString().slice(0, 10)}_${ti}_${i}`, body, methods: pref.methods });
        }
      });
    }
  }
  return events;
}

// إطلاق حدث: إشعار فوري داخل المتصفح فقط (أثناء فتح اللوحة).
// البريد/تيليجرام/Push يرسلها الخادم عبر نبضة cron حتى دون فتح اللوحة (لتفادي الإرسال المزدوج).
function fireEvent(ev) {
  if ((ev.methods || []).includes('push')) showLocalNotif('🔔 تذكير بمهمة', ev.body);
}

// يُطلق المستحقّ الآن (عند الدخول) ويجدول القادم خلال اليوم ما دامت اللوحة مفتوحة — مع منع التكرار عبر localStorage
function scheduleReminders() {
  _remTimers.forEach(clearTimeout); _remTimers = [];
  if (!state.me) return;
  const now = Date.now();
  for (const ev of reminderEvents()) {
    const key = `eo_rem_${state.me.email || ''}_${ev.taskId}_${ev.tag}`;
    if (localStorage.getItem(key)) continue;
    const delay = ev.fireAt.getTime() - now;
    if (delay <= 0 && delay > -12 * 3600 * 1000) { fireEvent(ev); try { localStorage.setItem(key, '1'); } catch { /* تجاهل */ } }
    else if (delay > 0 && delay < 24 * 3600 * 1000) { _remTimers.push(setTimeout(() => { fireEvent(ev); try { localStorage.setItem(key, '1'); } catch { /* تجاهل */ } }, delay)); }
  }
}

// ===== Notification bell (in-app) =====
function bellItems() {
  return state.tasks
    .filter((t) => (t.isOverdue || t.isToday) && !t.isDone)
    .sort((a, b) => (a.diffDays ?? 0) - (b.diffDays ?? 0));
}
// عند فتح الجرس: تُعتبر كل التنبيهات الحالية «مقروءة» فتختفي الدائرة الحمراء حتى ظهور تنبيه جديد
function markNotifSeen() {
  const ids = bellItems().map((t) => String(t.id));
  state.seenNotif = new Set(ids);
  try { localStorage.setItem('eo_seen_notif', JSON.stringify(ids)); } catch { /* تجاهل */ }
  renderBell();
}
function renderBell() {
  const items = bellItems();
  const cnt = items.length;
  const unseen = items.filter((t) => !state.seenNotif.has(String(t.id))).length; // الجديدة غير المقروءة
  const badge = $('bellCount');
  badge.textContent = unseen;
  badge.style.display = unseen ? '' : 'none';

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
  if (state.dataType === 'meetings') {
    if (state.shape === 'kanban') renderMeetingsKanban();
    else if (state.shape === 'calendar') renderMeetingsCalendar();
    else renderMeetings();
  } else {
    if (state.shape === 'kanban') renderKanban();
    else if (state.shape === 'calendar') renderCalendar();
    else renderTable();
  }
  $('viewArea').classList.toggle('expanded', state.expanded);
}

async function load(refresh = false) {
  try {
    const firstLoad = !state.me;
    if (firstLoad) { await fetchMe(); await fetchReminders(); await fetchUsers(); }
    await fetchTasks(refresh);
    $('sync').textContent = fmtSync(state.meta.fetchedAt);
    render();
    if (window.Notification && Notification.permission === 'granted') setupPush(false);
    // طلب إذن الإشعارات مرّة (لتفعيل التذكير الافتراضي قبل يوم) ثم جدولة التذكيرات
    if (firstLoad && window.Notification && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch { /* تجاهل */ }
    }
    scheduleReminders();
  } catch (e) {
    if (e.message === 'redirect') return;
    $('viewArea').innerHTML = `<div class="table-wrap"><div class="empty">تعذّر تحميل المهام: ${esc(e.message)}</div></div>`;
  }
}

// ===== اللغة والاتجاه =====
(function () {
  const lb = $('langBtn'), db = $('dirBtn');
  const syncLangBtn = () => { if (lb) lb.textContent = (window.I18N && I18N.lang === 'en') ? 'ع' : 'EN'; };
  syncLangBtn();
  if (lb) lb.onclick = () => {
    if (!window.I18N) return;
    I18N.setLang(I18N.lang === 'en' ? 'ar' : 'en');
    syncLangBtn();
    I18N.applyStatic();
    closeModal(); closeMeetingReminder();
    try { render(); if (window._syncExpandBtn) window._syncExpandBtn(); } catch (e) { /* قبل اكتمال التحميل */ }
  };
  if (db) db.onclick = () => { if (window.I18N) I18N.setDir(I18N.dir === 'ltr' ? 'rtl' : 'ltr'); };
})();

// ===== Events =====
$('refreshBtn').onclick = () => load(true);
$('addBtn').onclick = () => openEdit(null);
state.expanded = localStorage.getItem('eo_expanded') === '1';
try { state.tableCols = JSON.parse(localStorage.getItem('eo_tablecols_v2') || 'null') || DEFAULT_TABLE_COLS.slice(); } catch { state.tableCols = DEFAULT_TABLE_COLS.slice(); }
try { state.meetingCols = JSON.parse(localStorage.getItem('eo_meetingcols') || 'null') || DEFAULT_MEETING_COLS.slice(); } catch { state.meetingCols = DEFAULT_MEETING_COLS.slice(); }
try { state.seenNotif = new Set(JSON.parse(localStorage.getItem('eo_seen_notif') || '[]')); } catch { state.seenNotif = new Set(); }
try { state.colWidths = JSON.parse(localStorage.getItem('eo_colwidths') || '{}') || {}; } catch { state.colWidths = {}; }
(function () {
  const cb = $('colsBtn');
  if (cb) cb.onclick = (e) => { e.stopPropagation(); const w = $('colsWrap'); const open = w.classList.contains('open'); document.querySelectorAll('.ms.open').forEach((x) => x.classList.remove('open')); if (!open) { buildColsPanel(); w.classList.add('open'); } };
})();
(function () {
  const eb = $('expandBtn');
  const sync = () => { if (eb) { eb.classList.toggle('active', state.expanded); eb.textContent = state.expanded ? tr('↕ عرض مضغوط') : tr('↕ عرض موسّع'); } };
  window._syncExpandBtn = sync;
  if (eb) eb.onclick = () => { state.expanded = !state.expanded; localStorage.setItem('eo_expanded', state.expanded ? '1' : '0'); sync(); render(); };
  sync();
})();
$('bellBtn').onclick = (e) => { e.stopPropagation(); const p = $('bellPanel'); const opening = !p.classList.contains('open'); p.classList.toggle('open'); if (opening) markNotifSeen(); };
$('logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login.html'; };
// تبديل البروفايل: يضبط الجلسة ثم يعيد تحميل بيانات التبويب الجديد
(function () {
  const ps = $('profileSwitch');
  if (ps) ps.onchange = async () => {
    try {
      const r = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: ps.value }) });
      const d = await r.json(); if (!d.ok) throw new Error(d.error);
      state.profile = ps.value; state.expandedRows = new Set();
      toast('تم التبديل إلى: ' + ps.value);
      await load(true);
    } catch (e) { toast('تعذّر التبديل: ' + e.message, true); }
  };
})();

// ===== حساب المستخدم (للمحرّر/المشاهد) =====
function openAccount() {
  if (!state.me) return;
  $('acctEmail').value = state.me.email || '';
  $('acctFirst').value = state.me.firstName || '';
  $('acctLast').value = state.me.lastName || '';
  $('acctPhone').value = state.me.phone || '';
  $('acctPw').value = '';
  // قسم تيليجرام: حالة الربط + كيفية الربط
  const tg = $('acctTelegram');
  if (tg) {
    if (!state.telegramEnabled) { tg.style.display = 'none'; }
    else {
      tg.style.display = '';
      const bot = state.telegramBot ? `<a href="https://t.me/${esc(state.telegramBot)}" target="_blank" rel="noopener">@${esc(state.telegramBot)}</a>` : 'بوت اللوحة على تيليجرام';
      tg.innerHTML = state.me.telegramLinked
        ? `✅ حساب تيليجرام مربوط ${TG_ICON} — ستصلك تذكيراتك على تيليجرام عند اختيارها.`
        : `${TG_ICON} <b>لتفعيل تذكير تيليجرام:</b> احفظ رقمك أعلاه، ثم افتح ${bot} واضغط «📱 مشاركة رقمي» لربط حسابك (مرّة واحدة).`;
    }
  }
  $('acctModalBack').classList.add('open');
}
function closeAccount() { $('acctModalBack').classList.remove('open'); }
(function () {
  const ab = $('accountBtn'); if (ab) ab.onclick = openAccount;
  const cl = $('acctClose'); if (cl) cl.onclick = closeAccount;
  const cc = $('acctCancel'); if (cc) cc.onclick = closeAccount;
  const eye = $('acctEye'); if (eye) eye.onclick = () => { const i = $('acctPw'); i.type = i.type === 'password' ? 'text' : 'password'; eye.textContent = i.type === 'password' ? '👁' : '🙈'; };
  const sv = $('acctSave');
  if (sv) sv.onclick = async () => {
    const body = { firstName: $('acctFirst').value.trim(), lastName: $('acctLast').value.trim(), phone: $('acctPhone').value.trim() };
    const pw = $('acctPw').value; if (pw) body.password = pw;
    sv.disabled = true; sv.textContent = '... حفظ';
    try {
      const res = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json(); if (!data.ok) throw new Error(data.error);
      if (data.user) { state.me.name = data.user.name; state.me.firstName = data.user.firstName; state.me.lastName = body.lastName; }
      state.me.phone = body.phone;
      toast('تم حفظ معلومات حسابك ✓'); closeAccount(); renderUser();
    } catch (e) { toast('تعذّر الحفظ: ' + e.message, true); }
    sv.disabled = false; sv.textContent = '💾 حفظ';
  };
})();

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
    $('pushBtn').classList.add('on');
    $('pushBtn').title = 'إشعارات المتصفح مُفعّلة';
    if (interactive) toast('تم تفعيل إشعارات المتصفح ✓');
  } catch (e) { if (interactive) toast('تعذّر تفعيل الإشعارات: ' + e.message, true); }
}
$('pushBtn').onclick = () => setupPush(true);
document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap')) $('bellPanel').classList.remove('open'); });
document.querySelectorAll('[data-shape]').forEach((tab) => {
  tab.onclick = () => { state.shape = tab.dataset.shape; render(); };
});
document.querySelectorAll('[data-data]').forEach((tab) => {
  tab.onclick = () => { state.dataType = tab.dataset.data; render(); };
});
document.addEventListener('click', (e) => { if (!e.target.closest('.ms')) document.querySelectorAll('.ms.open').forEach((x) => x.classList.remove('open')); });
let searchTimer;
$('fSearch').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 200); };
$('resetBtn').onclick = () => { Object.assign(state, { time: 'all', projects: [], owners: [], linked: [], priorities: [], statuses: [], types: [], search: '' }); $('fSearch').value = ''; render(); };
$('mClose').onclick = closeModal;
(function () { const c = $('mtgRemClose'); if (c) c.onclick = closeMeetingReminder; const b = $('mtgRemBack'); if (b) b.onclick = (e) => { if (e.target === b) closeMeetingReminder(); }; })();
// لا تُغلق نافذة المهمة بالنقر خارجها — فقط عبر زر ✕ (حفاظاً على التعديلات غير المحفوظة)

load();
setInterval(() => { if (!$('modalBack').classList.contains('open') && !$('mtgRemBack').classList.contains('open')) load(true); }, 30000);
