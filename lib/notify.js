'use strict';

const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { google } = require('googleapis');
const { dayIndex, todayParts } = require('./dates');
const { OFFSET_DAYS } = require('./calendar');

const OFFSET_LABEL = { morning: 'صباح اليوم', '1d': 'قبل يوم', '3d': 'قبل ٣ أيام', '7d': 'قبل أسبوع', ondate: 'تاريخ محدّد' };
const pad2 = (n) => String(n).padStart(2, '0');

// ===== البريد =====
// يفضّل Brevo API (HTTP على 443، يعمل على Render) ثم SMTP كبديل.
let _transporter;
function getTransporter() {
  if (_transporter !== undefined) return _transporter;
  if (!process.env.SMTP_HOST) { _transporter = null; return null; }
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return _transporter;
}

const useGmail = () => !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
const useBrevo = () => !!process.env.BREVO_API_KEY;
const emailEnabled = () => useGmail() || useBrevo() || !!process.env.SMTP_HOST;
function emailProvider() { return useGmail() ? 'gmail' : useBrevo() ? 'brevo' : process.env.SMTP_HOST ? 'smtp' : 'none'; }
function senderEmail() { return process.env.GMAIL_SENDER || process.env.SMTP_FROM || process.env.SENDER_EMAIL || process.env.SMTP_USER || 'no-reply@eo-dashboard'; }
function senderName() { return process.env.SENDER_NAME || 'لوحة الإدارة التنفيذية'; }

// ===== Gmail API (عبر OAuth refresh token — يعمل على Render بلا منافذ SMTP ولا DNS) =====
let _gmail;
function gmailApi() {
  if (_gmail) return _gmail;
  const o = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
  o.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  _gmail = google.gmail({ version: 'v1', auth: o });
  return _gmail;
}
function buildRawEmail({ from, to, subject, html }) {
  const subjectEnc = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const lines = [
    `From: ${from}`, `To: ${to}`, `Subject: ${subjectEnc}`,
    'MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(html, 'utf8').toString('base64'),
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** إرسال بريد: Gmail API ثم Brevo ثم SMTP (واجهة موحّدة). */
async function sendEmail({ to, subject, html }) {
  if (useGmail()) {
    const raw = buildRawEmail({ from: `${senderName()} <${senderEmail()}>`, to, subject, html });
    await gmailApi().users.messages.send({ userId: 'me', requestBody: { raw } });
    return true;
  }
  if (useBrevo()) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: senderEmail(), name: senderName() }, to: [{ email: to }], subject, htmlContent: html }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    return true;
  }
  const tr = getTransporter();
  if (!tr) throw new Error('لم يُضبط البريد');
  await tr.sendMail({ from: senderEmail(), to, subject, html });
  return true;
}

// ===== Web Push =====
let _vapid;
function initVapid() {
  if (_vapid !== undefined) return _vapid;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:eo-dashboard@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    _vapid = true;
  } else {
    _vapid = false;
  }
  return _vapid;
}

// اشتراكات Push في الذاكرة؛ المتصفح يعيد الاشتراك عند كل فتح للصفحة
const pushSubs = new Map();
function addSubscription(sub) { if (sub && sub.endpoint) pushSubs.set(sub.endpoint, sub); }
function removeSubscription(endpoint) { pushSubs.delete(endpoint); }
function subscriptionCount() { return pushSubs.size; }

// ===== المنطق =====
function ownerEmails() {
  try { return process.env.OWNER_EMAILS ? JSON.parse(process.env.OWNER_EMAILS) : {}; } catch { return {}; }
}

function dueBuckets(tasks) {
  return {
    overdue: tasks.filter((t) => t.isOverdue && !t.isDone),
    today: tasks.filter((t) => t.isToday && !t.isDone),
    soon: tasks.filter((t) => t.isSoon3 && !t.isDone),
  };
}

function taskLine(t) {
  const rel = t.diffDays == null ? '' : t.diffDays < 0 ? `متأخرة ${Math.abs(t.diffDays)} يوم` : t.diffDays === 0 ? 'اليوم' : `بعد ${t.diffDays} يوم`;
  return `<tr>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.project)}${t.file ? ' — ' + esc(t.file) : ''}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.owner)}</td>
    <td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">${esc(t.deadlineRaw || '')} <span style="color:#888">${rel}</span></td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.priority)}</td></tr>`;
}

function section(title, color, list) {
  if (!list.length) return '';
  return `<h3 style="color:${color};margin:18px 0 6px">${title} (${list.length})</h3>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr style="background:#f3f7fb"><th style="padding:8px;text-align:right">المشروع / الملف</th><th style="padding:8px;text-align:right">المسؤول</th><th style="padding:8px;text-align:right">الموعد</th><th style="padding:8px;text-align:right">الأولوية</th></tr>
    ${list.map(taskLine).join('')}
  </table>`;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function buildDigestHtml(b, appUrl) {
  const total = b.overdue.length + b.today.length + b.soon.length;
  return `<div style="font-family:Cairo,Arial,sans-serif;direction:rtl;max-width:680px;margin:auto;color:#1a2535">
    <div style="background:linear-gradient(135deg,#1a3a5c,#2563a8);color:#fff;padding:20px;border-radius:12px 12px 0 0">
      <h2 style="margin:0">لوحة الإدارة التنفيذية — الملخص اليومي</h2>
      <p style="margin:6px 0 0;opacity:.85">مجموعة سنكري القابضة</p>
    </div>
    <div style="border:1px solid #e3e9f1;border-top:none;padding:20px;border-radius:0 0 12px 12px">
      <p>لديك <b>${total}</b> مهمة تحتاج انتباهك:</p>
      ${section('🔴 متأخرة', '#dc2626', b.overdue)}
      ${section('🟠 مستحقة اليوم', '#d97706', b.today)}
      ${section('🟡 خلال ٣ أيام', '#b8860b', b.soon)}
      ${appUrl ? `<p style="margin-top:20px"><a href="${appUrl}" style="background:#1a3a5c;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">فتح اللوحة</a></p>` : ''}
    </div></div>`;
}

/** إرسال الملخص اليومي عبر البريد و Web Push. */
async function sendDailyDigest(tasks, appUrl) {
  const b = dueBuckets(tasks);
  const total = b.overdue.length + b.today.length + b.soon.length;
  const results = { total, email: 0, push: 0, errors: [] };
  const canMail = emailEnabled();

  // بريد ملخّص عام
  if (canMail && process.env.NOTIFY_EMAIL && total > 0) {
    try {
      await sendEmail({ to: process.env.NOTIFY_EMAIL, subject: `ملخص المهام — ${total} مهمة مستحقة`, html: buildDigestHtml(b, appUrl) });
      results.email++;
    } catch (e) { results.errors.push('email: ' + e.message); }
  }

  // بريد لكل مسؤول حسب خريطة OWNER_EMAILS
  const map = ownerEmails();
  if (canMail && Object.keys(map).length && total > 0) {
    for (const [owner, email] of Object.entries(map)) {
      const personal = { overdue: b.overdue.filter((t) => t.owners.includes(owner)), today: b.today.filter((t) => t.owners.includes(owner)), soon: b.soon.filter((t) => t.owners.includes(owner)) };
      const pTotal = personal.overdue.length + personal.today.length + personal.soon.length;
      if (!pTotal) continue;
      try {
        await sendEmail({ to: email, subject: `مهامك المستحقة — ${pTotal}`, html: buildDigestHtml(personal, appUrl) });
        results.email++;
      } catch (e) { results.errors.push(`email ${owner}: ${e.message}`); }
    }
  }

  // Web Push
  if (initVapid() && total > 0) {
    const payload = JSON.stringify({
      title: `مهام مستحقة: ${total}`,
      body: `متأخرة ${b.overdue.length} • اليوم ${b.today.length} • قريبة ${b.soon.length}`,
      url: appUrl || '/',
    });
    for (const sub of [...pushSubs.values()]) {
      try { await webpush.sendNotification(sub, payload); results.push++; }
      catch (e) { if (e.statusCode === 410 || e.statusCode === 404) removeSubscription(sub.endpoint); }
    }
  }
  return results;
}

// ===== تذكيرات لكل مستخدم/مهمة حسب التوقيتات المختارة =====
function isoParts(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }

/** التوقيتات التي تُطلَق اليوم لمهمة معيّنة. */
function dueOffsetsToday(task, offsets) {
  const due = [];
  const tIdx = dayIndex(todayParts());
  if (task.deadlineIso) {
    const dIdx = dayIndex(isoParts(task.deadlineIso));
    for (const o of offsets) { const n = OFFSET_DAYS[o]; if (n == null) continue; if (dIdx - n === tIdx) due.push(o); }
  } else if (task.isRecurring) {
    // المهام الدورية: تذكير «صباح اليوم» عند وقوعها اليوم
    if (offsets.includes('morning') && task.isToday) due.push('morning');
  }
  return due;
}

function buildReminderHtml(items, appUrl) {
  const rows = items.map(({ t, offs }) => `<tr>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.project)}${t.file ? ' — ' + esc(t.file) : ''}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${esc(t.deadlineRaw || '')}</td>
    <td style="padding:8px;border-bottom:1px solid #eee">${offs.map((o) => OFFSET_LABEL[o] || o).join('، ')}</td></tr>`).join('');
  return `<div style="font-family:Cairo,Arial,sans-serif;direction:rtl;max-width:680px;margin:auto;color:#2b2823">
    <div style="background:linear-gradient(135deg,#2b2823,#4a443c);color:#fff;padding:20px;border-radius:12px 12px 0 0">
      <h2 style="margin:0">تذكير بمهامك</h2><p style="margin:6px 0 0;opacity:.85">مجموعة سنكري القابضة</p></div>
    <div style="border:1px solid #e7dfd1;border-top:none;padding:20px;border-radius:0 0 12px 12px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#faf6f0"><th style="padding:8px;text-align:right">المهمة</th><th style="padding:8px;text-align:right">الموعد</th><th style="padding:8px;text-align:right">التذكير</th></tr>
        ${rows}</table>
      ${appUrl ? `<p style="margin-top:20px"><a href="${appUrl}" style="background:#2b2823;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">فتح اللوحة</a></p>` : ''}
    </div></div>`;
}

/**
 * إرسال التذكيرات المستحقة اليوم لكل مستخدم وفق تفضيلاته (بريد/Push).
 * tasksByRow: خريطة الصف→المهمة. reminders: مصفوفة {email,taskRow,methods,offsets}.
 */
async function sendDueReminders(tasksByRow, reminders, appUrl, store) {
  const results = { emails: 0, push: 0, errors: [] };
  const canMail = emailEnabled();
  const byUser = {};
  const tp = todayParts();
  const todayIso = `${tp.y}-${pad2(tp.m)}-${pad2(tp.d)}`;

  for (const r of reminders) {
    const t = tasksByRow[String(r.taskRow)];
    if (!t || t.isDone) continue;
    const due = dueOffsetsToday(t, r.offsets);
    if (r.dates && r.dates.includes(todayIso)) due.push('ondate'); // تذكير بتاريخ ثابت
    if (!due.length) continue;
    byUser[r.email] = byUser[r.email] || { email: [], push: [] };
    if (r.methods.includes('email')) byUser[r.email].email.push({ t, offs: due });
    if (r.methods.includes('push')) byUser[r.email].push.push({ t, offs: due });
  }

  for (const [email, g] of Object.entries(byUser)) {
    if (canMail && g.email.length) {
      try { await sendEmail({ to: email, subject: `تذكير: ${g.email.length} مهمة مستحقة`, html: buildReminderHtml(g.email, appUrl) }); results.emails++; }
      catch (e) { results.errors.push(`email ${email}: ${e.message}`); }
    }
    if (initVapid() && g.push.length && store) {
      const subs = await store.getPushByEmail(email);
      const payload = JSON.stringify({ title: `تذكير: ${g.push.length} مهمة`, body: g.push.map((x) => x.t.project).filter(Boolean).join('، ').slice(0, 120), url: appUrl || '/' });
      for (const s of subs) { try { await webpush.sendNotification(s, payload); results.push++; } catch (e) { if (e.statusCode === 410 || e.statusCode === 404) { /* expired */ } } }
    }
  }
  return results;
}

module.exports = {
  getTransporter, sendEmail, emailEnabled, emailProvider, initVapid, addSubscription, removeSubscription, subscriptionCount,
  dueBuckets, buildDigestHtml, sendDailyDigest,
  dueOffsetsToday, sendDueReminders,
};
