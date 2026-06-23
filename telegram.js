'use strict';

/**
 * رفع مرفقات المهام إلى Google Drive (عبر OAuth لحساب Gmail المخصّص).
 * - يُفعَّل عند توفّر GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + (DRIVE_REFRESH_TOKEN أو GMAIL_REFRESH_TOKEN بنطاق Drive).
 * - الملفات تُرفع داخل مجلّد جذر «EO-Dashboard Attachments» (أو ATTACH_FOLDER_ID)،
 *   وداخله مجلّد فرعي لكل مهمة باسم «المشروع - الملف».
 * - نستخدم OAuth (لا حساب الخدمة) لأن حسابات الخدمة بلا سعة تخزين على Drive في حسابات Gmail الشخصية.
 */

const { google } = require('googleapis');
const { Readable } = require('stream');

const ROOT_NAME = 'EO-Dashboard Attachments';
const enabled = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && (process.env.DRIVE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN));

let _drive;
function api() {
  if (_drive) return _drive;
  const o = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.DRIVE_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN });
  _drive = google.drive({ version: 'v3', auth: o });
  return _drive;
}

// إعادة المحاولة عند انقطاعات Google العابرة
function isTransient(err) {
  const msg = String((err && (err.message || err.code)) || '').toLowerCase();
  const status = err && err.response && err.response.status;
  return /premature close|socket hang up|econnreset|etimedout|eai_again|enotfound|fetch failed|network|epipe|timeout/.test(msg)
    || [429, 500, 502, 503, 504].includes(Number(status));
}
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; if (i === tries - 1 || !isTransient(e)) throw e; await new Promise((r) => setTimeout(r, 350 * Math.pow(2, i))); }
  }
  throw last;
}

const q = (s) => String(s).replace(/['\\]/g, '\\$&'); // تهريب للاستعلام

let _rootId;
async function rootFolderId() {
  if (process.env.ATTACH_FOLDER_ID) return process.env.ATTACH_FOLDER_ID;
  if (_rootId) return _rootId;
  const query = `name='${q(ROOT_NAME)}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
  const list = await withRetry(() => api().files.list({ q: query, fields: 'files(id)', spaces: 'drive' }));
  if (list.data.files && list.data.files.length) { _rootId = list.data.files[0].id; return _rootId; }
  const created = await withRetry(() => api().files.create({ requestBody: { name: ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' }));
  _rootId = created.data.id;
  return _rootId;
}

// مجلّد المهمة «المشروع - الملف» (يُنشأ إن لم يوجد)
async function ensureSubfolder(name) {
  const root = await rootFolderId();
  const safe = String(name || 'مرفقات').trim() || 'مرفقات';
  const query = `name='${q(safe)}' and mimeType='application/vnd.google-apps.folder' and '${q(root)}' in parents and trashed=false`;
  const list = await withRetry(() => api().files.list({ q: query, fields: 'files(id)', spaces: 'drive' }));
  if (list.data.files && list.data.files.length) return list.data.files[0].id;
  const created = await withRetry(() => api().files.create({ requestBody: { name: safe, mimeType: 'application/vnd.google-apps.folder', parents: [root] }, fields: 'id' }));
  return created.data.id;
}

async function uploadFile({ folderName, filename, mimeType, buffer }) {
  if (!enabled) throw new Error('DRIVE_DISABLED');
  const folderId = await ensureSubfolder(folderName);
  const created = await withRetry(() => api().files.create({
    requestBody: { name: filename || 'ملف', parents: [folderId] },
    media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, name, webViewLink',
  }));
  // إتاحة الفتح لأي شخص يملك الرابط (الرابط نفسه سرّي ومحفوظ في الشيت)
  try { await withRetry(() => api().permissions.create({ fileId: created.data.id, requestBody: { role: 'reader', type: 'anyone' } })); }
  catch (e) { console.warn('drive permission:', e.message); }
  return { id: created.data.id, name: created.data.name, url: created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view` };
}

// استخراج معرّف الملف من رابط Drive
function fileIdFromUrl(url) {
  const s = String(url || '');
  const m = s.match(/\/d\/([^/]+)/) || s.match(/[?&]id=([^&]+)/);
  return m ? m[1] : '';
}

async function deleteFile(url) {
  if (!enabled) return;
  const id = fileIdFromUrl(url);
  if (!id) return;
  try { await withRetry(() => api().files.delete({ fileId: id })); }
  catch (e) { console.warn('drive delete:', e.message); }
}

module.exports = { enabled, uploadFile, deleteFile };
