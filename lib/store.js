'use strict';

/**
 * طبقة تخزين دائم لبيانات المنصة (مستخدمون/تذكيرات/اشتراكات Push)
 * في ملف Google Sheet خاص ومنفصل عن ملف المهام، عبر نفس حساب الخدمة.
 *
 * يُفعّل عند ضبط DATA_SHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON.
 * عند غيابهما: المستخدمون يُقرأون من USERS_JSON (قراءة فقط)، والتذكيرات/Push في الذاكرة.
 */

const { google } = require('googleapis');
const crypto = require('crypto');

const DATA_SHEET_ID = process.env.DATA_SHEET_ID || '';
const hasSA = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const enabled = !!(DATA_SHEET_ID && hasSA);

const TABS = {
  users: { title: 'users', header: ['email', 'name', 'role', 'hash', 'active', 'token', 'createdAt', 'firstName', 'lastName', 'profiles', 'phone', 'telegramChatId'] },
  reminders: { title: 'reminders', header: ['email', 'taskRow', 'methods', 'offsets', 'updatedAt', 'dates', 'time', 'repeatCount', 'repeatEvery'] },
  push: { title: 'push', header: ['email', 'endpoint', 'subscription'] },
  profiles: { title: 'profiles', header: ['tab', 'label'] },
};

// البروفايل الأول الافتراضي — اسم التبويب = اسم البروفايل بالضبط
const DEF_TAB = process.env.SHEET_TAB || 'لوحة الإدارة التنفيذية';
const DEFAULT_PROFILE = { tab: DEF_TAB, label: DEF_TAB };

const firstToken = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const restTokens = (s) => String(s || '').trim().split(/\s+/).slice(1).join(' ');
const normPhone = (s) => String(s || '').replace(/\D/g, '');

let _sheets;
function api() {
  if (_sheets) return _sheets;
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  _sheets = google.sheets({ version: 'v4', auth });
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
      console.warn('store: انقطاع عابر مع Google، إعادة المحاولة', i + 1, '-', e.message);
      await new Promise((r) => setTimeout(r, 350 * Math.pow(2, i))); // 350ms, 700ms, 1400ms
    }
  }
  throw last;
}

// ===== تهيئة التبويبات =====
let _initDone = false;
async function ensureTabs() {
  if (!enabled || _initDone) return;
  const meta = await withRetry(() => api().spreadsheets.get({ spreadsheetId: DATA_SHEET_ID, fields: 'sheets.properties.title' }));
  const existing = new Set((meta.data.sheets || []).map((s) => s.properties.title));
  const requests = [];
  for (const t of Object.values(TABS)) {
    if (!existing.has(t.title)) requests.push({ addSheet: { properties: { title: t.title } } });
  }
  if (requests.length) {
    await withRetry(() => api().spreadsheets.batchUpdate({ spreadsheetId: DATA_SHEET_ID, requestBody: { requests } }));
  }
  // كتابة/ترقية صف العناوين لكل تبويب (يضيف الأعمدة الجديدة للتبويبات القائمة دون المساس بالبيانات)
  for (const t of Object.values(TABS)) {
    const r = await withRetry(() => api().spreadsheets.values.get({ spreadsheetId: DATA_SHEET_ID, range: `${t.title}!A1:Z1` }));
    const cur = (r.data.values && r.data.values[0]) || [];
    if (cur.length < t.header.length) {
      await withRetry(() => api().spreadsheets.values.update({
        spreadsheetId: DATA_SHEET_ID, range: `${t.title}!A1`, valueInputOption: 'RAW',
        requestBody: { values: [t.header] },
      }));
    }
  }
  _initDone = true;
}

async function readRows(tab) {
  await ensureTabs();
  const r = await withRetry(() => api().spreadsheets.values.get({ spreadsheetId: DATA_SHEET_ID, range: `${tab}!A2:Z10000` }));
  return r.data.values || [];
}

// ===== المستخدمون =====
function rowToUser(r) {
  const name = r[1] || r[0] || '';
  return {
    email: (r[0] || '').trim(),
    name,
    role: r[2] || 'viewer',
    hash: r[3] || '',
    active: String(r[4]).toUpperCase() !== 'FALSE',
    token: r[5] || '',
    firstName: r[7] || firstToken(name),
    lastName: r[8] || restTokens(name),
    profiles: (r[9] || '').split(',').map((s) => s.trim()).filter(Boolean),
    phone: (r[10] || '').trim(),
    telegramChatId: (r[11] || '').trim(),
  };
}

let _userCache = { at: 0, rows: [] };
async function getUsersFull() {
  if (!enabled) return null; // المنادي يستخدم البديل (USERS_JSON)
  const now = Date.now();
  if (now - _userCache.at < 5000 && _userCache.rows.length) return _userCache.rows;
  const rows = (await readRows('users')).map(rowToUser).filter((u) => u.email);
  _userCache = { at: now, rows };
  return rows;
}

function invalidateUsers() { _userCache = { at: 0, rows: [] }; }

async function findUserRowIndex(email) {
  const rows = await readRows('users');
  const idx = rows.findIndex((r) => (r[0] || '').trim().toLowerCase() === email.toLowerCase());
  return idx === -1 ? -1 : idx + 2; // رقم الصف الفعلي
}

async function addUser({ email, name, firstName, lastName, role, hash, profiles, phone }) {
  if (!enabled) throw new Error('STORE_DISABLED');
  const existing = await findUserRowIndex(email);
  if (existing !== -1) throw new Error('المستخدم موجود مسبقاً');
  const fn = (firstName || '').trim();
  const ln = (lastName || '').trim();
  const full = (name || `${fn} ${ln}`.trim()) || email;
  const token = crypto.randomBytes(18).toString('hex');
  const prof = Array.isArray(profiles) ? profiles.join(',') : (profiles || '');
  await withRetry(() => api().spreadsheets.values.append({
    spreadsheetId: DATA_SHEET_ID, range: 'users!A2', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[email, full, role || 'viewer', hash, 'TRUE', token, new Date().toISOString(), fn, ln, prof, (phone || '').trim(), '']] },
  }));
  invalidateUsers();
  return { email, name: full, firstName: fn, lastName: ln, role, token };
}

async function updateUser(email, patch) {
  if (!enabled) throw new Error('STORE_DISABLED');
  const row = await findUserRowIndex(email);
  if (row === -1) throw new Error('غير موجود');
  const cur = (await withRetry(() => api().spreadsheets.values.get({ spreadsheetId: DATA_SHEET_ID, range: `users!A${row}:L${row}` }))).data.values?.[0] || [];
  while (cur.length < 12) cur.push('');
  const map = { email: 0, name: 1, role: 2, hash: 3, active: 4, firstName: 7, lastName: 8, profiles: 9, phone: 10, telegramChatId: 11 };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in map)) continue;
    if (k === 'profiles') cur[9] = Array.isArray(v) ? v.join(',') : (v || '');
    else cur[map[k]] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
  }
  // مزامنة الاسم الكامل عند تغيير الاسم الأول/الأخير
  if ('firstName' in patch || 'lastName' in patch) cur[1] = `${cur[7] || ''} ${cur[8] || ''}`.trim() || cur[1];
  await withRetry(() => api().spreadsheets.values.update({ spreadsheetId: DATA_SHEET_ID, range: `users!A${row}:L${row}`, valueInputOption: 'RAW', requestBody: { values: [cur] } }));
  invalidateUsers();
  return true;
}

// ربط رقم تيليجرام (من البوت) بحساب المستخدم المطابق رقمه — يحفظ chat_id
async function linkTelegram(phoneDigits, chatId) {
  if (!enabled || !phoneDigits) return null;
  const rows = await readRows('users');
  let idx = rows.findIndex((r) => normPhone(r[10]) === phoneDigits);
  // مطابقة احتياطية: تطابق نهاية الرقم (في حال نقص/زيادة رمز الدولة)
  if (idx === -1) idx = rows.findIndex((r) => { const p = normPhone(r[10]); return p && p.length >= 8 && (p.endsWith(phoneDigits) || phoneDigits.endsWith(p)); });
  if (idx === -1) return null;
  const row = idx + 2;
  const cur = (await withRetry(() => api().spreadsheets.values.get({ spreadsheetId: DATA_SHEET_ID, range: `users!A${row}:L${row}` }))).data.values?.[0] || [];
  while (cur.length < 12) cur.push('');
  cur[11] = String(chatId);
  await withRetry(() => api().spreadsheets.values.update({ spreadsheetId: DATA_SHEET_ID, range: `users!A${row}:L${row}`, valueInputOption: 'RAW', requestBody: { values: [cur] } }));
  invalidateUsers();
  return { name: rows[idx][1] || rows[idx][0], email: rows[idx][0] };
}

// ===== البروفايلات =====
async function getProfiles() {
  if (!enabled) return [DEFAULT_PROFILE];
  const rows = await readRows('profiles');
  const list = rows.map((r) => ({ tab: (r[0] || '').trim(), label: (r[1] || r[0] || '').trim() })).filter((p) => p.tab);
  // نضمن وجود البروفايل الأول دائماً في الأعلى
  if (!list.some((p) => p.tab === DEFAULT_PROFILE.tab)) list.unshift({ ...DEFAULT_PROFILE });
  return list;
}

async function addProfile(tab, label) {
  if (!enabled) throw new Error('STORE_DISABLED');
  const name = String(tab || '').trim();
  if (!name) throw new Error('اسم البروفايل مطلوب');
  const list = await getProfiles();
  if (list.some((p) => p.tab === name)) throw new Error('البروفايل موجود مسبقاً');
  await withRetry(() => api().spreadsheets.values.append({
    spreadsheetId: DATA_SHEET_ID, range: 'profiles!A2', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[name, String(label || name).trim()]] },
  }));
  return { tab: name, label: String(label || name).trim() };
}

async function getUserByToken(token) {
  if (!enabled || !token) return null;
  const rows = await getUsersFull();
  return rows.find((u) => u.token === token && u.active) || null;
}

// ===== التذكيرات =====
async function getReminders(email) {
  if (!enabled) return {};
  const rows = await readRows('reminders');
  const out = {};
  rows.forEach((r) => {
    if ((r[0] || '').toLowerCase() === email.toLowerCase()) {
      out[r[1]] = { methods: (r[2] || '').split(',').filter(Boolean), offsets: (r[3] || '').split(',').filter(Boolean), dates: (r[5] || '').split(',').filter(Boolean), time: r[6] || '', repeatCount: r[7] || '', repeatEvery: r[8] || '' };
    }
  });
  return out;
}

async function getAllReminders() {
  if (!enabled) return [];
  const rows = await readRows('reminders');
  return rows.map((r) => ({ email: r[0], taskRow: String(r[1]), methods: (r[2] || '').split(',').filter(Boolean), offsets: (r[3] || '').split(',').filter(Boolean), dates: (r[5] || '').split(',').filter(Boolean), time: r[6] || '', repeatCount: r[7] || '', repeatEvery: r[8] || '' }))
    .filter((x) => x.email && x.taskRow);
}

async function setReminder(email, taskRow, methods, offsets, dates, time, repeatCount, repeatEvery) {
  if (!enabled) throw new Error('STORE_DISABLED');
  const rows = await readRows('reminders');
  const idx = rows.findIndex((r) => (r[0] || '').toLowerCase() === email.toLowerCase() && String(r[1]) === String(taskRow));
  const value = [email, String(taskRow), methods.join(','), offsets.join(','), new Date().toISOString(), (dates || []).join(','), time || '', String(repeatCount || ''), String(repeatEvery || '')];
  if (idx === -1) {
    await withRetry(() => api().spreadsheets.values.append({ spreadsheetId: DATA_SHEET_ID, range: 'reminders!A2', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [value] } }));
  } else {
    const row = idx + 2;
    await withRetry(() => api().spreadsheets.values.update({ spreadsheetId: DATA_SHEET_ID, range: `reminders!A${row}:I${row}`, valueInputOption: 'RAW', requestBody: { values: [value] } }));
  }
  return true;
}

// ===== اشتراكات Push =====
async function savePush(email, sub) {
  if (!enabled || !sub || !sub.endpoint) return;
  const rows = await readRows('push');
  const idx = rows.findIndex((r) => r[1] === sub.endpoint);
  const value = [email, sub.endpoint, JSON.stringify(sub)];
  if (idx === -1) await withRetry(() => api().spreadsheets.values.append({ spreadsheetId: DATA_SHEET_ID, range: 'push!A2', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [value] } }));
  else { const row = idx + 2; await withRetry(() => api().spreadsheets.values.update({ spreadsheetId: DATA_SHEET_ID, range: `push!A${row}:C${row}`, valueInputOption: 'RAW', requestBody: { values: [value] } })); }
}

async function getPushByEmail(email) {
  if (!enabled) return [];
  const rows = await readRows('push');
  return rows.filter((r) => (r[0] || '').toLowerCase() === email.toLowerCase()).map((r) => { try { return JSON.parse(r[2]); } catch { return null; } }).filter(Boolean);
}

module.exports = {
  enabled, DATA_SHEET_ID, DEFAULT_PROFILE,
  getUsersFull, addUser, updateUser, getUserByToken, invalidateUsers,
  getReminders, getAllReminders, setReminder,
  savePush, getPushByEmail,
  getProfiles, addProfile,
  linkTelegram,
};
