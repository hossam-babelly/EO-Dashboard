'use strict';

const nodemailer = require('nodemailer');
const webpush = require('web-push');

// ===== البريد =====
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
      <h2 style="margin:0">لوحة المكتب التنفيذي — الملخص اليومي</h2>
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

  const tr = getTransporter();
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  // بريد ملخّص عام
  if (tr && process.env.NOTIFY_EMAIL && total > 0) {
    try {
      await tr.sendMail({ from, to: process.env.NOTIFY_EMAIL, subject: `ملخص المهام — ${total} مهمة مستحقة`, html: buildDigestHtml(b, appUrl) });
      results.email++;
    } catch (e) { results.errors.push('email: ' + e.message); }
  }

  // بريد لكل مسؤول حسب خريطة OWNER_EMAILS
  const map = ownerEmails();
  if (tr && Object.keys(map).length && total > 0) {
    const all = [...b.overdue, ...b.today, ...b.soon];
    for (const [owner, email] of Object.entries(map)) {
      const personal = { overdue: b.overdue.filter((t) => t.owners.includes(owner)), today: b.today.filter((t) => t.owners.includes(owner)), soon: b.soon.filter((t) => t.owners.includes(owner)) };
      const pTotal = personal.overdue.length + personal.today.length + personal.soon.length;
      if (!pTotal) continue;
      try {
        await tr.sendMail({ from, to: email, subject: `مهامك المستحقة — ${pTotal}`, html: buildDigestHtml(personal, appUrl) });
        results.email++;
      } catch (e) { results.errors.push(`email ${owner}: ${e.message}`); }
    }
    void all;
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

module.exports = {
  getTransporter, initVapid, addSubscription, removeSubscription, subscriptionCount,
  dueBuckets, buildDigestHtml, sendDailyDigest,
};
