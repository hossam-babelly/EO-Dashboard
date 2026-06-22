'use strict';

const { google } = require('googleapis');
const { parseDeadline, classify, TZ } = require('./dates');

// تاريخ اليوم بصيغة ISO حسب توقيت دمشق (لتعبئة «تاريخ إنشاء المهمة» تلقائياً)
function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// تطبيع تاريخ (ISO أو D/M/YYYY) إلى YYYY-MM-DD للفرز
function toIsoDate(s) {
  const v = String(s == null ? '' : s).trim();
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { let y = Number(m[3]); if (y < 100) y += 2000; return `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`; }
  return '';
}

const SHEET_ID = process.env.SHEET_ID || '1GaGuwrOioQi8CKhxzJGmYemRPD1dso8ASoa_pQI-Ky8';
const TAB = process.env.SHEET_TAB || 'لوحة الإدارة التنفيذية'; // تبويب البروفايل الأول (اسمه = اسم البروفايل)
// البروفايلات ديناميكية: كل بروفايل = تبويب مستقلّ بنفس اسمه في ملف الـ Sheet (تُدار قائمتها في ملف البيانات)

// مدى القراءة واسع (A→Z) لتغطية أي أعمدة مضافة. الأعمدة تُكتشف بالاسم لا بالموضع.
const WIDE_COL = 'Z';
const DONE_STATUS = 'منجزة';
const DEFAULT_STATUS = 'لم تبدأ';
const STATUSES = ['لم تبدأ', 'قيد التنفيذ', 'منجزة', 'متوقفة'];

// الاجتماعات — الجدولة مربّع اختيار في عمود «تمت جدولة الاجتماع»
const MEETING_SCHEDULED = 'تم جدولته';
const MEETING_UNSCHEDULED = 'غير مجدول';
const MEETING_STATUSES = [MEETING_UNSCHEDULED, MEETING_SCHEDULED];

// أنواع المهام المعروفة (للترتيب/البطاقات) — المطابقة متسامحة، والقيم غير المعروفة تُقبل كما هي.
const TYPES = ['E-mail', 'مجلس الإدارة', 'مكتب تنفيذي', 'تواقيع واعتمادات'];

// مرادفات أسماء العناوين لكل حقل (تُطابَق بعد تطبيع المسافات). أضِف مرادفاً جديداً لو غيّرت عنواناً.
const HEADER_ALIASES = {
  num: ['م'],
  project: ['المشروع'],
  dept: ['القسم / الشركة / المشروع', 'القسم/الشركة/المشروع', 'القسم'],
  file: ['الملف'],
  type: ['النوع'],
  linkedTo: ['مرتبط بـ', 'مرتبط ب', 'مرتبط'],
  owner: ['المسؤول المعني', 'المسؤول'],
  deliverable: ['المخرج المطلوب'],
  deadline: ['الموعد / الدورية', 'الموعد/الدورية', 'الموعد'],
  priority: ['الأولوية'],
  followup: ['نتائج المتابعة اليومية', 'تفاصيل المتابعة اليومية', 'المتابعة اليومية'],
  log: ['السجل'],
  // عناوين الاجتماعات: كتل مفصولة بسطر فارغ (اسم لكل اجتماع). الأسماء القديمة تبقى للتوافق.
  meeting: ['عناوين الاجتماعات', 'اجتماع'],
  // جدولة الاجتماعات: كتل متوازية «تم»/«لا» لكل اجتماع.
  scheduled: ['جدولة الاجتماعات', 'تمت جدولة الاجتماع', 'تم جدولة الاجتماع'],
  notes: ['ملاحظات'],
  status: ['الحالة'],
  created: ['تاريخ إنشاء المهمة', 'تاريخ الإنشاء', 'تاريخ إضافة المهمة'],
  // تاريخ إنجاز المهمة الفعلي — يُملأ تلقائياً عند تحويل الحالة إلى «منجزة» (لتثبيت تعليق الموعد).
  completed: ['تاريخ الإنجاز', 'تاريخ الإنجاز الفعلي', 'تاريخ الانجاز'],
  attachments: ['مرفقات', 'المرفقات'],
  // مكلّف كل مخرَج (كتل متوازية لكتل «المخرج المطلوب»؛ «-» = بلا تخصيص).
  dvowners: ['مكلّف المخرجات', 'مسؤول المخرجات', 'تخصيص المخرجات'],
};

// الأعمدة التي يضمن التطبيق وجودها (أعمدة الاجتماعات يديرها المالك يدوياً كنص)
const MANAGED_COLUMNS = ['الحالة', 'تاريخ الإنجاز', 'مكلّف المخرجات'];
const SCHEDULE_HEADER = 'جدولة الاجتماعات';

const useServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const canWrite = useServiceAccount;

let _sheets;
function sheetsApi() {
  if (_sheets) return _sheets;
  if (useServiceAccount) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    _sheets = google.sheets({ version: 'v4', auth });
  } else {
    _sheets = google.sheets({ version: 'v4' });
  }
  return _sheets;
}

// إعادة المحاولة عند انقطاعات Google العابرة (Premature close / إعادة ضبط الاتصال / مهلة)
function isTransient(err) {
  const msg = String((err && (err.message || err.code)) || '').toLowerCase();
  const status = err && err.response && err.response.status;
  return /premature close|socket hang up|econnreset|etimedout|eai_again|enotfound|fetch failed|network|epipe|timeout|read econn/.test(msg)
    || [429, 500, 502, 503, 504].includes(Number(status));
}
async function withRetry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i === tries - 1 || !isTransient(e)) throw e;
      console.warn('sheets: انقطاع عابر مع Google، إعادة المحاولة', i + 1, '-', e.message);
      await new Promise((r) => setTimeout(r, 350 * Math.pow(2, i))); // 350ms, 700ms, 1400ms
    }
  }
  throw last;
}

// عند استخدام مفتاح API (قراءة فقط) نمرّر المفتاح مع كل طلب
function keyParam() {
  return useServiceAccount ? {} : { key: process.env.GOOGLE_API_KEY };
}

function range(tab, a1) {
  return `'${tab || TAB}'!${a1}`;
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const TRUTHY = /^(true|نعم|✓|yes|y|1|checked)$/i;
// كلمة جدولة الاجتماع المنجَزة في عمود «جدولة الاجتماعات» (المعتمد: «تم»، و«لا» تعني غير مجدول)
const SCHED_TRUTHY = /^(تم|تمت|نعم|true|✓|yes|y|1|مجدول)$/i;

// تقسيم «مرتبط بـ» إلى أشخاص (سطر/فاصلة لكل شخص) — نُبقي «/» جزءاً من الاسم
function splitLinked(raw) {
  return String(raw || '').split(/[\n,،]+/).map((s) => s.trim()).filter(Boolean);
}

// استخراج «تاريخ + وقت» الاجتماع من نصّ خلية الجدولة → «YYYY-MM-DD HH:MM» أو «YYYY-MM-DD»
function toMeetingDateTime(s) {
  const iso = toIsoDate(s);
  if (!iso) return '';
  const tm = String(s).match(/(\d{1,2}):(\d{2})/);
  return tm ? `${iso} ${String(tm[1]).padStart(2, '0')}:${tm[2]}` : iso;
}
// تحليل حالة الاجتماع من نصّ عمود الجدولة: «لا»=مطلوب · «تم»=منعقد · تاريخ/وقت=مجدول
function parseMeetingState(block) {
  const b = String(block == null ? '' : block).trim();
  if (!b || /^لا$/.test(b)) return { status: 'required', datetime: '' };
  if (/^(تم|تمت|منعقد|انتهى)$/.test(b)) return { status: 'done', datetime: '' };
  const dt = toMeetingDateTime(b);
  if (dt) return { status: 'scheduled', datetime: dt };
  return { status: 'required', datetime: '' };
}
// تحويل مصفوفة اجتماعات [{title, status, datetime}] إلى عمودَي الشيت المتوازيين
function meetingsToCols(meetings) {
  const valid = (Array.isArray(meetings) ? meetings : [])
    .map((m) => ({
      title: String(m && m.title != null ? m.title : '').replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim(),
      status: (m && m.status) || 'required',
      datetime: String((m && m.datetime) || '').trim(),
    }))
    .filter((m) => m.title);
  const schedText = (m) => (m.status === 'done' ? 'تم' : m.status === 'scheduled' ? (m.datetime || 'مجدول') : 'لا');
  return {
    meeting: valid.map((m) => m.title).join('\n\n'),
    scheduled: valid.map(schedText).join('\n\n'),
  };
}

// تحويل رقم عمود (0=A) إلى حرفه
function numToLetter(n) {
  let s = '';
  n = Number(n);
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// ===== تلوين خلايا المتابعة/السجل (أحمر/أزرق متناوب لكل حدث) عبر Sheets API =====
const COLOR_ODD = { red: 0.7529, green: 0.2235, blue: 0.1686 };  // أحمر #c0392b
const COLOR_EVEN = { red: 0.1216, green: 0.3725, blue: 0.6784 }; // أزرق #1f5fad
let _sheetIds = {};
async function getSheetId(tab) {
  const t = tab || TAB;
  if (_sheetIds[t] != null) return _sheetIds[t];
  const meta = await withRetry(() => sheetsApi().spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(sheetId,title)' }));
  const list = meta.data.sheets || [];
  const sh = list.find((s) => s.properties && s.properties.title === t) || list[0];
  _sheetIds[t] = sh ? sh.properties.sheetId : 0;
  return _sheetIds[t];
}
// أسماء كل التبويبات الموجودة في الملف
async function listTabs() {
  const meta = await withRetry(() => sheetsApi().spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties.title' }));
  return (meta.data.sheets || []).map((s) => s.properties.title);
}
// مقاطع تلوين بحسب موضع كل كتلة (يجب أن يبدأ المقطع الأول من 0)
function colorRuns(text) {
  const runs = [];
  const re = /\n[ \t]*\n+/g;
  let start = 0, k = 0, m;
  const push = (s, i) => runs.push({ startIndex: s, format: { foregroundColorStyle: { rgbColor: i % 2 === 0 ? COLOR_ODD : COLOR_EVEN } } });
  while ((m = re.exec(text)) !== null) { push(start, k++); start = m.index + m[0].length; }
  push(start, k);
  return runs;
}
async function colorCells(tab, items) {
  const valid = (items || []).filter((it) => it.col != null && String(it.text || '').trim());
  if (!canWrite || !valid.length) return;
  try {
    const sheetId = await getSheetId(tab);
    const requests = valid.map((it) => ({
      updateCells: {
        range: { sheetId, startRowIndex: it.row - 1, endRowIndex: it.row, startColumnIndex: it.col, endColumnIndex: it.col + 1 },
        rows: [{ values: [{ textFormatRuns: colorRuns(String(it.text)) }] }],
        fields: 'textFormatRuns',
      },
    }));
    await withRetry(() => sheetsApi().spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } }));
  } catch (e) { console.warn('colorCells:', e.message); }
}

// بناء خريطة {حقل: فهرس العمود} من صف العناوين، بالاسم
function mapColumns(headerRow) {
  const map = {};
  (headerRow || []).forEach((cell, idx) => {
    const c = norm(cell);
    if (!c) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] == null && aliases.some((a) => norm(a) === c)) { map[field] = idx; break; }
    }
  });
  return map;
}

// تقسيم محتوى خلية إلى «كتل» مفصولة بأسطر فارغة (كل كتلة = حدث)
function fuBlocks(s) {
  return String(s == null ? '' : s).replace(/\r/g, '').split(/\n[ \t]*\n+/).map((b) => b.replace(/^\s+|\s+$/g, '')).filter((b) => b !== '');
}

function splitOwners(raw) {
  return String(raw || '')
    .split(/[\n,،/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowHasContent(r, cols) {
  return [cols.project, cols.dept, cols.file, cols.owner, cols.deliverable]
    .filter((i) => i != null)
    .some((i) => String(r[i] || '').trim());
}

function buildTask(r, rowNumber, cols) {
  const get = (k) => (cols[k] == null ? '' : String(r[cols[k]] != null ? r[cols[k]] : '').trim());
  const status = get('status') || DEFAULT_STATUS;
  const isDone = status === DONE_STATUS;
  const deadlineRaw = get('deadline');
  const parsed = parseDeadline(deadlineRaw);
  const flags = classify(parsed, isDone);

  const type = get('type');
  // الاجتماعات: عمودان متوازيان (عناوين الاجتماعات + جدولة الاجتماعات) ككتل مفصولة بسطر فارغ
  const mTitles = fuBlocks(get('meeting'));
  const mScheds = fuBlocks(get('scheduled'));
  const meetings = mTitles.map((title, i) => { const st = parseMeetingState(mScheds[i]); return { title, status: st.status, datetime: st.datetime }; });
  const isMeeting = meetings.length > 0;
  const linkedTo = get('linkedTo');

  return {
    id: rowNumber, // معرّف ثابت = رقم الصف في الشيت
    row: rowNumber,
    num: get('num'),
    project: get('project'),
    dept: get('dept'),
    file: get('file'),
    type,
    linkedTo,
    linkedList: splitLinked(linkedTo),
    owner: get('owner'),
    owners: splitOwners(get('owner')),
    deliverable: get('deliverable'),
    deadlineRaw,
    deadlineIso: parsed.iso,
    recurrence: parsed.recurrence,
    priority: get('priority') || 'غير محددة',
    followup: get('followup'),
    log: get('log'),
    notes: get('notes'),
    created: get('created'),
    createdIso: toIsoDate(get('created')),
    completed: get('completed'),
    completedIso: toIsoDate(get('completed')),
    attachments: get('attachments'),
    // مكلّفو المخرجات (نصّ خام بكتل متوازية لكتل المخرجات) — تُحلَّل في الواجهة
    assignees: get('dvowners'),
    status,
    isDone,
    isMeeting,
    meetings,
    ...flags,
  };
}

// اكتشاف صف العناوين تلقائياً (يحصّن ضد إدراج صفوف فوق الجدول)
function findHeaderIdx(rows) {
  return rows.findIndex(
    (r) => Array.isArray(r)
      && r.some((c) => norm(c) === 'المشروع')
      && r.some((c) => ['المسؤول المعني', 'المخرج المطلوب'].includes(norm(c)))
  );
}

// قراءة صف العناوين + خريطة الأعمدة (لتبويب محدّد)
async function readHeader(tab, useKey = true) {
  const res = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(tab, `A1:${WIDE_COL}60`),
    ...(useKey ? keyParam() : {}),
  }));
  const rows = res.data.values || [];
  let h = findHeaderIdx(rows);
  if (h === -1) h = 1;
  return { rows, h, header: rows[h] || [], cols: mapColumns(rows[h] || []) };
}

/** قراءة كل مهام التبويب (البروفايل) المحدّد مع الأعلام الزمنية. */
async function getTasks(tab) {
  const res = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(tab, `A1:${WIDE_COL}1000`),
    ...keyParam(),
  }));
  const rows = res.data.values || [];
  let h = findHeaderIdx(rows);
  if (h === -1) h = 1; // افتراضي
  const cols = mapColumns(rows[h] || []);
  const tasks = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (rowHasContent(rows[i] || [], cols)) tasks.push(buildTask(rows[i] || [], i + 1, cols));
  }
  await normalizeLogs(tab, rows, h, cols);
  return tasks;
}

// لكل صفّ: إن كان عدد كتل «المتابعة» أكبر من «السجل» (أحداث يدوية بلا سجل) نملأ السجل بـ«----------» للمحاذاة.
async function normalizeLogs(tab, rows, h, cols) {
  if (!canWrite || cols.followup == null || cols.log == null) return;
  const data = [];
  const colorItems = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!rowHasContent(r, cols)) continue;
    const fb = fuBlocks(r[cols.followup]);
    const lb = fuBlocks(r[cols.log]);
    if (fb.length !== lb.length) {
      // محاذاة «السجل» مع «المتابعة»: نملأ الناقص بـ«----------» ونقصّ الزائد (سجلّات يتيمة)
      const aligned = fb.length > lb.length
        ? lb.concat(new Array(fb.length - lb.length).fill('----------'))
        : lb.slice(0, fb.length);
      const newLog = aligned.join('\n\n');
      data.push({ range: range(tab, `${numToLetter(cols.log)}${i + 1}`), values: [[newLog]] });
      colorItems.push({ row: i + 1, col: cols.followup, text: r[cols.followup] });
      colorItems.push({ row: i + 1, col: cols.log, text: newLog });
    }
  }
  if (data.length) {
    try {
      await withRetry(() => sheetsApi().spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data } }));
      await colorCells(tab, colorItems);
    } catch (e) { console.warn('normalizeLogs:', e.message); }
  }
}

/** التأكد من وجود عمود بعنوان معيّن في تبويب؛ يُنشأ في نهاية الجدول إن غاب. */
async function ensureColumn(tab, headerName) {
  if (!canWrite) return false;
  const { header, h } = await readHeader(tab, false);
  if (header.some((c) => norm(c) === norm(headerName))) return true;
  const newIdx = header.length;
  await withRetry(() => sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(tab, `${numToLetter(newIdx)}${h + 1}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[headerName]] },
  }));
  return true;
}

/** التأكد من الأعمدة التي يديرها التطبيق في تبويب معيّن. */
async function ensureColumns(tab) {
  if (!canWrite) return false;
  for (const name of MANAGED_COLUMNS) await ensureColumn(tab, name);
  return true;
}

/** إنشاء تبويب بروفايل جديد بنفس بنية جدول التبويب الأول (العناوين) — يتطلب صلاحية كتابة. */
async function createProfileTab(tabName) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const name = String(tabName || '').trim();
  if (!name) throw new Error('اسم البروفايل فارغ');
  const tabs = await listTabs();
  const existed = tabs.includes(name);
  if (!existed) {
    await withRetry(() => sheetsApi().spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: name } } }] } }));
  }
  // ننسخ بنية الجدول فقط إن كان التبويب جديداً أو بلا صف عناوين (لئلا نكتب فوق تبويب موجود فيه بيانات)
  let needHeader = !existed;
  if (existed) {
    const chk = await withRetry(() => sheetsApi().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: range(name, `A1:${WIDE_COL}10`) }));
    needHeader = findHeaderIdx(chk.data.values || []) === -1;
  }
  if (needHeader) {
    const src = await withRetry(() => sheetsApi().spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: range(TAB, `A1:${WIDE_COL}10`) }));
    const rows = src.data.values || [];
    let h = findHeaderIdx(rows); if (h === -1) h = 2; // الصف 3 افتراضياً
    const headerRows = rows.slice(0, h + 1);
    if (headerRows.length) {
      await withRetry(() => sheetsApi().spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: range(name, 'A1'), valueInputOption: 'RAW', requestBody: { values: headerRows } }));
    }
  }
  _sheetIds = {};
  return true;
}

function normalizeWriteValue(field, value) {
  return value == null ? '' : String(value);
}

// إن احتوى التحديث على مصفوفة «meetings» نحوّلها لعمودَي العناوين/الجدولة المتوازيين
function expandMeetings(obj) {
  const work = { ...(obj || {}) };
  if ('meetings' in work) {
    const mc = meetingsToCols(work.meetings);
    work.meeting = mc.meeting;
    work.scheduled = mc.scheduled;
    delete work.meetings;
  }
  return work;
}

/** تعديل مهمة قائمة في تبويب: نقرأ الصف، نطبّق التغييرات حسب أسماء الأعمدة، ونعيد كتابته. */
async function updateTask(tab, rowNumber, patch) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 3) throw new Error('BAD_ROW');

  const { cols } = await readHeader(tab, false);
  const res = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(tab, `A${row}:${WIDE_COL}${row}`),
  }));
  const current = (res.data.values && res.data.values[0]) || [];
  const maxIdx = Math.max(-1, ...Object.values(cols));
  while (current.length <= maxIdx) current.push('');

  const clears = []; // خلايا صارت فارغة (نُفرّغها صراحةً لضمان المسح)
  const expanded = expandMeetings(patch);
  for (const [field, value] of Object.entries(expanded)) {
    const key = field === 'deadlineRaw' ? 'deadline' : field;
    if (cols[key] != null && key in HEADER_ALIASES) {
      current[cols[key]] = normalizeWriteValue(key, value);
      if (current[cols[key]] === '') clears.push(cols[key]);
    }
  }

  // تثبيت تاريخ الإنجاز: يُملأ تلقائياً لحظة تحويل الحالة إلى «منجزة» (فيتجمّد تعليق الموعد)،
  // ويُمسح عند الخروج من حالة «منجزة». لا يُحدَّث إلا حين يحوي التعديل حقل الحالة.
  if ('status' in expanded && cols.completed != null && cols.status != null) {
    const newStatus = current[cols.status];
    if (newStatus === DONE_STATUS) {
      if (!String(current[cols.completed] || '').trim()) current[cols.completed] = todayISO();
    } else if (String(current[cols.completed] || '').trim()) {
      current[cols.completed] = ''; clears.push(cols.completed);
    }
  }

  await withRetry(() => sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(tab, `A${row}:${numToLetter(current.length - 1)}${row}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [current] },
  }));
  // ضمان تفريغ الخلايا الفارغة (USER_ENTERED قد لا يمسح الخلية بالقيمة الفارغة)
  if (clears.length) {
    try {
      await withRetry(() => sheetsApi().spreadsheets.values.batchClear({
        spreadsheetId: SHEET_ID,
        requestBody: { ranges: clears.map((ci) => range(tab, `${numToLetter(ci)}${row}`)) },
      }));
    } catch (e) { console.warn('batchClear:', e.message); }
  }
  // تلوين خليتَي المتابعة/السجل فور الكتابة (يبقى التلوين دائماً حتى لأحداث الرابط)
  await colorCells(tab, [
    { row, col: cols.followup, text: current[cols.followup] },
    { row, col: cols.log, text: current[cols.log] },
  ]);
  return buildTask(current, row, cols);
}

/** إضافة مهمة جديدة في أول صفّ خالٍ فعلياً بعد العناوين. */
async function addTask(tab, task) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  // نقرأ القيم الفعلية لتحديد صفّ العناوين وأول صفّ خالٍ — لا نعتمد على values.append لأنه يتأثّر بنطاق
  // القوائم المنسدلة/التنسيق على الصفوف الفارغة (كما في تبويب منسوخ) فيضع المهمة في مكان بعيد للأسفل.
  const res = await withRetry(() => sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID, range: range(tab, `A1:${WIDE_COL}2000`),
  }));
  const rows = res.data.values || [];
  let h = findHeaderIdx(rows); if (h === -1) h = 1;
  const cols = mapColumns(rows[h] || []);
  const maxIdx = Math.max(-1, ...Object.values(cols));
  const row = new Array(maxIdx + 1).fill('');
  for (const [field, value] of Object.entries(expandMeetings(task))) {
    const key = field === 'deadlineRaw' ? 'deadline' : field;
    if (cols[key] != null && key in HEADER_ALIASES) row[cols[key]] = normalizeWriteValue(key, value);
  }
  if (cols.status != null && !row[cols.status]) row[cols.status] = DEFAULT_STATUS;
  // تعبئة «تاريخ إنشاء المهمة» تلقائياً بتاريخ اليوم إن لم يُحدَّد
  if (cols.created != null && !row[cols.created]) row[cols.created] = todayISO();
  // مهمة تُضاف وهي «منجزة» مباشرةً: ثبّت تاريخ الإنجاز اليوم
  if (cols.completed != null && row[cols.status] === DONE_STATUS && !row[cols.completed]) row[cols.completed] = todayISO();
  // أول صفّ بعد العناوين خالٍ من المحتوى الفعلي (نتجاوز الصفوف المملوءة المتتالية فقط)
  let targetIdx = h + 1;
  while (targetIdx < rows.length && rowHasContent(rows[targetIdx] || [], cols)) targetIdx++;
  const targetRow = targetIdx + 1; // رقم الصفّ الفعلي (1-based)
  await withRetry(() => sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(tab, `A${targetRow}:${numToLetter(row.length - 1)}${targetRow}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  }));
  return true;
}

/** حذف صفّ مهمة من تبويب. */
async function deleteTask(tab, rowNumber) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 3) throw new Error('BAD_ROW');
  const sheetId = await getSheetId(tab);
  await withRetry(() => sheetsApi().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] },
  }));
  return true;
}

module.exports = {
  SHEET_ID,
  TAB,
  STATUSES,
  TYPES,
  MEETING_STATUSES,
  MEETING_SCHEDULED,
  MEETING_UNSCHEDULED,
  SCHEDULE_HEADER,
  DONE_STATUS,
  DEFAULT_STATUS,
  canWrite,
  fuBlocks,
  getTasks,
  updateTask,
  addTask,
  deleteTask,
  ensureColumns,
  createProfileTab,
  listTabs,
  ensureStatusColumn: ensureColumns, // توافق مع الاسم القديم
};
