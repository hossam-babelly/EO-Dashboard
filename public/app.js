'use strict';

const state = {
  tasks: [],
  summary: {},
  filters: {},
  meta: {},
  me: null,
  view: 'table',
  time: 'all',
  project: '',
  owner: '',
  priority: '',
  status: '',
  search: '',
  sortKey: 'deadline',
  sortDir: 'asc',
  calY: null,
  calM: null, // 0-based
};

const STATUSES = ['لم تبدأ', 'قيد التنفيذ', 'منجزة', 'متوقفة'];
const PRIORITIES = ['حرجة', 'عالية', 'متوسطة'];
const $ = (id) => document.getElementById(id);

const TIME_CHIPS = [
  { key: 'all', label: 'الكل' },
  { key: 'today', label: 'اليوم' },
  { key: 'soon3', label: 'خلال ٣ أيام' },
  { key: 'week', label: 'هذا الأسبوع' },
  { key: 'overdue', label: 'متأخر' },
  { key: 'undated', label: 'بلا موعد' },
  { key: 'recurring', label: 'متكررة' },
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
    return 'آخر مزامنة: ' + new Date(iso).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
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
  if (state.project) list = list.filter((t) => (t.dept || t.project) === state.project);
  if (state.owner) list = list.filter((t) => t.owners.includes(state.owner));
  if (state.priority) list = list.filter((t) => t.priority === state.priority);
  if (state.status) list = list.filter((t) => t.status === state.status);
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
    if (key === 'project') return t.dept || t.project || '';
    if (key === 'owner') return t.owner || '';
    if (key === 'status') return t.status || '';
    return '';
  };
  return [...list].sort((a, b) => { const x = val(a), y = val(b); return x < y ? -dir : x > y ? dir : 0; });
}

// ===== Helpers =====
function priClass(p) { return PRIORITIES.includes(p) ? 'p-' + p : 'p-غير'; }
function stClass(s) { return s === 'منجزة' ? 'st-منجزة' : s === 'قيد التنفيذ' ? 'st-قيد' : s === 'متوقفة' ? 'st-متوقفة' : ''; }
function relText(t) {
  if (t.diffDays == null) return t.recurrence ? 'متكررة' : 'بلا موعد';
  if (t.diffDays < 0) return `متأخرة ${Math.abs(t.diffDays)} يوم`;
  if (t.diffDays === 0) return 'اليوم';
  if (t.diffDays === 1) return 'غداً';
  return `بعد ${t.diffDays} يوم`;
}

// ===== KPIs / chips / filters =====
function renderKpis() {
  const s = state.summary;
  const cards = [
    { key: 'all', cls: '', num: s.total, lbl: 'إجمالي المهام' },
    { key: 'today', cls: 'orange', num: s.today, lbl: 'مهام اليوم' },
    { key: 'overdue', cls: 'red', num: s.overdue, lbl: 'متأخرة' },
    { key: 'soon3', cls: 'orange', num: s.soon3, lbl: 'خلال ٣ أيام' },
    { key: 'week', cls: '', num: s.thisWeek, lbl: 'هذا الأسبوع' },
    { key: 'undated', cls: '', num: s.undated, lbl: 'بلا موعد' },
    { key: 'recurring', cls: '', num: s.recurring, lbl: 'متكررة' },
    { key: '_done', cls: 'green', num: (s.completion || 0) + '%', lbl: 'نسبة الإنجاز' },
  ];
  $('kpis').innerHTML = cards.map((c) => `
    <div class="kpi ${c.cls} ${state.time === c.key ? 'active' : ''}" data-time="${c.key}">
      <div class="num">${c.num}</div><div class="lbl">${c.lbl}</div></div>`).join('');
  $('kpis').querySelectorAll('.kpi').forEach((el) => {
    el.onclick = () => { const t = el.dataset.time; if (t === '_done') return; state.time = state.time === t ? 'all' : t; render(); };
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
function renderFilters() {
  fillSelect('fProject', state.filters.projects || [], state.project);
  fillSelect('fOwner', state.filters.owners || [], state.owner);
  fillSelect('fPriority', state.filters.priorities || [], state.priority);
  fillSelect('fStatus', state.filters.statuses || [], state.status);
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
      <td>${esc(t.dept || t.project)}${t.file ? `<div style="font-size:12px;color:var(--muted)">${esc(t.file)}</div>` : ''}</td>
      <td class="cell-owner">${esc(t.owner)}</td>
      <td><div class="deliv">${esc(t.deliverable)}</div></td>
      <td class="deadline-cell ${dlCls}"><span class="iso">${dl}</span><span class="rel">${relText(t)}</span></td>
      <td><span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span></td>
      <td><span class="badge st ${stClass(t.status)}">${esc(t.status)}</span></td></tr>`;
  }).join('');
  $('viewArea').innerHTML = `<div class="table-wrap"><table><thead><tr>
      <th data-sort="project">المشروع / الملف ${arrow('project')}</th>
      <th data-sort="owner">المسؤول ${arrow('owner')}</th>
      <th>المخرج المطلوب</th>
      <th data-sort="deadline">الموعد ${arrow('deadline')}</th>
      <th data-sort="priority">الأولوية ${arrow('priority')}</th>
      <th data-sort="status">الحالة ${arrow('status')}</th>
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
      <div class="kp">${esc(t.dept || t.project)}</div>
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
  const monthName = new Date(y, m, 1).toLocaleDateString('ar-SY', { month: 'long', year: 'numeric' });
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
      return `<div class="cal-task ${cls}" data-id="${t.id}" title="${esc(t.deliverable)}">${esc(t.dept || t.project)}</div>`;
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

// ===== Modal: view + edit =====
function openModal(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  $('mTitle').textContent = `${t.dept || t.project}${t.file ? ' — ' + t.file : ''}`;
  const F = (label, val) => val ? `<div class="field"><label>${label}</label><div class="val">${esc(val)}</div></div>` : '';
  $('mBody').innerHTML =
    F('المشروع / القسم / الشركة', t.dept || t.project) + F('الملف', t.file) + F('المسؤول المعني', t.owner) +
    F('المخرج المطلوب', t.deliverable) +
    `<div class="field"><label>الموعد / الدورية</label><div class="val">${esc(t.deadlineRaw || '—')} <span style="color:var(--muted)">(${relText(t)})</span></div></div>` +
    `<div class="field"><label>الأولوية</label><div class="val"><span class="badge ${priClass(t.priority)}">${esc(t.priority)}</span></div></div>` +
    `<div class="field"><label>الحالة</label><div class="val"><span class="badge st ${stClass(t.status)}">${esc(t.status)}</span></div></div>` +
    F('نتائج المتابعة اليومية', t.followup) + F('مصدر المهمة', t.source) + F('ملاحظات', t.notes);
  $('mFoot').innerHTML = canEdit() ? `<button class="btn btn-edit" id="mEdit">✏️ تعديل</button>` : '';
  if (canEdit()) $('mEdit').onclick = () => openEdit(t);
  $('modalBack').classList.add('open');
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

function openEdit(t) {
  const isNew = !t;
  t = t || { project: '', dept: '', file: '', owner: '', deliverable: '', deadlineRaw: '', priority: 'متوسطة', status: 'لم تبدأ', followup: '', source: '', notes: '' };
  $('mTitle').textContent = isNew ? 'إضافة مهمة جديدة' : 'تعديل المهمة';
  $('mBody').innerHTML = `<form id="taskForm">
    <div class="form-row">${field('المشروع / القسم / الشركة', 'dept', t.dept || t.project)}${field('الملف', 'file', t.file)}</div>
    ${field('المسؤول المعني (افصل بسطر لكل شخص)', 'owner', t.owner)}
    ${textarea('المخرج المطلوب', 'deliverable', t.deliverable)}
    <div class="form-row">${field('الموعد / الدورية', 'deadlineRaw', t.deadlineRaw)}${selectField('الأولوية', 'priority', PRIORITIES, t.priority)}</div>
    ${selectField('الحالة', 'status', STATUSES, t.status)}
    ${textarea('نتائج المتابعة اليومية', 'followup', t.followup)}
    <div class="form-row">${field('مصدر المهمة', 'source', t.source)}${field('ملاحظات', 'notes', t.notes)}</div>
  </form>`;
  $('mFoot').innerHTML = `<button class="btn btn-save" id="mSave">💾 حفظ</button><button class="btn btn-cancel" id="mCancel">إلغاء</button>`;
  $('mSave').onclick = () => saveTask(isNew ? null : t.id);
  $('mCancel').onclick = () => (isNew ? closeModal() : openModal(t.id));
  $('modalBack').classList.add('open');
}

async function saveTask(id) {
  const form = $('taskForm');
  const payload = {};
  new FormData(form).forEach((v, k) => { payload[k] = v; });
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
          <div class="bp-t">${esc(t.dept || t.project)}</div>
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
  if (state.view === 'kanban') renderKanban();
  else if (state.view === 'calendar') renderCalendar();
  else renderTable();
}

async function load(refresh = false) {
  try {
    if (!state.me) await fetchMe();
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
document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.view-tab').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active'); state.view = tab.dataset.view; render();
  };
});
$('fProject').onchange = (e) => { state.project = e.target.value; render(); };
$('fOwner').onchange = (e) => { state.owner = e.target.value; render(); };
$('fPriority').onchange = (e) => { state.priority = e.target.value; render(); };
$('fStatus').onchange = (e) => { state.status = e.target.value; render(); };
let searchTimer;
$('fSearch').oninput = (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value; render(); }, 200); };
$('resetBtn').onclick = () => { Object.assign(state, { time: 'all', project: '', owner: '', priority: '', status: '', search: '' }); $('fSearch').value = ''; render(); };
$('mClose').onclick = closeModal;
$('modalBack').onclick = (e) => { if (e.target === $('modalBack')) closeModal(); };

load();
setInterval(() => { if (!$('modalBack').classList.contains('open')) load(true); }, 30000);
