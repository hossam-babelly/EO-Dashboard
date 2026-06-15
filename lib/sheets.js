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

// الاجتماعات
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
  meetingStatus: ['حالة الاجتماع'],
  notes: ['ملاحظات'],
  status: ['الحالة'],
};

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

const TRUTHY_MEETING = /^(true|نعم|✓|yes|y|1|checked)$/i;

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
  const isMeeting = TRUTHY_MEETING.test(get('meeting'));
  let meetingStatus = get('meetingStatus');
  if (isMeeting && !meetingStatus) meetingStatus = MEETING_UNSCHEDULED;
  if (!isMeeting) meetingStatus = '';
  const meetingScheduled = meetingStatus === MEETING_SCHEDULED;

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
    meetingStatus,
    meetingScheduled,
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

// قراءة صف العناوين + خريطة الأعمدة (يُستخدم في القراءة والكتابة والإنشاء)
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
  return tasks;
}

/** التأكد من وجود عمود بعنوان معيّن؛ يُنشأ في نهاية الجدول إن غاب (يتطلب صلاحية كتابة). */
async function ensureColumn(headerName) {
  if (!canWrite) return false;
  const { header, h } = await readHeader(false);
  if (header.some((c) => norm(c) === norm(headerName))) return true;
  const newIdx = header.length; // إضافة عمود جديد في النهاية
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(`${numToLetter(newIdx)}${h + 1}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[headerName]] },
  });
  return true;
}

/** التأكد من الأعمدة التي يديرها التطبيق (الحالة + حالة الاجتماع). */
async function ensureColumns() {
  if (!canWrite) return false;
  await ensureColumn('الحالة');
  await ensureColumn('حالة الاجتماع');
  return true;
}

function normalizeWriteValue(field, value) {
  if (field === 'meeting') return value === true || TRUTHY_MEETING.test(String(value)) ? 'TRUE' : 'FALSE';
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
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: range(`A1:${WIDE_COL}`),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
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
  DONE_STATUS,
  DEFAULT_STATUS,
  canWrite,
  getTasks,
  updateTask,
  addTask,
  ensureColumns,
  ensureStatusColumn: ensureColumns, // توافق مع الاسم القديم
};
