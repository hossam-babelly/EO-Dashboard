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
// هوية التقرير (خيار المستخدم من نافذة التقرير — يشمل تقرير المهمة الواحدة):
//   'classic' (الافتراضي) = هوية سنكري الرسمية الثابتة كما في النماذج المعتمدة
//   'ui' = يتبع تصميم الواجهة المختار (الألوان والخلفية — حتى المخصّص بمفاصله)
function reportIdentity() {
  try { return localStorage.getItem('eo_report_theme') === 'ui' ? 'ui' : 'classic'; }
  catch (_) { return 'classic'; }
}
// مستوى تفاصيل PDF القائمة: 'full' كامل السجل · 'last3' آخر ٣ أحداث · 'dv' المخرجات فقط
function reportDetail() {
  try { const v = localStorage.getItem('eo_report_detail'); return ['full', 'last3', 'dv'].includes(v) ? v : 'full'; }
  catch (_) { return 'full'; }
}
function applyReportTheme() {
  if (reportIdentity() === 'classic') { RB = Object.assign({}, RB_THEMES.classic); return; } // الهوية الثابتة
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

// ===== خلفية صفحات التقرير (آمنة لـ html2canvas: صور محلية + SVG مضمّن، بلا تدرّجات CSS/فلاتر) =====
let _glyphData = null;
async function glyphDataUrl() {
  if (_glyphData != null) return _glyphData;
  try {
    const blob = await (await fetch('/assets/logo-glyph.png')).blob();
    _glyphData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch (_) { _glyphData = ''; }
  return _glyphData;
}
// التصميم الذي تُبنى منه الخلفية في وضع «تتبع الواجهة» (المخصّص → مفصل «خلفية الصفحة»)
function reportBgDesign() {
  const d = activeReportDesign();
  if (d !== 'custom') return d;
  try { const c = JSON.parse(localStorage.getItem('eo_custom') || '{}') || {}; return ['classic', 'wing', 'bp', 'marsad', 'horizon', 'pearl'].includes(c.ambient) ? c.ambient : 'wing'; }
  catch (_) { return 'wing'; }
}
// طبقتا الخلفية {under, above} لكل صفحة:
//  الهوية الثابتة → علامة الجناح تملأ كل صفحة (افتراضياً؛ فوق المحتوى بشفافية طباعية خفيفة كي لا تحجبها البطاقات)
//  تتبع الواجهة  → مثل خلفية الواجهة: جَناح=العلامة بإعدادات المستخدم · الكلك=شبكة · مِرصَد/أفق/لؤلؤ=توهّج زاوية · كلاسيكي=بلا
function reportBgParts(glyph) {
  const abs = 'position:absolute;inset:0;pointer-events:none';
  const wmDiv = (widthPct, opacity, z) => glyph
    ? `<div style="${abs};z-index:${z};display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="${glyph}" style="width:${widthPct}%;opacity:${opacity}"></div>`
    : '';
  if (reportIdentity() === 'classic') return { under: '', above: wmDiv(96, .045, 2) };
  const d = reportBgDesign();
  if (d === 'wing') {
    // مثل خلفية الواجهة: علامة الجناح بإعدادات المستخدم (الحجم/الشفافية) — فوق المحتوى دائماً في الطباعة
    // (البطاقات البيضاء تغطي معظم الصفحة، فالطبقة العليا هي ما يجعلها «تملأ الصفحة» فعلاً) بسقف شفافية طباعي
    let wm = {}; try { wm = JSON.parse(localStorage.getItem('eo_wm') || '{}') || {}; } catch (_) { wm = {}; }
    const size = (wm.size != null && isFinite(Number(wm.size))) ? Math.min(300, Math.max(20, Number(wm.size))) : 96;
    const op = (wm.op != null && isFinite(Number(wm.op))) ? Math.min(12, Math.max(1, Number(wm.op))) / 100 : .045;
    return { under: '', above: wmDiv(size, op, 2) };
  }
  if (d === 'bp') {
    return { under: `<div style="${abs};z-index:0;overflow:hidden"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="rgrid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="rgba(70,84,90,.09)" stroke-width="1"/></pattern></defs><rect width="100%" height="100%" fill="url(#rgrid)"/></svg></div>`, above: '' };
  }
  if (d === 'marsad' || d === 'horizon' || d === 'pearl') {
    return { under: `<div style="${abs};z-index:0;overflow:hidden"><svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="rglow" cx="88%" cy="-6%" r="75%"><stop offset="0%" stop-color="${RB.copper}" stop-opacity=".07"/><stop offset="60%" stop-color="${RB.copper}" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#rglow)"/></svg></div>`, above: '' };
  }
  return { under: '', above: '' }; // كلاسيكي (في وضع تتبع الواجهة) = بلا خلفية
}
// انتظار تحميل صور العنصر قبل html2canvas (وإلا فاتت العلامة المائية أول تصيير)
async function awaitImgs(el) {
  const imgs = [...el.querySelectorAll('img')];
  await Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = im.onerror = r; }))));
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

/* ===================== PDF القائمة — «السجل المفصّل المدمج» (النموذج المعتمد) =====================
   لكل مهمة «شريحة»: سطر رئيسي (حقول الجدول المختارة) بشريط حالة ملوّن على الحافة،
   وتحته المخرجات (يمين) وسجلّ المتابعة كاملاً بعمودين متوازيين (يسار).
   صفحات A4 عرضية بارتفاع ثابت + ترويسة متكررة + بطاقات مؤشرات في الصفحة الأولى + ترقيم صفحات.
   المهمة الأطول من صفحة تُقسَّم على مستوى الأحداث بشرائح «(تتمة)» — لا يُقصّ حدث في منتصفه. */
const DP_PAGE_H = 730; // ارتفاع الصفحة عند عرض 1040 (نسبة A4 العرضية تقريباً)
function softC(hex, a) {
  const h = String(hex || '#8a8175').replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function dpToday() { return (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10); }
function dpDiff(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d1 = new Date(iso + 'T00:00:00'), d0 = new Date(dpToday() + 'T00:00:00');
  return Math.round((d1 - d0) / 86400000);
}
function dpRel(diff) { return (typeof relFromDiffC === 'function') ? relFromDiffC(diff) : ''; }
function dpPill(text, colorHex) { return `<span style="display:inline-block;border-radius:20px;padding:1px 10px;font-size:9.5px;font-weight:800;color:${colorHex};background:${softC(colorHex, .14)};white-space:nowrap">${esc(text)}</span>`; }
function dpStatusColor(s) { return s === 'منجزة' ? RB.green : s === 'متوقفة' ? RB.red : s === 'قيد التنفيذ' ? RB.copperDeep : RB.muted; }
function dpStripe(t, diff) {
  if (t.status === 'منجزة') return RB.green;
  if (diff != null && diff < 0) return RB.red;
  if (diff === 0) return RB.amber;
  return RB.champagne;
}
function dpDvRow(d) {
  const box = `<span style="flex:none;width:11px;height:11px;border:1.5px solid ${d.done ? RB.green : RB.copper};border-radius:3px;margin-top:2px;background:${d.done ? RB.green : '#fff'};color:#fff;font-size:8px;line-height:11px;text-align:center;font-weight:800">${d.done ? '✓' : ''}</span>`;
  const who = d.assignee ? `<span style="display:inline-block;background:${softC(RB.copperDeep, .13)};color:${RB.copperDeep};border-radius:9px;padding:0 7px;font-size:8.5px;font-weight:700;margin-inline-start:5px;white-space:nowrap">${esc(d.assignee)}</span>` : '';
  const dr = d.dateRaw || d.dateIso || '';
  const chip = (bg, txt) => `<span style="display:inline-block;background:${bg};color:#fff;border-radius:9px;padding:0 7px;font-size:8.5px;font-weight:700;margin-inline-start:4px;white-space:nowrap">${txt}</span>`;
  const when = !dr ? '' : (d.done
    ? chip(RB.green, '✓ ' + esc(typeof trDoneRel === 'function' ? trDoneRel(d.diffDays) : 'أُنجز'))
    : chip(trDateColor(d.diffDays), esc(dr) + (dpRel(d.diffDays) ? ' · ' + esc(dpRel(d.diffDays)) : '')));
  return `<div style="display:flex;gap:6px;align-items:flex-start;padding:3.5px 0;border-bottom:1px dashed ${softC(RB.copper, .16)};font-size:10px">${box}<span style="min-width:0;color:${d.done ? RB.muted : RB.ink};${d.done ? 'text-decoration:line-through;' : ''}">${esc(d.text)}${who}${when}</span></div>`;
}
function dpEventHTML(e) {
  const meta = e.manual
    ? `<span style="color:${RB.muted}">حدث يدوي</span>`
    : `${esc(typeof fuShort === 'function' ? fuShort(e.date, e.time) : (e.date || ''))} — <b style="color:${RB.copperDeep}">${esc(e.author || '')}</b>`;
  return `<div style="position:relative;padding-inline-start:13px;padding-bottom:6px">
      <span style="position:absolute;inset-inline-start:-4px;top:3px;width:7px;height:7px;border-radius:50%;background:${e.manual ? RB.champagne : RB.copper}"></span>
      <div style="font-size:9px;color:${RB.muted}">${meta}</div>
      <div style="font-size:10.5px;color:${RB.ink};white-space:pre-line;line-height:1.5">${esc(e.text || '')}</div></div>`;
}
function dpEventsCols(evs) {
  const col = (list) => `<div style="border-inline-start:1.5px solid ${RB.line};min-width:0">${list.map(dpEventHTML).join('')}</div>`;
  if (evs.length < 3) return col(evs);
  const half = Math.ceil(evs.length / 2);
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 20px">${col(evs.slice(0, half))}${col(evs.slice(half))}</div>`;
}
// o = { dvs, evs (الأحدث أولاً), evTotal, more (أحداث مؤجلة للتتمة), colset, cont }
function dpSliceHTML(t, num, o) {
  const diff = dpDiff(t.deadlineIso);
  const stripe = dpStripe(t, diff);
  const cs = o.colset;
  let head;
  if (o.cont) {
    head = `<div style="display:flex;align-items:center;gap:10px;background:${RB.cream};border-bottom:1px solid ${RB.line};padding:5px 12px;font-size:10px">
        <span style="font-family:'Cormorant Garamond',Georgia,serif;font-weight:700;color:${RB.copper};font-size:13px">${num}</span>
        <b style="color:${RB.ink}">${esc(t.project || '')}</b>
        ${t.file ? `<span style="color:${RB.muted};font-size:9px">الملف: ${esc(t.file)}</span>` : ''}
        <span style="color:${RB.copperDeep};font-weight:800">(تتمة سجلّ المتابعة)</span></div>`;
  } else {
    const cells = [];
    const cell = (l, v) => cells.push(`<span style="padding:0 10px;border-inline-start:1px solid ${RB.line}"><span style="display:block;font-size:8.5px;color:${RB.muted}">${l}</span><span style="font-size:10px;font-weight:700;color:${RB.ink}">${v}</span></span>`);
    if (cs.has('type')) cell('النوع', esc(t.type || '—'));
    if (cs.has('owner')) cell('المسؤول', esc((t.owner || '—').replace(/\n+/g, '، ')));
    if (cs.has('linkedTo') && t.linkedTo) cell('مرتبط بـ', esc(t.linkedTo.replace(/\n+/g, '، ')));
    if (cs.has('deadline')) {
      const dl = t.deadlineIso || t.deadlineRaw || '—';
      const c = t.status === 'منجزة' ? RB.green : diff != null && diff < 0 ? RB.red : diff === 0 ? RB.amber : RB.ink;
      const rel = (t.status !== 'منجزة' && diff != null) ? ` <span style="font-weight:400;color:${c}">(${esc(dpRel(diff))})</span>` : '';
      cell('الموعد', `<span style="color:${c}">${esc(dl)}</span>${rel}`);
    }
    if (t.created) cell('الإنشاء', esc(t.created));
    if (t.status === 'منجزة' && t.completed) cell('تاريخ الإنجاز', `<span style="color:${RB.green}">${esc(t.completed)}</span>`);
    if (cs.has('notes') && t.notes) cells.push(`<span style="padding:0 10px;border-inline-start:1px solid ${RB.line};max-width:220px"><span style="display:block;font-size:8.5px;color:${RB.muted}">ملاحظات</span><span style="font-size:9.5px;color:${RB.ink}">${esc(t.notes)}</span></span>`);
    const pills = [];
    if (cs.has('priority') && t.priority) pills.push(dpPill(t.priority, priColor(t.priority)));
    if (cs.has('status')) pills.push(dpPill(t.status || '—', dpStatusColor(t.status)));
    head = `<div style="display:flex;align-items:center;flex-wrap:wrap;row-gap:3px;background:${RB.cream};border-bottom:1px solid ${RB.line};padding:6px 12px 6px 10px">
        <span style="font-family:'Cormorant Garamond',Georgia,serif;font-size:14px;font-weight:700;color:${RB.copper};padding-inline-end:8px">${num}</span>
        <span style="min-width:130px;padding-inline-end:6px"><span style="display:block;font-weight:800;font-size:11.5px;color:${RB.ink}">${esc(t.project || '—')}</span>${t.file ? `<span style="font-size:9px;color:${RB.muted}">الملف: ${esc(t.file)}</span>` : ''}</span>
        ${cells.join('')}
        <span style="margin-inline-start:auto;display:flex;gap:5px;padding-inline-start:8px">${pills.join('')}</span></div>`;
  }
  let detail = '';
  const showDv = !o.cont && o.dvs.length > 0;
  const showEv = o.evs.length > 0;
  if (showDv || showEv) {
    // ملاحظة: لا letter-spacing على نصّ عربي — يفكّك اتصال الحروف عند تصيير html2canvas
    const dvTitle = `<div style="font-size:9px;color:${RB.copperDeep};font-weight:800;margin-bottom:4px">المخرجات المطلوبة (${o.dvs.filter((d) => d.done).length}/${o.dvs.length})</div>`;
    const evNote = o.more > 0 ? ` <span style="color:${RB.amber};font-weight:800">· يتبع +${o.more}</span>` : '';
    const evTitle = `<div style="font-size:9px;color:${RB.copperDeep};font-weight:800;margin-bottom:5px">سجلّ المتابعة${o.cont ? '' : ` (${o.evTotal} ${o.evTotal === 1 ? 'حدث' : 'أحداث'})`}${evNote}</div>`;
    const dvCol = showDv ? `<div style="padding:7px 12px">${dvTitle}${o.dvs.map(dpDvRow).join('')}</div>` : '';
    const evCol = showEv ? `<div style="padding:7px 12px;${showDv ? `border-inline-start:1px solid ${softC(RB.copper, .14)}` : ''}">${evTitle}${dpEventsCols(o.evs)}</div>` : '';
    detail = (showDv && showEv) ? `<div style="display:grid;grid-template-columns:330px 1fr">${dvCol}${evCol}</div>` : (dvCol || evCol);
  }
  return `<div class="dpslice" style="border:1px solid ${RB.line};border-inline-start:4px solid ${stripe};border-radius:10px;margin-bottom:10px;background:#fff;overflow:hidden">${head}${detail}</div>`;
}
function dpBand(logo, count) {
  const img = logo && logo.url ? `<img src="${logo.url}" width="${logo.w}" height="${logo.h}" style="width:${logo.w}px;height:${logo.h}px">` : '';
  return `<div style="background:${RB.ink};padding:10px 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid ${RB.copper}">
      <div><div style="font-size:16px;font-weight:800;color:#fff">تقرير المهام المفصّل</div>
      <div style="font-size:10px;color:${RB.champagne};margin-top:2px">${esc(reportFiltersText())} &nbsp;·&nbsp; ${count} مهمة &nbsp;·&nbsp; ${esc(nowText())}</div></div>${img}</div>`;
}
function dpTiles(ts) {
  const today = dpToday();
  const total = ts.length;
  const run = ts.filter((t) => t.status === 'قيد التنفيذ').length;
  const late = ts.filter((t) => t.status !== 'منجزة' && t.deadlineIso && t.deadlineIso < today).length;
  const done = ts.filter((t) => t.status === 'منجزة').length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const tile = (v, l, c) => `<div style="flex:1;border-radius:9px;padding:7px 13px;background:${softC(c, .13)};color:${c};display:flex;justify-content:space-between;align-items:center"><span style="font-size:17px;font-weight:900">${v}</span><span style="font-size:9.5px;font-weight:700">${l}</span></div>`;
  return `<div style="display:flex;gap:9px;padding:9px 28px 0">${tile(total, 'إجمالي المهام', RB.copperDeep)}${tile(run, 'قيد التنفيذ', RB.amber)}${tile(late, 'متأخرة', RB.red)}${tile(pct + '%', 'نسبة الإنجاز', RB.green)}</div>`;
}
function dpPage(slicesHtml, o) {
  return `<div class="rpt-page" dir="rtl" style="width:100%;height:${DP_PAGE_H}px;position:relative;overflow:hidden;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink}">
      ${o.bg.under}
      <div style="position:relative;z-index:1">${dpBand(o.logo, o.count)}${o.first ? dpTiles(o.tasks) : ''}<div style="padding:10px 28px 0">${slicesHtml}</div></div>
      ${o.bg.above}
      <div style="position:absolute;z-index:3;inset-inline:28px;bottom:0;height:30px;border-top:1px solid ${RB.line};display:flex;align-items:center;justify-content:space-between;font-size:9px;color:${RB.muted}"><span>© مجموعة سنكري القابضة — الإدارة التنفيذية</span><span>صفحة ${o.pageNo} من ${o.pageCount}</span></div></div>`;
}
function dpMeasure(html, width) {
  const m = document.createElement('div');
  m.style.cssText = `position:absolute;left:-12000px;top:0;width:${width}px;visibility:hidden`;
  m.innerHTML = html;
  document.body.appendChild(m);
  const h = m.firstElementChild ? m.firstElementChild.getBoundingClientRect().height : 0;
  m.remove();
  return h;
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

// PDF القائمة: «السجل المفصّل المدمج» — كل مهمة بشريحتها المفصّلة (مخرجات + سجلّ متابعة)
async function exportPDF() {
  if (!(curData() === 'tasks' && curShape() === 'table')) return exportLayoutPDF();
  const tasks = reportTasks();
  const det = reportDetail();
  const colset = new Set(activeCols().map((c) => c.k));
  const logo = await logoSmall(30);
  const glyph = await glyphDataUrl();
  const bg = reportBgParts(glyph);
  try { await document.fonts.ready; } catch { /* تجاهل */ }

  // ميزانيات الارتفاع (صفحة ثابتة الارتفاع + ترويسة متكررة + مؤشرات في الأولى + تذييل)
  const CONTENT_W = 984; // 1040 − 28×2
  const FOOT = 30, PADTOP = 10, SAFE = 8;
  const bandH = dpMeasure(dpBand(logo, tasks.length), 1040);
  const tilesH = tasks.length ? dpMeasure(dpTiles(tasks), 1040) : 0;
  const availFirst = DP_PAGE_H - bandH - tilesH - PADTOP - FOOT - SAFE;
  const availNext = DP_PAGE_H - bandH - PADTOP - FOOT - SAFE;

  // توزيع الشرائح على الصفحات (مع تقسيم الأحداث للمهمة الأطول من صفحة)
  const pages = [];
  let cur = [], used = 0, avail = availFirst;
  const pushPage = () => { pages.push(cur); cur = []; used = 0; avail = availNext; };
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const num = i + 1;
    const dvs = (colset.has('deliverable') && typeof orderedDeliverables === 'function') ? orderedDeliverables(t) : [];
    let evsAll = (colset.has('followup') && det !== 'dv') ? orderedEventsReport(t).slice().reverse() : []; // الأحدث أولاً
    const evTotal = evsAll.length;
    if (det === 'last3' && evsAll.length > 3) evsAll = evsAll.slice(0, 3);
    let html = dpSliceHTML(t, num, { dvs, evs: evsAll, evTotal, more: 0, colset, cont: false });
    let h = dpMeasure(html, CONTENT_W) + 10;
    if (h <= availNext) {
      // تتسع في صفحة فارغة: إن لم تتسع في المتبقي انتقل لصفحة جديدة
      if (h > avail - used && cur.length) pushPage();
      cur.push(html); used += h;
      continue;
    }
    // أطول من صفحة: قلّص أحداث الجزء الأول حتى يتسع، والبقية شرائح «(تتمة)»
    let k = evsAll.length, firstHtml = html, firstH = h;
    while (k > 0) {
      firstHtml = dpSliceHTML(t, num, { dvs, evs: evsAll.slice(0, k), evTotal, more: evsAll.length - k, colset, cont: false });
      firstH = dpMeasure(firstHtml, CONTENT_W) + 10;
      if (firstH <= availNext) break;
      k--;
    }
    if (k === 0) {
      // حتى بأقل الأحداث لا تتسع (محتوى ضخم جداً) — صفحة مستقلة ويشرّحها أمان addCanvasPaged
      k = Math.min(1, evsAll.length); // firstHtml من آخر دورة = الشريحة بحدث واحد (أو بلا أحداث)
      if (cur.length) pushPage();
      cur.push(firstHtml); pushPage();
    } else {
      if (firstH > avail - used && cur.length) pushPage();
      cur.push(firstHtml); used += firstH;
    }
    let rest = evsAll.slice(k);
    while (rest.length) {
      let kk = rest.length, contHtml = '', contH = 0;
      while (kk > 0) {
        contHtml = dpSliceHTML(t, num, { dvs: [], evs: rest.slice(0, kk), evTotal, more: rest.length - kk, colset, cont: true });
        contH = dpMeasure(contHtml, CONTENT_W) + 10;
        if (contH <= availNext) break;
        kk--;
      }
      if (kk === 0) { kk = 1; contHtml = dpSliceHTML(t, num, { dvs: [], evs: rest.slice(0, 1), evTotal, more: rest.length - 1, colset, cont: true }); contH = dpMeasure(contHtml, CONTENT_W) + 10; }
      if (contH > avail - used && cur.length) pushPage();
      cur.push(contHtml); used += contH;
      rest = rest.slice(kk);
    }
  }
  if (cur.length) pushPage();
  if (!pages.length) pages.push([`<div style="padding:36px;text-align:center;color:${RB.muted};font-size:13px">لا توجد مهام مطابقة.</div>`]);

  // تصيير كل صفحة صورة مستقلة وإضافتها للـ PDF
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  for (let p = 0; p < pages.length; p++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;background:#fff';
    el.innerHTML = dpPage(pages[p].join(''), { logo, count: tasks.length, first: p === 0, pageNo: p + 1, pageCount: pages.length, bg, tasks });
    document.body.appendChild(el);
    try { await document.fonts.ready; } catch { /* تجاهل */ }
    await awaitImgs(el);
    await new Promise((r) => setTimeout(r, 30));
    const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1040 });
    el.remove();
    addCanvasPaged(pdf, canvas, p === 0);
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
    const dtw = document.getElementById('repDetailWrap'); if (dtw) dtw.style.display = isTaskTable ? '' : 'none';
    // مزامنة أزرار الهوية/التفاصيل مع القيمة المخزّنة (قد تتغيّر من نافذة تقرير المهمة)
    document.querySelectorAll('#repIdentity .rep-lay').forEach((b) => b.classList.toggle('active', b.dataset.v === reportIdentity()));
    document.querySelectorAll('#repDetail .rep-lay').forEach((b) => b.classList.toggle('active', b.dataset.v === reportDetail()));
    if (info) info.textContent = `سيُصدَّر حسب العرض الحالي: ${curData() === 'meetings' ? 'الاجتماعات' : 'المهام'} — ${SHAPE_AR[curShape()] || 'جدول'}`;
    back.classList.add('open');
  };
  // هوية التقرير (ثابتة/تتبع الواجهة) + مستوى التفاصيل — تُحفظ لكل متصفح وتشمل تقرير المهمة الواحدة
  const idWrap = document.getElementById('repIdentity');
  if (idWrap) {
    const sync = () => [...idWrap.querySelectorAll('.rep-lay')].forEach((b) => b.classList.toggle('active', b.dataset.v === reportIdentity()));
    idWrap.addEventListener('click', (e) => { const b = e.target.closest('.rep-lay'); if (!b) return; try { localStorage.setItem('eo_report_theme', b.dataset.v); } catch (_) {} sync(); });
    sync();
  }
  const dtWrap = document.getElementById('repDetail');
  if (dtWrap) {
    const sync = () => [...dtWrap.querySelectorAll('.rep-lay')].forEach((b) => b.classList.toggle('active', b.dataset.v === reportDetail()));
    dtWrap.addEventListener('click', (e) => { const b = e.target.closest('.rep-lay'); if (!b) return; try { localStorage.setItem('eo_report_detail', b.dataset.v); } catch (_) {} sync(); });
    sync();
  }
  const cl = document.getElementById('reportClose'); if (cl) cl.onclick = close;
  if (back) back.onclick = (e) => { if (e.target === back) close(); };
  const pdf = document.getElementById('reportPdf'); if (pdf) pdf.onclick = runExport(pdf, exportPDF, 'PDF');
  const word = document.getElementById('reportWord'); if (word) word.onclick = runExport(word, exportWord, 'Word');
  const excel = document.getElementById('reportExcel'); if (excel) excel.onclick = runExport(excel, exportExcel, 'Excel');
});

/* ===================== تقرير المهمة الواحدة (PDF بورتريه A4، بند لا يُقسَّم بين صفحتين) ===================== */
const TR_W = 780; // عرض القياس/التصيير لصفحة تقرير المهمة

// لون شارة موعد المخرَج حسب القرب (٤ حالات): متأخر / اليوم / خلال ٣ / بعيد
function trDateColor(diff) {
  if (diff == null) return RB.muted;
  if (diff < 0) return RB.red;
  if (diff === 0) return '#c0822f';
  if (diff <= 3) return '#9a7b50';
  return RB.muted;
}

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

/* «صحيفة المهمة» (النموذج المعتمد): صفحة طولية بطابع الأوراق الرسمية —
   ترويسة سيريفية برقم المهمة، عنوان وشارات، شبكة بيانات، المخرجات، الاجتماعات، ثم سجلّ المتابعة كاملاً بخيط زمني. */
const TR_PAGE_FULL = 1100; // ارتفاع الصفحة الثابت عند عرض 780 (نسبة A4 الطولية تقريباً)
function trPaperBg() { return reportIdentity() === 'classic' ? '#fdfaf5' : '#ffffff'; }
function trDoneRel(diff) {
  if (typeof doneRelC === 'function') return doneRelC(diff);
  if (diff == null) return 'منجَز';
  return diff < 0 ? `أُنجز متأخراً ${Math.abs(diff)} يوم` : diff === 0 ? 'أُنجز في الموعد' : `أُنجز قبل ${diff} يوم`;
}
function trMastheadHTML(t, cont, logo) {
  const num = String(t.num || '').trim();
  // شعار سنكري الرسمي دائماً في الترويسة (مهما كانت هوية التقرير) — داخل شريحة فحمية لأن الشعار فاتح اللون
  const brand = logo && logo.url
    ? `<span style="display:inline-block;background:${RB.ink};border-radius:10px;padding:7px 13px;line-height:0"><img src="${logo.url}" width="${logo.w}" height="${logo.h}" style="width:${logo.w}px;height:${logo.h}px"></span>`
    : `<span style="font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;font-weight:700;letter-spacing:2.5px;color:${RB.ink}">SANKARI</span>`;
  return `<div class="trmast" style="display:flex;justify-content:space-between;align-items:flex-end;padding:22px 34px 12px;border-bottom:2.5px solid ${RB.ink}">
      <div>${brand}</div>
      <div style="text-align:left"><div style="font-size:9px;color:${RB.muted}">تقرير مهمة${cont ? ' — (تتمة)' : ''}</div>
      ${num ? `<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-weight:700;color:${RB.champagne};line-height:1">${esc(num.length < 2 ? '0' + num : num)}</div>` : `<div style="font-weight:800;font-size:11px;color:${RB.ink}">${esc(nowText())}</div>`}</div></div>`;
}
function trTitleBlock(t) {
  const diff = dpDiff(t.deadlineIso);
  const dl = t.deadlineRaw || t.deadlineIso || '';
  const dlColor = t.status === 'منجزة' ? RB.green : diff != null && diff < 0 ? RB.red : diff === 0 ? RB.amber : RB.ink;
  const rel = (typeof relText === 'function') ? relText(t) : (diff != null ? dpRel(diff) : '');
  const badges = [
    t.priority ? dpPill(t.priority, priColor(t.priority)) : '',
    dpPill(t.status || '—', dpStatusColor(t.status)),
    dl ? `<span style="font-size:11px;font-weight:800;color:${dlColor}">الموعد ${esc(dl)}${rel ? ' · ' + esc(rel) : ''}</span>` : '',
  ].filter(Boolean).join('');
  return `<div class="trblk" style="padding:14px 0 2px">
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;font-weight:700;color:${RB.ink};line-height:1.3">${esc(t.project || 'مهمة')}</div>
      <div style="font-size:10.5px;color:${RB.muted};margin:2px 0 10px">${t.file ? 'الملف: ' + esc(t.file) + ' · ' : ''}الإدارة التنفيذية — مجموعة سنكري القابضة</div>
      <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">${badges}</div></div>`;
}
function trInfoBlock(t) {
  const rows = [
    ['النوع', esc(t.type || '—')],
    ['المسؤول المعني', esc((t.owner || '—').replace(/\n+/g, '، '))],
    ['تاريخ الإنشاء', esc(t.created || t.createdIso || '—')],
    ['مرتبط بـ', esc((t.linkedTo || '—').replace(/\n+/g, '، '))],
    ['الموعد / الدورية', esc(t.deadlineRaw || t.deadlineIso || '—')],
    t.status === 'منجزة' && t.completed ? ['تاريخ الإنجاز', `<span style="color:${RB.green};font-weight:800">${esc(t.completed)}</span>`] : null,
    t.notes ? ['ملاحظات', esc(t.notes)] : null,
  ].filter(Boolean);
  const cells = rows.map(([l, v]) => `<div style="background:#fff;padding:8px 12px"><div style="font-size:8.5px;color:${RB.muted}">${l}</div><div style="font-size:11px;font-weight:800;color:${RB.ink};margin-top:1px">${v}</div></div>`).join('');
  return `<div class="trblk" style="padding:10px 0 4px"><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:${RB.line};border:1px solid ${RB.line};border-radius:10px;overflow:hidden">${cells}</div></div>`;
}
function trHeadingBlock(text) {
  // لا letter-spacing على العربية (يفكّك الحروف في html2canvas)
  return `<div class="trblk" style="padding:14px 0 8px"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:10.5px;color:${RB.copperDeep};font-weight:800">${esc(text)}</span><span style="flex:1;height:1px;background:${softC(RB.copper, .3)}"></span></div></div>`;
}
function trDeliverableBlock(d) {
  const box = `<span style="flex:none;width:13px;height:13px;border:1.5px solid ${d.done ? RB.green : RB.copper};border-radius:3px;margin-top:3px;background:${d.done ? RB.green : '#fff'};color:#fff;font-size:9px;line-height:13px;text-align:center;font-weight:800">${d.done ? '✓' : ''}</span>`;
  const who = d.assignee ? `<span style="display:inline-block;background:${softC(RB.copperDeep, .13)};color:${RB.copperDeep};border-radius:10px;padding:0 8px;font-size:9.5px;font-weight:700;margin-inline-start:6px;white-space:nowrap">${esc(d.assignee)}</span>` : '';
  const dr = d.dateRaw || d.dateIso || '';
  const chip = (bg, txt) => `<span style="display:inline-block;background:${bg};color:#fff;border-radius:10px;padding:0 8px;font-size:9.5px;font-weight:700;margin-inline-start:5px;white-space:nowrap">${txt}</span>`;
  const when = !dr ? '' : (d.done
    ? chip(RB.green, '✓ ' + esc(dr) + ' · ' + esc(trDoneRel(d.diffDays)))
    : chip(trDateColor(d.diffDays), esc(dr) + (dpRel(d.diffDays) ? ' · ' + esc(dpRel(d.diffDays)) : '')));
  return `<div class="trblk" style="padding:0"><div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px dashed ${softC(RB.copper, .18)};font-size:11.5px">${box}<span style="min-width:0;line-height:1.6;color:${d.done ? RB.muted : RB.ink};${d.done ? 'text-decoration:line-through;' : ''}">${esc(d.text)}${who}${when}</span></div></div>`;
}
const TR_MST = { done: { t: 'تم', c: () => RB.green }, scheduled: { t: 'مجدول', c: () => RB.copperDeep }, required: { t: 'مطلوب', c: () => RB.amber } };
function trMeetingBlock(m) {
  const st = TR_MST[m.status] || TR_MST.required;
  const when = (m.status === 'scheduled' && m.datetime) ? `<span style="font-size:10px;color:${RB.muted}">${esc(m.datetime)}</span>` : '';
  return `<div class="trblk" style="padding:0"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed ${softC(RB.copper, .18)}">
      <span style="font-size:11.5px;color:${RB.ink};font-weight:700">${esc(m.title)}</span>
      <span style="display:flex;gap:6px;align-items:center">${when}${dpPill(st.t, st.c())}</span></div></div>`;
}
function trEventBlock(e) {
  const meta = e.manual
    ? `<span style="color:${RB.muted}">حدث يدوي</span>`
    : `${esc(typeof fuShort === 'function' ? fuShort(e.date, e.time) : (e.date || ''))} — <b style="color:${RB.copperDeep}">${esc(e.author || '')}</b>`;
  return `<div class="trblk" style="padding:0"><div style="position:relative;padding-inline-start:15px;padding-bottom:9px;border-inline-start:1.5px solid ${RB.line};margin-inline-start:3px">
      <span style="position:absolute;inset-inline-start:-4.5px;top:3px;width:8px;height:8px;border-radius:50%;background:${e.manual ? RB.champagne : RB.copper}"></span>
      <div style="font-size:10px;color:${RB.muted}">${meta}</div>
      <div style="font-size:11.5px;color:${RB.ink};white-space:pre-line;line-height:1.65;margin-top:1px">${esc(e.text || '')}</div></div></div>`;
}
function trPageHTML(t, blocks, o) {
  return `<div class="rpt-page" dir="rtl" style="width:100%;height:${TR_PAGE_FULL}px;position:relative;overflow:hidden;background:${trPaperBg()};box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink}">
      ${o.bg.under}
      <div style="position:relative;z-index:1">${trMastheadHTML(t, o.cont, o.logo)}<div class="trbody" style="padding:0 34px">${blocks.map((b) => b.html).join('')}</div></div>
      ${o.bg.above}
      <div style="position:absolute;z-index:3;inset-inline:34px;bottom:0;height:34px;border-top:1px solid ${RB.line};display:flex;align-items:center;justify-content:space-between;font-size:9.5px;color:${RB.muted}"><span>© مجموعة سنكري القابضة — الإدارة التنفيذية</span><span>${esc(nowText())}</span><span>صفحة ${o.pageNo} من ${o.pageCount}</span></div></div>`;
}
// قياس ارتفاع كل بند وتوزيع البنود على صفحات دون تقسيم أي بند (مع إبقاء العنوان مع أول بنده)
async function trPaginate(blocks, t, bg, logo) {
  const m = document.createElement('div');
  m.style.cssText = `position:absolute;left:-12000px;top:0;width:${TR_W}px;visibility:hidden`;
  m.innerHTML = trPageHTML(t, blocks, { bg, logo, pageNo: 1, pageCount: 1, cont: false });
  document.body.appendChild(m);
  try { await document.fonts.ready; } catch { /* تجاهل */ }
  await new Promise((r) => setTimeout(r, 20));
  const page = m.firstElementChild;
  const body = m.querySelector('.trbody');
  const contentTop = body.getBoundingClientRect().top - page.getBoundingClientRect().top;
  const hts = [...m.querySelectorAll('.trblk')].map((e) => e.getBoundingClientRect().height);
  m.remove();
  const FOOTER = 40;
  const avail = Math.max(200, TR_PAGE_FULL - contentTop - FOOTER);
  const pages = []; let cur = [], used = 0;
  for (let i = 0; i < blocks.length; i++) {
    const h = hts[i] || 24;
    const nextH = (blocks[i].keepNext && i + 1 < blocks.length) ? (hts[i + 1] || 24) : 0; // العنوان يبقى مع أول بنده
    if (cur.length && used + h + nextH > avail) { pages.push(cur); cur = []; used = 0; }
    cur.push(blocks[i]); used += h;
  }
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}
async function taskReportPDF(task) {
  try {
    applyReportTheme(); // هوية التقرير (ثابتة أو تتبع الواجهة)
    const glyph = await glyphDataUrl();
    const bg = reportBgParts(glyph);
    const logo = await logoSmall(26); // الشعار الرسمي في الترويسة مهما كانت الهوية
    const blocks = [{ html: trTitleBlock(task) }, { html: trInfoBlock(task) }];
    const dvs = (typeof orderedDeliverables === 'function') ? orderedDeliverables(task) : [];
    if (dvs.length) { blocks.push({ html: trHeadingBlock(`المخرجات المطلوبة (${dvs.filter((d) => d.done).length}/${dvs.length})`), keepNext: true }); dvs.forEach((d) => blocks.push({ html: trDeliverableBlock(d) })); }
    const mts = orderedMeetingsReport(task);
    if (mts.length) { blocks.push({ html: trHeadingBlock('الاجتماعات'), keepNext: true }); mts.forEach((mm) => blocks.push({ html: trMeetingBlock(mm) })); }
    const evs = orderedEventsReport(task).slice().reverse(); // الأحدث أولاً
    if (evs.length) { blocks.push({ html: trHeadingBlock(`سجلّ المتابعة اليومية (${evs.length} ${evs.length === 1 ? 'حدث' : 'أحداث'})`), keepNext: true }); evs.forEach((ev) => blocks.push({ html: trEventBlock(ev) })); }
    const pages = await trPaginate(blocks, task, bg, logo);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    for (let i = 0; i < pages.length; i++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:-12000px;top:0;width:${TR_W}px;background:#fff`;
      el.innerHTML = trPageHTML(task, pages[i], { bg, logo, pageNo: i + 1, pageCount: pages.length, cont: i > 0 });
      document.body.appendChild(el);
      try { await document.fonts.ready; } catch { /* تجاهل */ }
      await awaitImgs(el);
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

// ===== منتقي هوية التقرير قبل توليد تقرير المهمة الواحدة (نفس خيار تقرير القائمة، ونفس المفتاح المخزّن) =====
let _trPendingTask = null;
function taskReportWithChoice(task) {
  const back = document.getElementById('trIdModalBack');
  if (!back) return taskReportPDF(task);
  _trPendingTask = task;
  const wrap = document.getElementById('trRepIdentity');
  if (wrap) [...wrap.querySelectorAll('.rep-lay')].forEach((b) => b.classList.toggle('active', b.dataset.v === reportIdentity()));
  back.classList.add('open');
}
window.taskReportWithChoice = taskReportWithChoice;
(function () {
  const back = document.getElementById('trIdModalBack');
  if (!back) return;
  const wrap = document.getElementById('trRepIdentity');
  if (wrap) wrap.addEventListener('click', (e) => {
    const b = e.target.closest('.rep-lay'); if (!b) return;
    try { localStorage.setItem('eo_report_theme', b.dataset.v); } catch (_) { /* تجاهل */ }
    [...wrap.querySelectorAll('.rep-lay')].forEach((x) => x.classList.toggle('active', x === b));
  });
  const close = () => back.classList.remove('open');
  const c = document.getElementById('trIdClose'); if (c) c.onclick = close;
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  const go = document.getElementById('trIdGo');
  if (go) go.onclick = async () => {
    const t = _trPendingTask; if (!t) return;
    go.disabled = true; const o = go.textContent; go.textContent = '... توليد';
    try { await taskReportPDF(t); close(); } finally { go.disabled = false; go.textContent = o; }
  };
})();
