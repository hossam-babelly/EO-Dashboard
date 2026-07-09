'use strict';
/* توليد تقارير (Word / Excel / PDF) للمهام المعروضة حالياً — بهوية سنكري وشعارها.
   يعتمد على المتغيّرات/الدوال العامة من app.js: state, applyFilters, sortList, esc, parseFollowup, fuShort, TIME_CHIPS, toast */

// هوية التقرير: مصمتة/طباعية دائماً (لا تتبع الوضع الداكن ولا الشفافية — لسلامة html2canvas).
// لكل تصميم لوحة صلبة تُطبَّق على RB عند بدء كل توليد عبر applyReportTheme().
let RB = { ink: '#211d1a', copper: '#bd6a43', copperDeep: '#a4572f', champagne: '#d8c4b0', cream: '#f7f2ea', line: '#e7ddcf', red: '#b4453c', green: '#5f7457', amber: '#c0822f', muted: '#8a8175' };
const RB_THEMES = {
  classic: { ink: '#211d1a', copper: '#bd6a43', copperDeep: '#a4572f', champagne: '#d8c4b0', cream: '#f7f2ea', line: '#e7ddcf', red: '#b4453c', green: '#5f7457', amber: '#c0822f', muted: '#8a8175' },
  wing: { ink: '#211C18', copper: '#B8603C', copperDeep: '#8A4527', champagne: '#DEC7B4', cream: '#F3E9DF', line: '#E3D6C6', red: '#B4453C', green: '#5E7A55', amber: '#C0822F', muted: '#8A7E72' },
  bp: { ink: '#2C2F31', copper: '#B0582F', copperDeep: '#43474A', champagne: '#AEB4B6', cream: '#ECECE4', line: '#D2D1C8', red: '#B0463A', green: '#4C7150', amber: '#B07C2C', muted: '#6E6E66' },
  marsad: { ink: '#14181C', copper: '#B8603C', copperDeep: '#39424A', champagne: '#9BA6AE', cream: '#EEF1F3', line: '#DCE2E6', red: '#B0463A', green: '#4C7150', amber: '#B07C2C', muted: '#66727B' },
  horizon: { ink: '#101828', copper: '#0F9BA8', copperDeep: '#0B7D89', champagne: '#B9C6D2', cream: '#F3F5F9', line: '#E3E8EF', red: '#D6493E', green: '#17936B', amber: '#C77E1E', muted: '#667085' },
  pearl: { ink: '#221E1A', copper: '#B8603C', copperDeep: '#9A4E30', champagne: '#DECFBB', cream: '#F7F2EA', line: '#E8DFD2', red: '#C24A3F', green: '#3E8E5F', amber: '#C0822F', muted: '#7A7268' },
};
// مفتاح «لون التصميم» على التقرير (ألوان مصمتة): يُطبَّق فوق لوحة التصميم
const RB_ACCENTS = { teal: { copper: '#0F9BA8', copperDeep: '#0B7D89' }, sankari: { copper: '#B8603C', copperDeep: '#9A4E30' } };
function activeReportDesign() {
  try { return (window.THEME && window.THEME.design && window.THEME.design()) || document.documentElement.getAttribute('data-style') || 'classic'; }
  catch (_) { return 'classic'; }
}
function activeReportAccent() {
  // الاختيار الصريح فقط (بلا اختيار: كل تصميم يبقى بلوحته الافتراضية — الأفق تركوازي أصلاً)
  try { return localStorage.getItem('eo_accent') || ''; }
  catch (_) { return ''; }
}
function applyReportTheme() {
  const d = activeReportDesign();
  if (d !== 'custom') { RB = Object.assign({}, RB_THEMES[d] || RB_THEMES.classic); }
  else {
    // المخصّص: ركّب لوحة التقرير من مفاصل المستخدم (كلها لوحات فاتحة مصمتة)
    let ch = {}; try { ch = JSON.parse(localStorage.getItem('eo_custom') || '{}') || {}; } catch (_) { ch = {}; }
    const base = ['classic', 'wing', 'bp', 'marsad', 'horizon', 'pearl'];
    const pick = (f) => RB_THEMES[base.indexOf(ch[f]) >= 0 ? ch[f] : 'wing'] || RB_THEMES.classic;
    const surf = pick('surfaces'), acc = pick('accent'), st = pick('states'), top = pick('topbar');
    RB = { ink: top.ink, copper: acc.copper, copperDeep: acc.copperDeep, champagne: top.champagne, cream: surf.cream, line: surf.line, red: st.red, green: st.green, amber: st.amber, muted: surf.muted };
  }
  // تجاوز اللون الصريح إن اختاره المستخدم
  const a = activeReportAccent();
  if (a && RB_ACCENTS[a]) Object.assign(RB, RB_ACCENTS[a]);
}

const REPORT_COLS = [
  { k: 'i', label: '#', w: 4 },
  { k: 'project', label: 'المشروع', w: 15 },
  { k: 'file', label: 'الملف', w: 13 },
  { k: 'type', label: 'النوع', w: 11 },
  { k: 'linkedTo', label: 'مرتبط بـ', w: 13 },
  { k: 'owner', label: 'المسؤول المعني', w: 14 },
  { k: 'deliverable', label: 'المخرج المطلوب', w: 28 },
  { k: 'deadline', label: 'الموعد', w: 11 },
  { k: 'priority', label: 'الأولوية', w: 9 },
  { k: 'status', label: 'الحالة', w: 11 },
  { k: 'followup', label: 'آخر متابعة', w: 24 },
  { k: 'notes', label: 'ملاحظات', w: 16 },
];

function reportTasks() { return sortList(applyFilters()); }

function reportRow(t, i) {
  const evs = parseFollowup(t.followup, t.log);
  const last = evs.length ? evs[evs.length - 1] : null;
  const fu = last ? (last.text || '') : '';
  const fuMeta = last && !last.manual ? (last.author + ' · ' + fuShort(last.date, last.time)) : '';
  return {
    fuMeta,
    i: i + 1,
    project: t.project || '',
    file: t.file || '',
    type: t.type || '—',
    linkedTo: t.linkedTo || '',
    owner: (t.owner || '').replace(/\n+/g, '، '),
    deliverable: t.deliverable || '',
    deadline: t.deadlineIso || t.deadlineRaw || '—',
    priority: t.priority || '',
    status: t.status || '',
    followup: fu,
    notes: t.notes || '',
  };
}

function reportFiltersText() {
  const f = [];
  if (state.time && state.time !== 'all') { const c = TIME_CHIPS.find((x) => x.key === state.time); if (c) f.push('النطاق: ' + c.label); }
  if (state.projects.length) f.push('المشاريع: ' + state.projects.join('، '));
  if (state.owners.length) f.push('المسؤولون: ' + state.owners.join('، '));
  if (state.types.length) f.push('الأنواع: ' + state.types.map((x) => x === '__none__' ? 'بلا نوع' : x).join('، '));
  if (state.priorities.length) f.push('الأولويات: ' + state.priorities.join('، '));
  if (state.statuses.length) f.push('الحالات: ' + state.statuses.join('، '));
  if (state.search) f.push('بحث: «' + state.search + '»');
  return f.length ? f.join('  •  ') : 'كل المهام (بلا فلاتر)';
}

function nowText() {
  try { return new Date().toLocaleString('ar-SY-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }); }
  catch { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
}

let _logoData = null;
async function logoDataUrl() {
  if (_logoData) return _logoData;
  try {
    const blob = await (await fetch('/assets/logo-horizontal.png')).blob();
    _logoData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch { _logoData = ''; }
  return _logoData;
}

function dl(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function reportName() {
  const el = document.getElementById('reportName');
  const v = el ? String(el.value || '').trim() : '';
  return (v || 'تقرير-المهام').replace(/[\\/:*?"<>|]+/g, '_');
}
function priColor(p) { return p === 'حرجة' ? RB.red : p === 'عالية' ? RB.amber : RB.copperDeep; }
function stColor(s) { return s === 'منجزة' ? RB.green : s === 'متوقفة' ? RB.red : s === 'قيد التنفيذ' ? RB.copperDeep : RB.muted; }

// الأعمدة المختارة من النافذة (الكل افتراضياً)
function activeCols() {
  const checked = [...document.querySelectorAll('#reportCols input:checked')].map((i) => i.value);
  return checked.length ? REPORT_COLS.filter((c) => checked.includes(c.k)) : REPORT_COLS.slice();
}

// ===== بناء التقرير (صفحات بترويسة مكرّرة، مهام كاملة لكل صفحة) =====
// يُصغّر الشعار فعلياً إلى صورة بحجم العرض (حتى يحترم Word حجمه الأصلي الصغير)
let _logo = null;
async function logoSmall(targetH) {
  if (_logo) return _logo;
  const url = await logoDataUrl();
  if (!url) { _logo = { url: '', w: 0, h: 0 }; return _logo; }
  const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  if (!img || !img.naturalWidth) { _logo = { url, w: targetH * 4, h: targetH }; return _logo; }
  const h = targetH, w = Math.round(h * img.naturalWidth / img.naturalHeight);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  _logo = { url: cv.toDataURL('image/png'), w, h };
  return _logo;
}

function headerBlock(logo, count) {
  const img = logo && logo.url ? `<img src="${logo.url}" width="${logo.w}" height="${logo.h}" style="width:${logo.w}px;height:${logo.h}px">` : '';
  return `<div class="rpt-h" style="background:${RB.ink};padding:14px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid ${RB.copper}">
      <div>
        <div style="font-size:20px;font-weight:800;color:#fff">تقرير المهام</div>
        <div style="font-size:12.5px;color:${RB.champagne};margin-top:3px">الإدارة التنفيذية — مجموعة سنكري القابضة</div>
      </div>${img}
    </div>
    <div class="rpt-m" style="padding:9px 24px;background:${RB.cream};border-bottom:1px solid ${RB.line};font-size:12px;color:${RB.copperDeep}">
      <b>تاريخ التقرير:</b> ${esc(nowText())} &nbsp;•&nbsp; <b>عدد المهام:</b> ${count}
    </div>`;
}

function rowHTML(COLS, r, gi) {
  return `<tr style="background:${gi % 2 ? '#faf5ee' : '#ffffff'};page-break-inside:avoid">${COLS.map((c) => {
    let v = esc(String(r[c.k]));
    let style = `padding:7px 6px;font-size:11.5px;border:1px solid ${RB.line};vertical-align:top;text-align:right`;
    if (c.k === 'deliverable' || c.k === 'followup' || c.k === 'owner' || c.k === 'linkedTo') style += ';white-space:pre-line';
    if (c.k === 'priority') v = `<span style="color:${priColor(r.priority)};font-weight:700">${v}</span>`;
    if (c.k === 'status') v = `<span style="color:${stColor(r.status)};font-weight:700">${v}</span>`;
    if (c.k === 'followup' && r.fuMeta) v = `${esc(String(r.followup || ''))}<div style="color:${RB.copper};font-size:10.5px;margin-top:4px">${esc(r.fuMeta)}</div>`;
    if (c.k === 'i') style += ';text-align:center;color:' + RB.muted;
    return `<td style="${style}">${v}</td>`;
  }).join('')}</tr>`;
}

function tableHTML(COLS, bodyHtml) {
  const totalW = COLS.reduce((s, c) => s + c.w, 0);
  const cg = `<colgroup>${COLS.map((c) => `<col style="width:${(c.w / totalW * 100).toFixed(2)}%">`).join('')}</colgroup>`;
  const th = COLS.map((c) => `<th style="background:${RB.ink};color:${RB.champagne};padding:8px 6px;font-size:12px;border:1px solid ${RB.copperDeep};text-align:right">${esc(c.label)}</th>`).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid ${RB.copperDeep};table-layout:fixed">${cg}<thead><tr>${th}</tr></thead><tbody>${bodyHtml || `<tr><td colspan="${COLS.length}" style="padding:20px;text-align:center;color:${RB.muted}">لا توجد مهام مطابقة.</td></tr>`}</tbody></table>`;
}

function pageHTML(COLS, logo, count, bodyHtml, isFirst) {
  return `<div class="rpt-page" dir="rtl" style="width:100%;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink};${isFirst ? '' : 'page-break-before:always;'}">
    ${headerBlock(logo, count)}
    <div style="padding:12px 24px 4px">${tableHTML(COLS, bodyHtml)}</div>
    <div style="padding:0 24px 10px;font-size:10px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — الإدارة التنفيذية</div>
  </div>`;
}

// يقيس ارتفاعات الصفوف ويوزّعها على صفحات بحيث لا تُقسَّم مهمة بين صفحتين
async function paginate(rows, COLS, logo) {
  const m = document.createElement('div');
  m.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;visibility:hidden';
  m.innerHTML = pageHTML(COLS, logo, rows.length, rows.map((r, i) => rowHTML(COLS, r, i)).join(''), true);
  document.body.appendChild(m);
  try { await document.fonts.ready; } catch { /* تجاهل */ }
  const page = m.firstElementChild;
  const tableEl = m.querySelector('table');
  const topArea = tableEl.getBoundingClientRect().top - page.getBoundingClientRect().top;
  const theadH = m.querySelector('thead').offsetHeight;
  const hts = [...m.querySelectorAll('tbody tr')].map((tr) => tr.offsetHeight);
  m.remove();
  // ارتفاع صفحة A4 العرضية المطبوعة ≈ 715px عند 96dpi (مع هوامش 1سم) — متحفّظ ليتّسع في PDF و Word
  const PAGE_H = 705, FOOTER = 34;
  const avail = Math.max(120, PAGE_H - topArea - theadH - FOOTER);
  const chunks = []; let cur = [], used = 0;
  for (let i = 0; i < rows.length; i++) {
    const h = hts[i] || 24;
    if (cur.length && used + h > avail) { chunks.push(cur); cur = []; used = 0; }
    cur.push(rows[i]); used += h;
  }
  if (cur.length) chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

// ===== شكل التقرير: جدول (افتراضي) / كانبان / تقويم =====
// التقرير يتبع العرض الحالي: نوع المعلومات (مهام/اجتماعات) + شكلها (جدول/كانبان/تقويم)
function curShape() { return (typeof state !== 'undefined' && state.shape) || 'table'; }
function curData() { return (typeof state !== 'undefined' && state.dataType) || 'tasks'; }
function meetReportRows() { return (typeof meetingRows === 'function') ? meetingRows() : []; }
function hasReportData() { return curData() === 'meetings' ? meetReportRows().length : reportTasks().length; }
const M_STATUS_R = { required: 'مطلوب', scheduled: 'مجدول', done: 'تم' };
function rptWrap(inner, logo, count) {
  return `<div class="rpt-page" dir="rtl" style="width:100%;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink}">${headerBlock(logo, count)}${inner}<div style="padding:0 24px 10px;font-size:10px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — الإدارة التنفيذية</div></div>`;
}
function tdCss() { return `padding:7px 6px;font-size:11.5px;border:1px solid ${RB.line};vertical-align:top;text-align:right;white-space:pre-line`; }

// جدول الاجتماعات
function meetingsTableHTML(rows, logo) {
  const th = ['اسم الاجتماع', 'المشروع', 'الملف', 'المسؤول', 'موعد الاجتماع', 'حالة الاجتماع'];
  const head = th.map((h) => `<th style="background:${RB.ink};color:${RB.champagne};padding:8px 6px;font-size:12px;border:1px solid ${RB.copperDeep};text-align:right">${esc(h)}</th>`).join('');
  const body = rows.map((r, i) => `<tr style="background:${i % 2 ? '#faf5ee' : '#fff'};page-break-inside:avoid">
      <td style="${tdCss()};font-weight:700;color:${RB.copperDeep}">🤝 ${esc(r.m.title)}</td>
      <td style="${tdCss()}">${esc(r.t.project)}</td>
      <td style="${tdCss()}">${esc(r.t.file)}</td>
      <td style="${tdCss()}">${esc(r.t.owner)}</td>
      <td style="${tdCss()}">${r.m.status === 'scheduled' ? esc(r.m.datetime || '') : '—'}</td>
      <td style="${tdCss()};font-weight:700">${M_STATUS_R[r.m.status] || ''}</td></tr>`).join('') || `<tr><td colspan="6" style="${tdCss()};text-align:center;color:${RB.muted}">لا اجتماعات</td></tr>`;
  return rptWrap(`<div style="padding:12px 24px 4px"><table style="width:100%;border-collapse:collapse;border:1px solid ${RB.copperDeep}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`, logo, rows.length);
}
// كانبان الاجتماعات
function meetingsKanbanHTML(rows, logo) {
  const cols = ['required', 'scheduled', 'done'];
  const by = { required: [], scheduled: [], done: [] };
  rows.forEach((r) => { (by[r.m.status] || by.required).push(r); });
  const card = (r) => `<div style="border:1px solid ${RB.line};border-inline-start:4px solid ${RB.copper};border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#fff">
      <div style="font-weight:800;color:${RB.ink};font-size:12.5px;margin-bottom:4px">🤝 ${esc(r.m.title)}</div>
      <div style="font-size:11.5px;color:${RB.ink}">${esc(r.t.project)}${r.t.file ? ' — ' + esc(r.t.file) : ''}</div>
      <div style="font-size:11px;color:${RB.muted};margin-top:4px">${r.m.status === 'scheduled' ? esc(r.m.datetime || '') + ' · ' : ''}${esc((r.t.owner || '').split('\n')[0])}</div></div>`;
  const colHtml = cols.map((s) => `<div style="flex:1;min-width:0;background:#faf6f0;border:1px solid ${RB.line};border-radius:10px;padding:8px">
      <div style="font-weight:800;color:${RB.ink};padding:6px 4px;border-bottom:2px solid ${RB.copper};margin-bottom:8px;display:flex;justify-content:space-between"><span>${M_STATUS_R[s]}</span><span style="color:${RB.copper}">${by[s].length}</span></div>
      ${by[s].map(card).join('') || `<div style="color:${RB.muted};font-size:11px;text-align:center;padding:10px">—</div>`}</div>`).join('');
  return rptWrap(`<div style="display:flex;gap:10px;padding:14px 18px;align-items:flex-start">${colHtml}</div>`, logo, rows.length);
}
// تقويم الاجتماعات (المجدولة فقط)
function meetingsCalendarHTML(rows, logo) {
  rows = rows.filter((r) => r.m.status === 'scheduled' && r.m.datetime);
  let y = state.calY, m = state.calM;
  if (y == null) { const d = new Date(); y = d.getFullYear(); m = d.getMonth(); }
  const monthName = new Date(y, m, 1).toLocaleDateString('ar-SY-u-nu-latn', { month: 'long', year: 'numeric' });
  const startDow = (new Date(y, m, 1).getDay() + 1) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  rows.forEach((r) => { const [ty, tm, td] = r.m.datetime.slice(0, 10).split('-').map(Number); if (ty === y && tm === m + 1) (byDay[td] || (byDay[td] = [])).push(r); });
  const dows = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  let cells = dows.map((d) => `<div style="text-align:center;font-weight:800;color:${RB.muted};font-size:11px;padding:4px">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const items = (byDay[d] || []).map((r) => `<div style="font-size:9.5px;background:${RB.copper};color:#fff;border-radius:4px;padding:2px 4px;margin-bottom:2px;overflow:hidden;line-height:1.35"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🤝 ${esc(r.m.title)}</div><div style="opacity:.9">${esc((r.m.datetime || '').slice(11))} · ${esc(r.t.project)}</div></div>`).join('');
    cells += `<div style="border:1px solid ${RB.line};border-radius:6px;min-height:62px;padding:4px"><div style="font-size:10px;font-weight:800;color:${RB.muted};margin-bottom:2px">${d}</div>${items}</div>`;
  }
  return rptWrap(`<div style="text-align:center;font-size:16px;font-weight:800;color:${RB.ink};padding:10px">${esc(monthName)}</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;padding:0 18px 14px">${cells}</div>`, logo, rows.length);
}

// اختيار قالب HTML حسب العرض الحالي (لكل الأشكال عدا جدول المهام الذي له مسار مرقّم خاص)
function buildLayoutHTML(logo) {
  const shape = curShape(), data = curData();
  if (data === 'meetings') {
    const rows = meetReportRows();
    if (shape === 'kanban') return meetingsKanbanHTML(rows, logo);
    if (shape === 'calendar') return meetingsCalendarHTML(rows, logo);
    return meetingsTableHTML(rows, logo);
  }
  const rows = reportTasks();
  if (shape === 'kanban') return kanbanHTML(rows, logo);
  return calendarHTML(rows, logo);
}

// تحويل عنصر HTML إلى canvas (للكانبان/التقويم)
async function renderHtmlCanvas(html) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;background:#fff';
  el.innerHTML = html;
  document.body.appendChild(el);
  try { await document.fonts.ready; } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 40));
  const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1040 });
  el.remove();
  return canvas;
}

// إضافة canvas (قد يكون طويلاً) إلى PDF موزّعاً على عدّة صفحات
function addCanvasPaged(pdf, canvas, firstPage) {
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  const fullH = canvas.width ? canvas.height * pw / canvas.width : 0;
  if (fullH <= ph + 1) {
    if (!firstPage) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, fullH);
    return;
  }
  const sliceHpx = Math.floor(canvas.width * ph / pw); // ارتفاع الشريحة بالبكسل لكل صفحة
  let y = 0, first = firstPage;
  while (y < canvas.height) {
    const h = Math.min(sliceHpx, canvas.height - y);
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = h;
    c.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (!first) pdf.addPage(); first = false;
    pdf.addImage(c.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, h * pw / canvas.width);
    y += h;
  }
}

// بناء صفحة كانبان (أعمدة حسب الحالة)
function kanbanHTML(rows, logo) {
  const byStatus = {};
  STATUSES.forEach((s) => { byStatus[s] = []; });
  rows.forEach((t) => { (byStatus[t.status] || (byStatus[t.status] = [])).push(t); });
  const card = (t) => `<div style="border:1px solid ${RB.line};border-inline-start:4px solid ${priColor(t.priority)};border-radius:8px;padding:8px 10px;margin-bottom:8px;background:#fff">
      <div style="font-weight:800;color:${RB.ink};font-size:12.5px;margin-bottom:4px">${esc(t.project)}</div>
      <div style="font-size:11.5px;color:${RB.ink};margin-bottom:5px">${esc((t.deliverable || '').slice(0, 90))}${(t.deliverable || '').length > 90 ? '…' : ''}</div>
      <div style="font-size:11px;color:${RB.muted};display:flex;justify-content:space-between;gap:6px"><span>${esc((t.owner || '').split('\n')[0])}</span><span>${esc(t.deadlineIso || t.deadlineRaw || '')}</span></div>
    </div>`;
  const colHtml = STATUSES.map((s) => `<div style="flex:1;min-width:0;background:#faf6f0;border:1px solid ${RB.line};border-radius:10px;padding:8px">
      <div style="font-weight:800;color:${RB.ink};padding:6px 4px;border-bottom:2px solid ${RB.copper};margin-bottom:8px;display:flex;justify-content:space-between"><span>${esc(s)}</span><span style="color:${RB.copper}">${byStatus[s].length}</span></div>
      ${byStatus[s].map(card).join('') || `<div style="color:${RB.muted};font-size:11px;text-align:center;padding:10px">—</div>`}
    </div>`).join('');
  return `<div class="rpt-page" dir="rtl" style="width:100%;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink}">
      ${headerBlock(logo, rows.length)}
      <div style="display:flex;gap:10px;padding:14px 18px;align-items:flex-start">${colHtml}</div>
      <div style="padding:0 24px 10px;font-size:10px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — الإدارة التنفيذية</div>
    </div>`;
}

// بناء صفحة تقويم (الشهر المعروض حالياً) — المهام المؤرّخة فقط
function calendarHTML(rows, logo) {
  let y = state.calY, m = state.calM;
  if (y == null) { const d = new Date(); y = d.getFullYear(); m = d.getMonth(); }
  const monthName = new Date(y, m, 1).toLocaleDateString('ar-SY-u-nu-latn', { month: 'long', year: 'numeric' });
  const startDow = (new Date(y, m, 1).getDay() + 1) % 7;
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  rows.forEach((t) => { if (!t.deadlineIso) return; const [ty, tm, td] = t.deadlineIso.split('-').map(Number); if (ty === y && tm === m + 1) (byDay[td] || (byDay[td] = [])).push(t); });
  const dows = ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
  let cells = dows.map((d) => `<div style="text-align:center;font-weight:800;color:${RB.muted};font-size:11px;padding:4px">${d}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const items = (byDay[d] || []).map((t) => `<div style="font-size:9.5px;background:${t.priority === 'حرجة' ? RB.red : t.priority === 'عالية' ? RB.amber : RB.copperDeep};color:#fff;border-radius:4px;padding:2px 4px;margin-bottom:2px;overflow:hidden;line-height:1.35"><div style="font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.project)}</div>${t.file ? `<div style="opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.file)}</div>` : ''}</div>`).join('');
    cells += `<div style="border:1px solid ${RB.line};border-radius:6px;min-height:62px;padding:4px;vertical-align:top"><div style="font-size:10px;font-weight:800;color:${RB.muted};margin-bottom:2px">${d}</div>${items}</div>`;
  }
  return `<div class="rpt-page" dir="rtl" style="width:100%;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink}">
      ${headerBlock(logo, rows.length)}
      <div style="text-align:center;font-size:16px;font-weight:800;color:${RB.ink};padding:10px">${esc(monthName)}</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;padding:0 18px 14px">${cells}</div>
      <div style="padding:0 24px 10px;font-size:10px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — الإدارة التنفيذية</div>
    </div>`;
}

async function exportLayoutPDF() {
  const logo = await logoSmall(34);
  const canvas = await renderHtmlCanvas(buildLayoutHTML(logo));
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  addCanvasPaged(pdf, canvas, true);
  pdf.save(reportName() + '.pdf');
}

async function exportLayoutWord() {
  const logo = await logoSmall(34);
  const canvas = await renderHtmlCanvas(buildLayoutHTML(logo));
  const DOC_W = 1040, h = Math.round(DOC_W * canvas.height / canvas.width);
  const img = `<div><img src="${canvas.toDataURL('image/jpeg', 0.95)}" width="${DOC_W}" height="${h}"></div>`;
  const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>تقرير المهام</title>`
    + `<style>@page Section1 { size: 841.95pt 595.35pt; mso-page-orientation: landscape; margin: 0.6cm; } div.Section1 { page: Section1; } body { margin: 0; }</style>`
    + `</head><body><div class='Section1'>${img}</div></body></html>`;
  dl(new Blob(['﻿', doc], { type: 'application/msword' }), reportName() + '.doc');
}

// PDF: نرسم كل صفحة كصورة مستقلّة ونضيفها لصفحة PDF — لا قصّ، مهام كاملة، ترويسة مكرّرة
async function exportPDF() {
  if (!(curData() === 'tasks' && curShape() === 'table')) return exportLayoutPDF();
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const logo = await logoSmall(34);
  const chunks = await paginate(rows, COLS, logo);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pw = pdf.internal.pageSize.getWidth();
  let gi = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;background:#fff';
    el.innerHTML = pageHTML(COLS, logo, rows.length, chunks[ci].map((r) => rowHTML(COLS, r, gi++)).join(''), true);
    document.body.appendChild(el);
    try { await document.fonts.ready; } catch { /* تجاهل */ }
    await new Promise((r) => setTimeout(r, 40));
    const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1040 });
    el.remove();
    if (ci > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, canvas.height * pw / canvas.width);
  }
  pdf.save(reportName() + '.pdf');
}

// Word: نضع نفس صور صفحات الـ PDF (كل صفحة صورة كاملة) فيصبح مطابقاً للـ PDF بصرياً
async function exportWord() {
  if (!(curData() === 'tasks' && curShape() === 'table')) return exportLayoutWord();
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const logo = await logoSmall(34);
  const chunks = rows.length ? await paginate(rows, COLS, logo) : [[]];
  const DOC_W = 1040; // عرض الصورة في الصفحة (≈ عرض A4 العرضية)
  let gi = 0;
  const imgs = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;background:#fff';
    el.innerHTML = pageHTML(COLS, logo, rows.length, chunks[ci].map((r) => rowHTML(COLS, r, gi++)).join(''), true);
    document.body.appendChild(el);
    try { await document.fonts.ready; } catch { /* تجاهل */ }
    await new Promise((r) => setTimeout(r, 40));
    const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1040 });
    el.remove();
    imgs.push({ src: canvas.toDataURL('image/jpeg', 0.95), h: Math.round(DOC_W * canvas.height / canvas.width) });
  }
  const pagesHtml = imgs.map((im, i) => `<div style="${i > 0 ? 'page-break-before:always;' : ''}"><img src="${im.src}" width="${DOC_W}" height="${im.h}"></div>`).join('');
  const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>تقرير المهام</title>`
    + `<style>@page Section1 { size: 841.95pt 595.35pt; mso-page-orientation: landscape; margin: 0.6cm; } div.Section1 { page: Section1; } body { margin: 0; }</style>`
    + `</head><body><div class='Section1'>${pagesHtml}</div></body></html>`;
  dl(new Blob(['﻿', doc], { type: 'application/msword' }), reportName() + '.doc');
}

async function exportExcel() {
  if (!(curData() === 'tasks' && curShape() === 'table')) { toast('تصدير Excel متاح لجدول المهام فقط', true); return; }
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المهام', { views: [{ rightToLeft: true, showGridLines: false }] });
  ws.columns = COLS.map((c) => ({ key: c.k, width: c.w }));
  const last = COLS.length;
  const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const L = colLetter(last);

  // ترويسة + شعار
  ws.mergeCells(`A1:${L}1`); ws.mergeCells(`A2:${L}2`); ws.mergeCells(`A3:${L}3`); ws.mergeCells(`A4:${L}4`);
  const titleCell = ws.getCell('A1');
  titleCell.value = 'تقرير المهام — الإدارة التنفيذية | مجموعة سنكري القابضة';
  titleCell.font = { name: 'Cairo', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ['A1', 'A2', 'A3', 'A4'].forEach((a) => { ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF211D1A' } }; });
  ws.getRow(1).height = 34;
  const meta1 = ws.getCell('A2'); meta1.value = 'تاريخ التقرير: ' + nowText() + '   •   عدد المهام: ' + rows.length;
  meta1.font = { name: 'Cairo', size: 10, color: { argb: 'FFD8C4B0' } }; meta1.alignment = { horizontal: 'right', indent: 1 };
  ws.getRow(3).height = 6;
  ws.getRow(4).height = 6;

  const lg = await logoSmall(38);
  if (lg.url) { try { const id = wb.addImage({ base64: lg.url, extension: 'png' }); ws.addImage(id, { tl: { col: last - 2.0, row: 0.15 }, ext: { width: lg.w, height: lg.h } }); } catch { /* تجاهل */ } }

  // صفّ العناوين
  const hdrRowIdx = 5;
  const hdr = ws.getRow(hdrRowIdx);
  COLS.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.value = c.label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBD6A43' } };
    cell.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFA4572F' } } };
  });
  hdr.height = 22;

  // الصفوف
  rows.forEach((r, idx) => {
    const row = ws.getRow(hdrRowIdx + 1 + idx);
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.k === 'followup' && r.fuMeta) cell.value = { richText: [{ text: String(r.followup || '') + '\n' }, { text: r.fuMeta, font: { color: { argb: 'FFBD6A43' }, name: 'Cairo', size: 9 } }] };
      else cell.value = r[c.k];
      cell.alignment = { horizontal: c.k === 'i' ? 'center' : 'right', vertical: 'top', wrapText: true };
      cell.font = { name: 'Cairo', size: 10, color: { argb: 'FF2B2823' } };
      if (idx % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5EE' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE7DDCF' } } };
      if (c.k === 'priority') cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: r.priority === 'حرجة' ? 'FFB4453C' : r.priority === 'عالية' ? 'FFC0822F' : 'FFA4572F' } };
      if (c.k === 'status') cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: r.status === 'منجزة' ? 'FF5F7457' : r.status === 'متوقفة' ? 'FFB4453C' : 'FF8A8175' } };
    });
  });
  ws.autoFilter = { from: { row: hdrRowIdx, column: 1 }, to: { row: hdrRowIdx, column: last } };

  const buf = await wb.xlsx.writeBuffer();
  dl(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), reportName() + '.xlsx');
}

function runExport(btn, fn, label) {
  return async () => {
    applyReportTheme(); // لوحة ألوان التقرير حسب التصميم الفعّال
    const o = btn.textContent; btn.disabled = true; btn.textContent = '... ' + label;
    try { await fn(); toast('تم توليد ' + label + ' ✓'); }
    catch (e) { toast('تعذّر التوليد: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = o; }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const colsBox = document.getElementById('reportCols');
  if (colsBox) colsBox.innerHTML = REPORT_COLS.map((c) => `<label class="rep-col"><input type="checkbox" value="${c.k}" checked> ${esc(c.label)}</label>`).join('');
  const open = document.getElementById('reportBtn');
  const back = document.getElementById('reportModalBack');
  const close = () => back && back.classList.remove('open');
  const colsWrap = document.getElementById('reportColsWrap');
  const excelBtnEl = document.getElementById('reportExcel');
  const info = document.getElementById('reportViewInfo');
  const SHAPE_AR = { table: 'جدول', kanban: 'كانبان', calendar: 'تقويم' };
  if (open && back) open.onclick = () => {
    if (!hasReportData()) { toast('لا توجد بيانات معروضة لتوليد التقرير', true); return; }
    // التقرير يتبع العرض الحالي؛ الأعمدة و Excel لجدول المهام فقط
    const isTaskTable = curData() === 'tasks' && curShape() === 'table';
    if (colsWrap) colsWrap.style.display = isTaskTable ? '' : 'none';
    if (excelBtnEl) excelBtnEl.style.display = isTaskTable ? '' : 'none';
    if (info) info.textContent = `سيُصدَّر حسب العرض الحالي: ${curData() === 'meetings' ? 'الاجتماعات' : 'المهام'} — ${SHAPE_AR[curShape()] || 'جدول'}`;
    back.classList.add('open');
  };
  const cl = document.getElementById('reportClose'); if (cl) cl.onclick = close;
  if (back) back.onclick = (e) => { if (e.target === back) close(); };
  const pdf = document.getElementById('reportPdf'); if (pdf) pdf.onclick = runExport(pdf, exportPDF, 'PDF');
  const word = document.getElementById('reportWord'); if (word) word.onclick = runExport(word, exportWord, 'Word');
  const excel = document.getElementById('reportExcel'); if (excel) excel.onclick = runExport(excel, exportExcel, 'Excel');
});

/* ===================== تقرير المهمة الواحدة (PDF بورتريه A4، بند لا يُقسَّم بين صفحتين) ===================== */
const TR_W = 780, TR_PAGE_H = 1085; // عرض العرض/القياس + ارتفاع صفحة A4 بورتريه متحفّظ عند هذا العرض

// لون شارة موعد المخرَج حسب القرب (٤ حالات): متأخر / اليوم / خلال ٣ / بعيد
function trDateColor(diff) {
  if (diff == null) return RB.muted;
  if (diff < 0) return RB.red;
  if (diff === 0) return '#c0822f';
  if (diff <= 3) return '#9a7b50';
  return RB.muted;
}
function trPill(text, color) { return `<span style="display:inline-block;padding:2px 11px;border-radius:20px;font-size:12px;font-weight:800;color:${color};background:#fff;border:1.5px solid ${color}">${esc(text)}</span>`; }

// ترتيب الاجتماعات: المنتهية أولاً، ثم المجدولة حسب موعدها، ثم المطلوبة
function orderedMeetingsReport(t) {
  const rank = (m) => (m.status === 'done' ? 0 : m.status === 'scheduled' ? 1 : 2);
  return (t.meetings || []).slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.status === 'scheduled' && b.status === 'scheduled') { const x = a.datetime || '', y = b.datetime || ''; return x < y ? -1 : x > y ? 1 : 0; }
    return 0;
  });
}
// ترتيب أحداث المتابعة حسب التاريخ (تصاعدياً)؛ الأحداث اليدوية بلا تاريخ في النهاية
function orderedEventsReport(t) {
  const evs = (typeof parseFollowup === 'function') ? parseFollowup(t.followup, t.log) : [];
  return evs.slice().sort((a, b) => {
    const ad = a.date || '', bd = b.date || '';
    if (!ad && !bd) return 0; if (!ad) return 1; if (!bd) return -1;
    const ax = ad + (a.time || ''), bx = bd + (b.time || ''); return ax < bx ? -1 : ax > bx ? 1 : 0;
  });
}

function trHeaderBlock(logo, t) {
  const img = logo && logo.url ? `<img src="${logo.url}" width="${logo.w}" height="${logo.h}" style="width:${logo.w}px;height:${logo.h}px">` : '';
  const title = `${esc(t.project || 'مهمة')}${t.file ? ' — ' + esc(t.file) : ''}`;
  return `<div style="background:${RB.ink};padding:14px 22px;display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid ${RB.copper}">
      <div><div style="font-size:19px;font-weight:800;color:#fff">تقرير المهمة</div><div style="font-size:12.5px;color:${RB.champagne};margin-top:3px">${title}</div></div>${img}</div>
    <div style="padding:8px 22px;background:${RB.cream};border-bottom:1px solid ${RB.line};font-size:11.5px;color:${RB.copperDeep}"><b>تاريخ التقرير:</b> ${esc(nowText())} &nbsp;•&nbsp; مجموعة سنكري القابضة — الإدارة التنفيذية</div>`;
}
function trInfoBlock(t) {
  const rows = [
    ['المشروع', esc(t.project || '—')], ['الملف', esc(t.file || '—')], ['النوع', esc(t.type || '—')],
    ['تاريخ إنشاء المهمة', esc(t.created || t.createdIso || '—')], ['الموعد / الدورية', esc(t.deadlineRaw || t.deadlineIso || '—')],
    ['الأولوية', trPill(t.priority || '—', priColor(t.priority))], ['الحالة', trPill(t.status || '—', stColor(t.status))],
    ['المسؤول المعني', esc((t.owner || '—').replace(/\n+/g, '، '))], ['مرتبط بـ', esc((t.linkedTo || '—').replace(/\n+/g, '، '))],
  ];
  const cells = rows.map(([l, v]) => `<div style="border:1px solid ${RB.line};border-radius:8px;padding:8px 11px;background:#fff">
      <div style="font-size:10.5px;color:${RB.muted};font-weight:700;margin-bottom:3px">${l}</div>
      <div style="font-size:13px;color:${RB.ink};font-weight:600">${v}</div></div>`).join('');
  return `<div class="trblk" style="padding:14px 22px 4px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${cells}</div></div>`;
}
function trHeadingBlock(text) {
  return `<div class="trblk" style="padding:14px 22px 6px"><div style="font-size:15px;font-weight:800;color:${RB.ink};border-bottom:2px solid ${RB.copper};padding-bottom:5px">${esc(text)}</div></div>`;
}
function trDoneRel(diff) {
  if (typeof doneRelC === 'function') return doneRelC(diff);
  if (diff == null) return 'منجَز';
  return diff < 0 ? `أُنجز متأخراً ${Math.abs(diff)} يوم` : diff === 0 ? 'أُنجز في الموعد' : `أُنجز قبل ${diff} يوم`;
}
function trDeliverableBlock(d, n) {
  const pill = (bg, txt) => `<span style="display:inline-block;padding:1px 9px;border-radius:20px;font-size:11px;font-weight:700;color:#fff;background:${bg}">${txt}</span>`;
  const date = !d.dateRaw
    ? `<span style="font-size:11px;color:${RB.muted}">بلا موعد</span>`
    : d.done
      ? pill(RB.green, `✓ ${esc(d.dateRaw)} · ${esc(trDoneRel(d.diffDays))}`)              // منجَز: عدّاد مُجمَّد
      : pill(trDateColor(d.diffDays), `📅 ${esc(d.dateRaw)} · ${esc(relFromDiffC(d.diffDays))}`);
  const who = d.assignee ? `<span style="font-size:11px;color:${RB.copperDeep};font-weight:700">👤 ${esc(d.assignee)}</span>` : '';
  return `<div class="trblk" style="padding:0 22px 8px"><div style="border:1px solid ${RB.line};border-inline-start:3px solid ${d.done ? RB.green : RB.copper};border-radius:8px;padding:9px 12px;background:${d.done ? '#f3f6f0' : '#fff'}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px"><div style="font-size:11px;color:${RB.muted};font-weight:700">${d.done ? '✓ منجَز' : '○ قيد التنفيذ'} · مخرج ${n}</div><div style="display:flex;gap:8px;align-items:center">${who}${date}</div></div>
      <div style="font-size:13px;color:${RB.ink};font-weight:600;${d.done ? 'text-decoration:line-through;opacity:.7' : ''}">${esc(d.text)}</div></div></div>`;
}
const TR_MST = { done: { t: 'تم', c: RB.green }, scheduled: { t: 'مجدول', c: RB.copperDeep }, required: { t: 'مطلوب', c: RB.amber } };
function trMeetingBlock(m) {
  const st = TR_MST[m.status] || TR_MST.required;
  const when = (m.status === 'scheduled' && m.datetime) ? `<span style="font-size:11px;color:${RB.muted}">🕓 ${esc(m.datetime)}</span>` : '';
  return `<div class="trblk" style="padding:0 22px 8px"><div style="border:1px solid ${RB.line};border-radius:8px;padding:9px 12px;background:#fff;display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="font-size:13px;color:${RB.ink};font-weight:700">🤝 ${esc(m.title)}</div>
      <div style="display:flex;gap:8px;align-items:center">${when}${trPill(st.t, st.c)}</div></div></div>`;
}
function trEventBlock(e) {
  const meta = e.manual ? 'متابعة (يدوي)' : `${esc(e.author || '')} · ${esc((typeof fuShort === 'function') ? fuShort(e.date, e.time) : (e.date || ''))}`;
  return `<div class="trblk" style="padding:0 22px 8px"><div style="border:1px solid ${RB.line};border-radius:8px;padding:9px 12px;background:#fff">
      <div style="font-size:11px;color:${RB.copperDeep};font-weight:700;margin-bottom:4px">${meta}</div>
      <div style="font-size:12.5px;color:${RB.ink};white-space:pre-line">${esc(e.text || '')}</div></div></div>`;
}
function trPageHTML(logo, t, blocks) {
  return `<div class="rpt-page" dir="rtl" style="width:100%;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink}">
      ${trHeaderBlock(logo, t)}
      <div class="trbody">${blocks.map((b) => b.html).join('')}</div>
      <div style="padding:6px 22px 12px;font-size:10px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — الإدارة التنفيذية</div></div>`;
}
// قياس ارتفاع كل بند وتوزيع البنود على صفحات دون تقسيم أي بند (مع إبقاء العنوان مع أول بنده)
async function trPaginate(blocks, logo, t) {
  const m = document.createElement('div');
  m.style.cssText = `position:absolute;left:-12000px;top:0;width:${TR_W}px;visibility:hidden`;
  m.innerHTML = trPageHTML(logo, t, blocks);
  document.body.appendChild(m);
  try { await document.fonts.ready; } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 20));
  const page = m.firstElementChild;
  const body = m.querySelector('.trbody');
  const contentTop = body.getBoundingClientRect().top - page.getBoundingClientRect().top;
  const hts = [...m.querySelectorAll('.trblk')].map((e) => e.getBoundingClientRect().height);
  m.remove();
  const FOOTER = 34;
  const avail = Math.max(200, TR_PAGE_H - contentTop - FOOTER);
  const pages = []; let cur = [], used = 0;
  for (let i = 0; i < blocks.length; i++) {
    const h = hts[i] || 24;
    const nextH = (blocks[i].keepNext && i + 1 < blocks.length) ? (hts[i + 1] || 24) : 0; // العنوان يبقى مع أول بند
    if (cur.length && used + h + nextH > avail) { pages.push(cur); cur = []; used = 0; }
    cur.push(blocks[i]); used += h;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}
async function taskReportPDF(task) {
  try {
    applyReportTheme(); // لوحة ألوان التقرير حسب التصميم الفعّال
    const logo = await logoSmall(30);
    const blocks = [{ html: trInfoBlock(task) }];
    const dvs = (typeof orderedDeliverables === 'function') ? orderedDeliverables(task) : [];
    if (dvs.length) { blocks.push({ html: trHeadingBlock('📋 المخرجات المطلوبة'), keepNext: true }); dvs.forEach((d, i) => blocks.push({ html: trDeliverableBlock(d, i + 1) })); }
    const mts = orderedMeetingsReport(task);
    if (mts.length) { blocks.push({ html: trHeadingBlock('🤝 الاجتماعات'), keepNext: true }); mts.forEach((mm) => blocks.push({ html: trMeetingBlock(mm) })); }
    const evs = orderedEventsReport(task);
    if (evs.length) { blocks.push({ html: trHeadingBlock('🗒️ سجلّ المتابعة اليومية'), keepNext: true }); evs.forEach((ev) => blocks.push({ html: trEventBlock(ev) })); }
    const pages = await trPaginate(blocks, logo, task);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    for (let i = 0; i < pages.length; i++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:-12000px;top:0;width:${TR_W}px;background:#fff`;
      el.innerHTML = trPageHTML(logo, task, pages[i]);
      document.body.appendChild(el);
      try { await document.fonts.ready; } catch { /* تجاهل */ }
      await new Promise((r) => setTimeout(r, 40));
      const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: TR_W });
      el.remove();
      addCanvasPaged(pdf, canvas, i === 0); // يشرّح أي صفحة تتجاوز الطول احتياطاً
    }
    const fn = `تقرير-${(task.project || 'مهمة')}${task.file ? '-' + task.file : ''}`.replace(/[\\/:*?"<>|]+/g, '_');
    pdf.save(fn + '.pdf');
    if (typeof toast === 'function') toast('تم توليد تقرير المهمة ✓');
  } catch (e) { if (typeof toast === 'function') toast('تعذّر توليد التقرير: ' + e.message, true); }
}
