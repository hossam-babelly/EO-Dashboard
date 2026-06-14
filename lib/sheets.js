'use strict';

const { google } = require('googleapis');
const { parseDeadline, classify } = require('./dates');

const SHEET_ID = process.env.SHEET_ID || '1GaGuwrOioQi8CKhxzJGmYemRPD1dso8ASoa_pQI-Ky8';
const TAB = process.env.SHEET_TAB || 'الملخص التنفيذي';

// ترتيب الأعمدة في تبويب «الملخص التنفيذي» (الصف ٢ = العناوين، البيانات من الصف ٣)
const COL = {
  num: 0, // م
  project: 1, // المشروع
  dept: 2, // القسم / الشركة / المشروع
  file: 3, // الملف
  owner: 4, // المسؤول المعني
  deliverable: 5, // المخرج المطلوب
  deadline: 6, // الموعد / الدورية
  priority: 7, // الأولوية
  followup: 8, // نتائج المتابعة اليومية
  source: 9, // مصدر المهمة
  notes: 10, // ملاحظات
  status: 11, // الحالة (عمود جديد) — L
};
const LAST_COL_LETTER = 'L';
const HEADER_ROW = 2;
const FIRST_DATA_ROW = 3;
const DONE_STATUS = 'منجزة';
const DEFAULT_STATUS = 'لم تبدأ';
const STATUSES = ['لم تبدأ', 'قيد التنفيذ', 'منجزة', 'متوقفة'];

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

function splitOwners(raw) {
  return String(raw || '')
    .split(/[\n,،/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowHasContent(r) {
  return [COL.project, COL.dept, COL.file, COL.owner, COL.deliverable].some(
    (i) => String(r[i] || '').trim()
  );
}

function buildTask(r, rowNumber) {
  const get = (i) => String(r[i] != null ? r[i] : '').trim();
  const status = get(COL.status) || DEFAULT_STATUS;
  const isDone = status === DONE_STATUS;
  const deadlineRaw = get(COL.deadline);
  const parsed = parseDeadline(deadlineRaw);
  const flags = classify(parsed, isDone);

  return {
    id: rowNumber, // معرّف ثابت = رقم الصف في الشيت
    row: rowNumber,
    num: get(COL.num),
    project: get(COL.project),
    dept: get(COL.dept),
    file: get(COL.file),
    owner: get(COL.owner),
    owners: splitOwners(get(COL.owner)),
    deliverable: get(COL.deliverable),
    deadlineRaw,
    deadlineIso: parsed.iso,
    recurrence: parsed.recurrence,
    priority: get(COL.priority) || 'غير محددة',
    followup: get(COL.followup),
    source: get(COL.source),
    notes: get(COL.notes),
    status,
    isDone,
    ...flags,
  };
}

/** قراءة كل المهام من تبويب الملخص التنفيذي مع الأعلام الزمنية. */
async function getTasks() {
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(`A${HEADER_ROW}:${LAST_COL_LETTER}1000`),
    ...keyParam(),
  });
  const rows = res.data.values || [];
  const dataRows = rows.slice(1); // تجاوز صف العناوين
  const tasks = [];
  dataRows.forEach((r, i) => {
    if (rowHasContent(r)) tasks.push(buildTask(r, FIRST_DATA_ROW + i));
  });
  return tasks;
}

/** التأكد من وجود عمود «الحالة» في العنوان (يتطلب صلاحية كتابة). */
async function ensureStatusColumn() {
  if (!canWrite) return false;
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(`A${HEADER_ROW}:${LAST_COL_LETTER}${HEADER_ROW}`),
  });
  const header = (res.data.values && res.data.values[0]) || [];
  if (String(header[COL.status] || '').trim() === 'الحالة') return true;
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(`${LAST_COL_LETTER}${HEADER_ROW}`),
    valueInputOption: 'RAW',
    requestBody: { values: [['الحالة']] },
  });
  return true;
}

const FIELD_TO_COL = {
  project: COL.project,
  dept: COL.dept,
  file: COL.file,
  owner: COL.owner,
  deliverable: COL.deliverable,
  deadlineRaw: COL.deadline,
  priority: COL.priority,
  followup: COL.followup,
  source: COL.source,
  notes: COL.notes,
  status: COL.status,
};

/** تعديل مهمة قائمة: نقرأ الصف، نطبّق التغييرات، ونعيد كتابته كاملاً. */
async function updateTask(rowNumber, patch) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const row = Number(rowNumber);
  if (!Number.isInteger(row) || row < FIRST_DATA_ROW) throw new Error('BAD_ROW');

  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: range(`A${row}:${LAST_COL_LETTER}${row}`),
  });
  const current = (res.data.values && res.data.values[0]) || [];
  while (current.length <= COL.status) current.push('');

  for (const [field, value] of Object.entries(patch || {})) {
    if (field in FIELD_TO_COL) current[FIELD_TO_COL[field]] = value == null ? '' : String(value);
  }

  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: range(`A${row}:${LAST_COL_LETTER}${row}`),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [current] },
  });
  return buildTask(current, row);
}

/** إضافة مهمة جديدة في نهاية الجدول. */
async function addTask(task) {
  if (!canWrite) throw new Error('WRITE_DISABLED');
  const row = new Array(COL.status + 1).fill('');
  for (const [field, value] of Object.entries(task || {})) {
    if (field in FIELD_TO_COL) row[FIELD_TO_COL[field]] = value == null ? '' : String(value);
  }
  if (!row[COL.status]) row[COL.status] = DEFAULT_STATUS;
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: range(`A${FIRST_DATA_ROW}:${LAST_COL_LETTER}`),
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
  DONE_STATUS,
  DEFAULT_STATUS,
  canWrite,
  getTasks,
  updateTask,
  addTask,
  ensureStatusColumn,
};
