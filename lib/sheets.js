'use strict';

const { google } = require('googleapis');
const { parseDeadline, classify } = require('./dates');

const SHEET_ID = process.env.SHEET_ID || '1GaGuwrOioQi8CKhxzJGmYemRPD1dso8ASoa_pQI-Ky8';
const TAB = process.env.SHEET_TAB || 'الملخص التنفيذي';

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
const TYPES = ['E-mail', 'مجلس الإدارة', 'مكتب تنفيذي'];

// مرادفات أسماء العناوين لكل حقل (تُطابَق بعد تطبيع المسافات). أضِف مرادفاً جديداً لو غيّرت عنواناً.
const HEADER_ALIASES = {
  num: ['م'],
  project: ['المشروع'],
  dept: ['القسم / الشركة / المشروع', 'القسم/الشركة/المشروع', 'القسم'],
  file: ['الملف'],
  type: ['النوع'],
  owner: ['المسؤول المعني', 'المسؤول'],
  deliverable: ['المخرج المطلوب'],
  deadline: ['الموعد / الدورية', 'الموعد/الدورية', 'الموعد'],
  priority: ['الأولوية'],
  followup: ['نتائج المتابعة اليومية', 'المتابعة اليومية'],
  source: ['مصدر المهمة', 'المصدر'],
  meeting: ['اجتماع'],
  scheduled: ['تمت جدولة الاجتماع', 'تم جدولة الاجتماع'],
  notes: ['ملاحظات'],
  status: ['الحالة'],
};

// الأعمدة التي يضمن التطبيق وجودها
const MANAGED_COLUMNS = ['الحالة', 'تمت جدولة الاجتماع'];
const SCHEDULE_HEADER = 'تمت جدولة الاجتماع';

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

// عند استخدام مفتاح API (قراءة فقط) نمرّر المفتاح مع كل طلب
function keyParam() {
  return useServiceAccount ? {} : { key: process.env.GOOGLE_API_KEY };
}

function range(a1) {
  return `'${TAB}'!${a1}`;
}

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const TRUTHY = /^(true|نعم|✓|yes|y|1|checked)$/i;

// تحويل رقم عمود (0=A) إلى حرفه
function numToLetter(n) {
  let s = '';
  n = Number(n);
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
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
  const isMeeting = TRUTHY.test(get('meeting'));
  const meetingScheduled = isMeeting && TRUTHY.test(get('scheduled'));
  const meetingStatus = isMeeting ? (meetingScheduled ? MEETING_SCHEDULED : MEETING_UNSCHEDULED) : '';

  return {
    id: rowNumber, // معرّف ثابت = رقم الصف في الشيت
    row: rowNumber,
    num: get('num'),
    project: get('project'),
    dept: get('dept'),
    file: get('file'),
    type,
    owner: get('owner'),
    owners: splitOwners(get('owner')),
    deliverable: get('deliverable'),
    deadlineRaw,
    deadlineIso: parsed.iso,
    recurrence: parsed.recurrence,
    priority: get('priority') || 'غير محددة',
    followup: get('followup'),
    source: get('source'),
    notes: get('notes'),
    status,
    isDone,
    isMeeting,
    meetingScheduled,
    meetingStatus,
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

// قراءة صف العناوين + خريطة الأعمدة
async function readHeader(useKey = true) {
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(`A1:${WIDE_COL}60`),
    ...(useKey ? keyParam() : {}),
  });
  const rows = res.data.values || [];
  let h = findHeaderIdx(rows);
  if (h === -1) h = 1;
  return { rows, h, header: rows[h] || [], cols: mapColumns(rows[h] || []) };
}

// gid التبويب (لطلبات batchUpdate) — يُقرأ مرّة ويُخزَّن
let _sheetId = null;
async function getSheetId() {
  if (_sheetId != null) return _sheetId;
  const meta = await sheetsApi().spreadsheets.get({ spreadsheetId: SHEET_ID, fields: 'sheets.properties(sheetId,title)' });
  const list = meta.data.sheets || [];
  const sh = list.find((s) => s.properties && s.properties.title === TAB) || list[0];
  _sheetId = sh ? sh.properties.sheetId : 0;
  return _sheetId;
}

// طلب إظهار/إخفاء مربّع اختيار في خلية واحدة (الإخفاء يُفرّغ القيمة والتحقق معاً)
function checkboxRequest(sheetId, rowIdx0, colIdx, on) {
  const cellRange = { sheetId, startRowIndex: rowIdx0, endRowIndex: rowIdx0 + 1, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 };
  if (on) {
    return { repeatCell: { range: cellRange, cell: { dataValidation: { condition: { type: 'BOOLEAN' }, strict: true } }, fields: 'dataValidation' } };
  }
  return { repeatCell: { range: cellRange, cell: {}, fields: 'userEnteredValue,dataValidation' } };
}

// تطبيق مجموعة تعديلات على مربّعات «تمت جدولة الاجتماع»
async function setScheduleCheckboxes(items) {
  if (!canWrite || !items || !items.length) return;
  const sheetId = await getSheetId();
  const requests = items.map((it) => checkboxRequest(sheetId, it.rowIdx0, it.colIdx, it.on));
  await sheetsApi().spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
}

// مزامنة مربّعات الجدولة مع عمود «اجتماع»: مربّع يظهر فقط عند تفعيل الاجتماع، وإلا تُفرَّغ الخلية.
// تعتمد على القيم فقط (خلية المربّع تُعيد TRUE/FALSE دائماً، وخلافها فارغة) فلا تكتب إلا عند وجود تعارض.
async function normalizeSchedule(rows, h, cols) {
  if (!canWrite || cols.scheduled == null || cols.meeting == null) return;
  const fixes = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!rowHasContent(r, cols)) continue;
    const meeting = TRUTHY.test(String(r[cols.meeting] != null ? r[cols.meeting] : '').trim());
    const sVal = String(r[cols.scheduled] != null ? r[cols.scheduled] : '').trim().toUpperCase();
    const hasBox = sVal === 'TRUE' || sVal === 'FALSE';
    if (meeting && !hasBox) fixes.push({ rowIdx0: i, colIdx: cols.scheduled, on: true });
    else if (!meeting && hasBox) fixes.push({ rowIdx0: i, colIdx: cols.scheduled, on: false });
  }
  if (fixes.length) {
    try { await setScheduleCheckboxes(fixes); }
    catch (e) { console.warn('normalizeSchedule:', e.message); }
  }
}

/** قراءة كل المهام من تبويب الملخص التنفيذي مع الأعلام الزمنية. */
async function getTasks() {
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(`A1:${WIDE_COL}1000`),
    ...keyParam(),
  });
  const rows = res.data.values || [];
  let h = findHeaderIdx(rows);
  if (h === -1) h = 1; // افتراضي
  const cols = mapColumns(rows[h] || []);
  const tasks = [];
  for (let i = h + 1; i < rows.length; i++) {
    if (rowHasContent(rows[i] || [], cols)) tasks.push(buildTask(rows[i] || [], i + 1, cols));
  }
  // مزامنة مربّعات الجدولة (لا تكتب إلا عند وجود تعارض) — تُعالج أيضاً تعديلاتك اليدوية على الشيت
  await normalizeSchedule(rows, h, cols);
  return tasks;
}

/** التأكد من وجود عمود بعنوان معيّن؛ يُنشأ في نهاية الجدول إن غاب (يتطلب صلاحية كتابة). */
async function ensureColumn(headerName) {
  if (!canWrite) return false;
  const { header, h } = await readHeader(false);
  if (header.some((c) => norm(c) === norm(headerName))) return true;
  const newIdx = header.length;
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(`${numToLetter(newIdx)}${h + 1}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[headerName]] },
  });
  return true;
}

/** التأكد من الأعمدة التي يديرها التطبيق (الحالة + تمت جدولة الاجتماع). */
async function ensureColumns() {
  if (!canWrite) return false;
  for (const name of MANAGED_COLUMNS) await ensureColumn(name);
  return true;
}

function normalizeWriteValue(field, value) {
  if (field === 'meeting' || field === 'scheduled') return value === true || TRUTHY.test(String(value)) ? 'TRUE' : 'FALSE';
  return value == null ? '' : String(value);
}

/** تعديل مهمة قائمة: نقرأ الصف، نطبّق التغييرات حسب أسماء الأعمدة، ونعيد كتابته. */
async function updateTask(rowNumber, patch) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < 3) throw new Error('BAD_ROW');

  const { cols } = await readHeader(false);
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(`A${row}:${WIDE_COL}${row}`),
  });
  const current = (res.data.values && res.data.values[0]) || [];
  const maxIdx = Math.max(-1, ...Object.values(cols));
  while (current.length <= maxIdx) current.push('');

  for (const [field, value] of Object.entries(patch || {})) {
    const key = field === 'deadlineRaw' ? 'deadline' : field;
    if (cols[key] != null && key in HEADER_ALIASES) current[cols[key]] = normalizeWriteValue(key, value);
  }

  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(`A${row}:${numToLetter(current.length - 1)}${row}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [current] },
  });

  // ضبط مربّع الجدولة لهذا الصف وفق حالة «اجتماع»
  if (cols.scheduled != null && cols.meeting != null) {
    const meetingOn = TRUTHY.test(String(current[cols.meeting] || '').trim());
    try { await setScheduleCheckboxes([{ rowIdx0: row - 1, colIdx: cols.scheduled, on: meetingOn }]); }
    catch (e) { console.warn('schedule checkbox:', e.message); }
  }
  return buildTask(current, row, cols);
}

/** إضافة مهمة جديدة في نهاية الجدول. */
async function addTask(task) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const { cols } = await readHeader(false);
  const maxIdx = Math.max(-1, ...Object.values(cols));
  const row = new Array(maxIdx + 1).fill('');
  for (const [field, value] of Object.entries(task || {})) {
    const key = field === 'deadlineRaw' ? 'deadline' : field;
    if (cols[key] != null && key in HEADER_ALIASES) row[cols[key]] = normalizeWriteValue(key, value);
  }
  if (cols.status != null && !row[cols.status]) row[cols.status] = DEFAULT_STATUS;
  const resp = await sheetsApi().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: range(`A1:${WIDE_COL}`),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  // ضبط مربّع الجدولة للصف الجديد
  const updated = resp.data.updates && resp.data.updates.updatedRange;
  const m = /!\$?[A-Z]+\$?(\d+):/.exec(updated || '');
  if (m && cols.scheduled != null && cols.meeting != null) {
    const meetingOn = TRUTHY.test(String(row[cols.meeting] || '').trim());
    try { await setScheduleCheckboxes([{ rowIdx0: Number(m[1]) - 1, colIdx: cols.scheduled, on: meetingOn }]); }
    catch (e) { console.warn('schedule checkbox (add):', e.message); }
  }
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
  getTasks,
  updateTask,
  addTask,
  ensureColumns,
  ensureStatusColumn: ensureColumns, // توافق مع الاسم القديم
};
