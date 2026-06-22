'use strict';

const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { google } = require('googleapis');
const { dayIndex, todayParts } = require('./dates');
const { OFFSET_DAYS } = require('./calendar');
const telegram = require('./telegram');

const OFFSET_LABEL = { morning: 'صباح اليوم', '1d': 'قبل يوم', '3d': 'قبل ٣ أيام', '7d': 'قبل أسبوع', ondate: 'تاريخ محدّد' };
const pad2 = (n) => String(n).padStart(2, '0');

// التذكير الافتراضي للمهام (بديل ضمني لكل مسؤول لم يضبط تذكيراً خاصاً): تيليجرام، قبل يوم، 10:00
const DEFAULT_OWNER_REMINDER = { methods: ['telegram'], days: ['1d'], times: [{ t: '10:00', count: 1, every: 0 }] };

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
  const results = { emails: 0, push: 0, telegram: 0, errors: [] };
  const canMail = emailEnabled();
  const byUser = {};
  const tp = todayParts();
  const todayIso = `${tp.y}-${pad2(tp.m)}-${pad2(tp.d)}`;

  for (const r of reminders) {
    const t = tasksByRow[String(r.taskRow)];
    if (!t || t.isDone) continue;
    const due = dueOffsetsToday(t, r.days || r.offsets || []);
    if (r.dates && r.dates.includes(todayIso)) due.push('ondate'); // تذكير بتاريخ ثابت
    if (!due.length) continue;
    byUser[r.email] = byUser[r.email] || { email: [], push: [], telegram: [] };
    if (r.methods.includes('email')) byUser[r.email].email.push({ t, offs: due });
    if (r.methods.includes('push')) byUser[r.email].push.push({ t, offs: due });
    if (r.methods.includes('telegram')) byUser[r.email].telegram.push({ t, offs: due });
  }

  // خريطة البريد→chatId لإرسال تيليجرام
  let usersByEmail = {};
  if (telegram.enabled && store) {
    try { (await store.getUsersFull() || []).forEach((u) => { usersByEmail[(u.email || '').toLowerCase()] = u; }); } catch { /* تجاهل */ }
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
    if (telegram.enabled && g.telegram.length) {
      const u = usersByEmail[(email || '').toLowerCase()];
      if (u && u.telegramChatId) {
        const lines = g.telegram.map((x) => telegram.esc(`• ${x.t.project}${x.t.file ? ' — ' + x.t.file : ''} (${x.t.deadlineRaw || ''})`)).join('\n');
        const ok = await telegram.sendMessage(u.telegramChatId, `🔔 <b>تذكير بمهامك المستحقة (${g.telegram.length})</b>\n${lines}${appUrl ? '\n\n' + appUrl : ''}`);
        if (ok) results.telegram++;
      }
    }
  }
  return results;
}

// ===== التذكيرات المجدولة بالوقت الدقيق (تُطلَق من الخادم عبر نبضة cron) =====
// سوريا بتوقيت UTC+3 ثابت طوال السنة (أُلغي التوقيت الصيفي منذ 2022).
const DAMASCUS_OFFSET_MIN = Number(process.env.TZ_OFFSET_MIN || 180);

function damascusDateStr(epochMs) {
  const d = new Date(epochMs + DAMASCUS_OFFSET_MIN * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
// تحويل تاريخ ISO + إزاحة أيام إلى YYYY-MM-DD
function shiftIsoDate(iso, deltaDays) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}
// لحظة الإطلاق (epoch بالـ ms) لوقت جدار دمشقي
function damascusEpoch(dateStr, hh, mm) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - DAMASCUS_OFFSET_MIN * 60000;
}

// كل ظهور تذكير لمهمة ضمن تواريخ الإطلاق المسموح بها (اليوم/الأمس دمشقياً)
function reminderOccurrences(t, pref, allowedDates) {
  const times = (pref.times && pref.times.length) ? pref.times : [{ t: '09:00', count: 1, every: 0 }];
  const triggers = new Set();
  for (const off of (pref.days || [])) { const n = OFFSET_DAYS[off]; if (n == null || !t.deadlineIso) continue; triggers.add(shiftIsoDate(t.deadlineIso, -n)); }
  for (const fd of (pref.dates || [])) if (/^\d{4}-\d{2}-\d{2}$/.test(fd)) triggers.add(fd);
  const occ = [];
  for (const date of triggers) {
    if (!allowedDates.includes(date)) continue;
    times.forEach((tm, ti) => {
      const [hh, mm] = String(tm.t || '09:00').split(':').map(Number);
      const count = Math.max(1, Number(tm.count) || 1), every = Math.max(0, Number(tm.every) || 0);
      const base = damascusEpoch(date, hh || 0, mm || 0);
      for (let i = 0; i < count; i++) occ.push({ epoch: base + i * every * 60000, date, ti, i });
    });
  }
  return occ;
}

// طابع زمني دمشقي كامل من epoch (للتشخيص)
function damascusFull(epochMs) {
  const d = new Date(epochMs + DAMASCUS_OFFSET_MIN * 60000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
// ساعة:دقيقة دمشقية من epoch — تُستخدم في مفتاح منع التكرار (يعتمد على التوقيت الفعلي لا رقم الخانة)
function damascusHM(epochMs) {
  const d = new Date(epochMs + DAMASCUS_OFFSET_MIN * 60000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}
// مفتاح فريد لكل ظهور تذكير — يعتمد على (البريد|الصف|التاريخ|التوقيت الفعلي|رقم التكرار) كي لا يتصادم
// تعديلُ التوقيت إلى قيمة جديدة مع مفتاح سابق (الخطأ القديم كان يستخدم رقم الخانة ti فيتصادم).
function occKey(email, taskRow, occ) {
  return `${email}|${taskRow}|${occ.date}|${damascusHM(occ.epoch)}|${occ.i}`;
}

/**
 * محاكاة جافة لمحرّك التذكير (لا تُرسل ولا تُعلّم) — تُفسّر لكل تذكير لماذا يُطلَق أو لا.
 * تُستخدم في نقطة التشخيص /api/diag/reminders.
 */
async function analyzeReminders(tasksByRow, reminders, store, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const graceMin = (opts.graceMin != null ? opts.graceMin : Number(process.env.REMINDER_GRACE_MIN || 120));
  const graceMs = graceMin * 60000;
  const allowedDates = [damascusDateStr(now - 86400000), damascusDateStr(now)];
  const sentSet = store ? await store.getSentKeys() : new Set();
  const items = [];
  for (const r of reminders) {
    const t = tasksByRow[String(r.taskRow)];
    const isMtg = r.meeting !== '' && r.meeting != null;
    const item = { email: r.email, taskRow: String(r.taskRow), kind: isMtg ? `اجتماع #${r.meeting}` : 'مهمة', methods: r.methods || [], telegramSelected: (r.methods || []).includes('telegram'), days: r.days || [], dates: r.dates || [], times: r.times || [] };
    if (!t) { item.skip = 'المهمة غير موجودة لرقم الصف هذا (قد يكون الصف تغيّر/حُذف)'; items.push(item); continue; }
    item.task = `${t.project || ''}${t.file ? ' — ' + t.file : ''}`;
    // أساس المواعيد: موعد الاجتماع لتذكير الاجتماع، وموعد المهمة لتذكير المهمة
    let occBase, refId, baseIso;
    if (isMtg) {
      const m = (t.meetings || [])[Number(r.meeting)];
      if (!m) { item.skip = 'الاجتماع غير موجود (ربما حُذف أو أُعيد ترتيبه)'; items.push(item); continue; }
      item.meeting = m.title; item.meetingDatetime = m.datetime || null;
      if (m.status === 'done') { item.skip = 'الاجتماع انعقد (تُتجاوز التذكيرات)'; items.push(item); continue; }
      baseIso = (m.datetime || '').slice(0, 10) || null;
      occBase = { deadlineIso: baseIso }; refId = `${r.taskRow}#m${Number(r.meeting)}`;
    } else {
      item.deadline = t.deadlineRaw || null;
      item.isDone = !!t.isDone;
      if (t.isDone) { item.skip = 'المهمة منجزة (تُتجاوز التذكيرات)'; items.push(item); continue; }
      baseIso = t.deadlineIso; occBase = t; refId = String(r.taskRow);
    }
    item.hasBaseDate = !!baseIso;
    const occ = reminderOccurrences(occBase, r, allowedDates);
    item.occurrences = occ.map((o) => {
      const dueNow = o.epoch <= now && o.epoch >= now - graceMs;
      const baseKey = occKey(r.email, refId, o);
      return { at: damascusFull(o.epoch), state: dueNow ? 'مستحقّ الآن ✓' : (o.epoch > now ? 'مستقبلي (لم يحن بعد)' : 'فات نافذة السماح'), telegramAlreadySent: sentSet.has(baseKey + '|telegram') };
    });
    item.dueNowCount = item.occurrences.filter((o) => /مستحقّ/.test(o.state)).length;
    if (!occ.length) {
      item.note = !item.days.length && !item.dates.length
        ? 'لا «أيام تذكير» ولا «تواريخ ثابتة» محدّدة ⇒ لا لحظات إطلاق إطلاقاً'
        : (!baseIso && item.days.length ? (isMtg ? 'الاجتماع غير مجدول (بلا تاريخ)، فأيام الإزاحة لا تُنتج تواريخ — استخدم «تواريخ ثابتة»' : 'المهمة بلا موعد محدّد، فأيام الإزاحة لا تُنتج تواريخ — استخدم «تواريخ ثابتة»') : 'لا لحظات إطلاق ضمن اليوم/الأمس (قد تكون لتاريخ آخر)');
    }
    items.push(item);
  }
  return { nowDamascus: damascusFull(now), allowedDates, graceMin, totalReminders: reminders.length, dueNowReminders: items.filter((i) => i.dueNowCount).length, items };
}

function buildSingleReminderHtml(line, appUrl) {
  return `<div style="font-family:Cairo,Arial,sans-serif;direction:rtl;color:#2b2823">${esc(line)}${appUrl ? `<p style="margin-top:14px"><a href="${appUrl}" style="background:#bd6a43;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">فتح اللوحة</a></p>` : ''}</div>`;
}

/**
 * يُطلق التذكيرات المستحقّة الآن (بريد/تيليجرام/Push) لكل مستخدم وفق توقيتاته الدقيقة.
 * يعمل من الخادم بصرف النظر عن فتح اللوحة. منع التكرار عبر store.getSentKeys/markSent.
 * tasksByRow: خريطة الصف→المهمة. reminders: من store.getAllReminders().
 */
async function sendScheduledReminders(tasksByRow, reminders, appUrl, store, opts = {}) {
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const graceMs = (opts.graceMin != null ? opts.graceMin : Number(process.env.REMINDER_GRACE_MIN || 120)) * 60000;
  const results = { sent: 0, email: 0, telegram: 0, push: 0, considered: 0, errors: [] };
  const canMail = emailEnabled();
  const allowedDates = [damascusDateStr(now - 86400000), damascusDateStr(now)];

  const sentSet = store ? await store.getSentKeys() : new Set();
  const toMark = [];

  // خريطة البريد→المستخدم (للاسم وchatId) + الاسم→المستخدم (لمطابقة المسؤولين)
  let usersByEmail = {}; const usersByName = {};
  if (store) { try { (await store.getUsersFull() || []).forEach((u) => { usersByEmail[(u.email || '').toLowerCase()] = u; if (u.name) usersByName[String(u.name).trim()] = u; }); } catch { /* تجاهل */ } }

  // التذكير الافتراضي (بديل ضمني): لكل مهمة مؤرّخة، يُطبَّق DEFAULT_OWNER_REMINDER لكل مسؤول لم يضبط تذكيراً خاصاً لها
  const allReminders = reminders.slice();
  const explicitTaskKeys = new Set(reminders.filter((r) => !(r.meeting !== '' && r.meeting != null)).map((r) => `${(r.email || '').toLowerCase()}|${r.taskRow}`));
  const seenDefault = new Set();
  for (const [row, t] of Object.entries(tasksByRow)) {
    if (!t || t.isDone || !t.deadlineIso) continue;
    for (const ownerName of (t.owners || [])) {
      const u = usersByName[String(ownerName).trim()];
      if (!u || !u.email) continue;
      const k = `${u.email.toLowerCase()}|${row}`;
      if (explicitTaskKeys.has(k) || seenDefault.has(k)) continue;
      seenDefault.add(k);
      allReminders.push({ email: u.email, taskRow: String(row), methods: DEFAULT_OWNER_REMINDER.methods.slice(), days: DEFAULT_OWNER_REMINDER.days.slice(), dates: [], times: DEFAULT_OWNER_REMINDER.times.map((x) => ({ ...x })), meeting: '' });
    }
  }

  for (const r of allReminders) {
    const t = tasksByRow[String(r.taskRow)];
    if (!t) continue;
    const methods = (r.methods || []).filter((m) => m === 'email' || m === 'telegram' || m === 'push');
    if (!methods.length) continue;

    const u = usersByEmail[(r.email || '').toLowerCase()];
    const recName = (u && u.name || '').trim();
    const title = `${t.project}${t.file ? ' — ' + t.file : ''}`;

    // تذكير اجتماع (مرتبط بترتيب اجتماع داخل المهمة) أم تذكير مهمة؟ — يختلف أساس المواعيد والرسالة
    let occBase, refId, line, subject, pushBody;
    const isMtg = r.meeting !== '' && r.meeting != null;
    if (isMtg) {
      const mi = Number(r.meeting);
      const m = (t.meetings || [])[mi];
      if (!m || m.status === 'done') continue;                  // الاجتماع حُذف أو انعقد
      occBase = { deadlineIso: (m.datetime || '').slice(0, 10) || null }; // المواعيد نسبةً لموعد الاجتماع
      refId = `${r.taskRow}#m${mi}`;
      const when = m.datetime ? ` (موعد الاجتماع: ${m.datetime})` : '';
      line = `🔔 تذكير باجتماع: ${m.title} — ${title}${when}`;
      subject = `تذكير اجتماع: ${m.title}`;
      pushBody = `${m.title} — ${title}`;
    } else {
      if (t.isDone) continue;
      occBase = t;
      refId = String(r.taskRow);
      const isOwner = (t.owners || []).map((s) => s.trim()).includes(recName);
      const ownerNote = (!isOwner && t.owner) ? ` — المسؤول المعني: ${t.owner.replace(/\n+/g, '، ')}` : '';
      line = `🔔 تذكير بمهمة: ${title}${ownerNote}${t.deadlineRaw ? ` (الموعد: ${t.deadlineRaw})` : ''}`;
      subject = `تذكير: ${t.project}`;
      pushBody = `${title}${ownerNote}`;
    }

    const occ = reminderOccurrences(occBase, r, allowedDates).filter((o) => o.epoch <= now && o.epoch >= now - graceMs);
    if (!occ.length) continue;

    for (const o of occ) {
      const baseKey = occKey(r.email, refId, o);
      results.considered++;
      // بريد
      if (methods.includes('email') && canMail && r.email && !sentSet.has(baseKey + '|email')) {
        try { await sendEmail({ to: r.email, subject, html: buildSingleReminderHtml(line, appUrl) }); results.email++; results.sent++; toMark.push(baseKey + '|email'); sentSet.add(baseKey + '|email'); }
        catch (e) { results.errors.push(`email ${r.email}: ${e.message}`); }
      }
      // تيليجرام (نُهرّب النصّ لأنّه يُرسَل بنمط HTML)
      if (methods.includes('telegram') && telegram.enabled && u && u.telegramChatId && !sentSet.has(baseKey + '|telegram')) {
        try { const ok = await telegram.sendMessage(u.telegramChatId, `${telegram.esc(line)}${appUrl ? '\n' + appUrl : ''}`); if (ok) { results.telegram++; results.sent++; toMark.push(baseKey + '|telegram'); sentSet.add(baseKey + '|telegram'); } }
        catch (e) { results.errors.push(`telegram ${r.email}: ${e.message}`); }
      }
      // Push (إن وُجد اشتراك محفوظ للمستخدم) — يصل دون فتح اللوحة على الأجهزة المشتركة
      if (methods.includes('push') && initVapid() && store && !sentSet.has(baseKey + '|push')) {
        try {
          const subs = await store.getPushByEmail(r.email);
          if (subs.length) {
            const payload = JSON.stringify({ title: isMtg ? '🔔 تذكير باجتماع' : '🔔 تذكير بمهمة', body: pushBody, url: appUrl || '/' });
            let any = false;
            for (const s of subs) { try { await webpush.sendNotification(s, payload); any = true; } catch (e) { /* اشتراك منتهٍ */ } }
            if (any) { results.push++; results.sent++; toMark.push(baseKey + '|push'); sentSet.add(baseKey + '|push'); }
          }
        } catch (e) { results.errors.push(`push ${r.email}: ${e.message}`); }
      }
    }
  }

  if (toMark.length && store) { try { await store.markSent(toMark); } catch (e) { results.errors.push('markSent: ' + e.message); } }
  return results;
}

// ===== اللوحات اليومية (شاملة لكل بروفايل + مخصّصة لكل مسؤول) =====
const BOARD_CATS = [
  { key: 'overdue', label: '🔴 مهام متأخرة', color: '#b4453c' },
  { key: 'today', label: '🟠 مهام هذا اليوم', color: '#c0822f' },
  { key: 'soon', label: '🟡 مهام خلال ٣ أيام', color: '#9a7b50' },
];

function damascusMinutes(epochMs) {
  const d = new Date(epochMs + DAMASCUS_OFFSET_MIN * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function boardRel(t) {
  return t.diffDays == null ? '' : t.diffDays < 0 ? `متأخرة ${Math.abs(t.diffDays)} يوم` : t.diffDays === 0 ? 'اليوم' : `بعد ${t.diffDays} يوم`;
}
function boardRowsHtml(tasks) {
  return tasks.map((t) => `<tr>
    <td style="padding:7px 9px;border-bottom:1px solid #eee">${esc(t.project)}${t.file ? ' — ' + esc(t.file) : ''}</td>
    <td style="padding:7px 9px;border-bottom:1px solid #eee;white-space:nowrap">${esc(t.deadlineRaw || t.deadlineIso || '')} <span style="color:#8a8175">${boardRel(t)}</span></td>
    <td style="padding:7px 9px;border-bottom:1px solid #eee;white-space:nowrap">${esc(t.priority || '')}</td></tr>`).join('');
}
function boardTable(rowsHtml) {
  return `<table style="width:100%;border-collapse:collapse;font-size:13.5px">
    <tr style="background:#faf6f0"><th style="padding:7px 9px;text-align:right">المهمة</th><th style="padding:7px 9px;text-align:right">الموعد</th><th style="padding:7px 9px;text-align:right">الأولوية</th></tr>${rowsHtml}</table>`;
}
// تجميع مهام تصنيف حسب المسؤول (مهمة بعدّة مسؤولين تظهر تحت كلٍّ منهم)
function groupByOwner(tasks) {
  const by = {};
  for (const t of tasks) { const owners = (t.owners && t.owners.length) ? t.owners.map((o) => o.trim()) : ['(بلا مسؤول)']; for (const o of owners) (by[o] || (by[o] = [])).push(t); }
  return by;
}
function boardWrap(heading, sub, body, appUrl) {
  return `<div style="font-family:Cairo,Arial,sans-serif;direction:rtl;max-width:700px;margin:auto;color:#2b2823">
    <div style="background:#211d1a;color:#fff;padding:20px;border-radius:12px 12px 0 0;border-bottom:4px solid #bd6a43">
      <h2 style="margin:0">${esc(heading)}</h2><p style="margin:6px 0 0;color:#d8c4b0">${esc(sub)}</p></div>
    <div style="border:1px solid #e7ddcf;border-top:none;padding:20px;border-radius:0 0 12px 12px">${body}
      ${appUrl ? `<p style="margin-top:20px"><a href="${appUrl}" style="background:#bd6a43;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">فتح اللوحة</a></p>` : ''}
    </div></div>`;
}
function buildComprehensiveBoardHtml(profileLabel, b, appUrl) {
  const total = b.overdue.length + b.today.length + b.soon.length;
  const body = BOARD_CATS.map((c) => {
    const tasks = b[c.key]; if (!tasks.length) return '';
    const by = groupByOwner(tasks);
    const groups = Object.keys(by).sort((a, x) => a.localeCompare(x, 'ar')).map((o) =>
      `<div style="margin:12px 0 5px;font-weight:800;color:#a4572f">${esc(o)} <span style="color:#8a8175;font-weight:400">(${by[o].length})</span></div>${boardTable(boardRowsHtml(by[o]))}`).join('');
    return `<h3 style="color:${c.color};margin:18px 0 4px">${c.label} (${tasks.length})</h3>${groups}`;
  }).join('') || '<p>لا مهام في التصنيفات الحالية 🎉</p>';
  return boardWrap(`لوحة المهام الشاملة — ${profileLabel}`, `مجموعة سنكري القابضة · ${total} مهمة تحتاج انتباهاً`, body, appUrl);
}
function buildPersonalBoardHtml(ownerName, profileLabel, b, appUrl) {
  const total = b.overdue.length + b.today.length + b.soon.length;
  const body = BOARD_CATS.map((c) => {
    const tasks = b[c.key]; if (!tasks.length) return '';
    return `<h3 style="color:${c.color};margin:18px 0 4px">${c.label} (${tasks.length})</h3>${boardTable(boardRowsHtml(tasks))}`;
  }).join('') || '<p>لا مهام مستحقّة عليك حالياً 🎉</p>';
  return boardWrap(`مهامك اليومية — ${profileLabel}`, `${ownerName} · ${total} مهمة`, body, appUrl);
}
// نسخ تيليجرام النصّية (parse_mode=HTML ⇒ نُهرّب)
function boardTextComprehensive(profileLabel, b, appUrl) {
  let s = `📋 <b>لوحة المهام الشاملة — ${telegram.esc(profileLabel)}</b>\n`;
  for (const c of BOARD_CATS) {
    const tasks = b[c.key]; if (!tasks.length) continue;
    s += `\n${c.label} (${tasks.length})\n`;
    const by = groupByOwner(tasks);
    for (const o of Object.keys(by).sort((a, x) => a.localeCompare(x, 'ar'))) {
      s += `<b>${telegram.esc(o)}</b>\n` + by[o].map((t) => `• ${telegram.esc(t.project)}${t.file ? ' — ' + telegram.esc(t.file) : ''} (${telegram.esc(boardRel(t))})`).join('\n') + '\n';
    }
  }
  return s + (appUrl ? `\n${appUrl}` : '');
}
function boardTextPersonal(ownerName, profileLabel, b, appUrl) {
  let s = `📋 <b>مهامك اليومية — ${telegram.esc(profileLabel)}</b>\n${telegram.esc(ownerName)}\n`;
  for (const c of BOARD_CATS) {
    const tasks = b[c.key]; if (!tasks.length) continue;
    s += `\n${c.label} (${tasks.length})\n` + tasks.map((t) => `• ${telegram.esc(t.project)}${t.file ? ' — ' + telegram.esc(t.file) : ''} (${telegram.esc(boardRel(t))})`).join('\n') + '\n';
  }
  return s + (appUrl ? `\n${appUrl}` : '');
}

/**
 * إرسال اللوحات اليومية في التوقيت المضبوط (مرّة/يوم لكل لوحة).
 * tasksByProfile: خريطة tab→مصفوفة مهام ذلك البروفايل. profiles: من store.getProfiles().
 */
async function sendDailyBoards(profiles, tasksByProfile, store, appUrl, opts = {}) {
  const result = { boards: 0, email: 0, telegram: 0, errors: [], skipped: null };
  if (!store) { result.skipped = 'no-store'; return result; }
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  // الوضع العادي: لا يُرسل إلا ضمن نافذة التوقيت المضبوط ومرّة/يوم. الوضع التجريبي (force): يتجاوز التوقيت ومنع التكرار.
  if (!opts.force) {
    const digestTime = await store.getSetting('digestTime', '');
    if (!/^\d{1,2}:\d{2}$/.test(String(digestTime))) { result.skipped = 'no-time'; return result; }
    const [dh, dm] = String(digestTime).split(':').map(Number);
    const digestMin = dh * 60 + dm;
    const nowMin = damascusMinutes(now);
    const windowMin = opts.windowMin != null ? opts.windowMin : 180; // يُرسل خلال ٣ ساعات من التوقيت (تحمّلاً لتأخّر النبضة)
    if (nowMin < digestMin || nowMin > digestMin + windowMin) { result.skipped = 'outside-window'; return result; }
  }

  const todayStr = damascusDateStr(now);
  const canMail = emailEnabled();
  const sentSet = (!opts.force && store) ? await store.getSentKeys() : new Set();
  const toMark = [];
  let usersByEmail = {}, usersByName = {};
  try { (await store.getUsersFull() || []).forEach((u) => { usersByEmail[(u.email || '').toLowerCase()] = u; if (u.name) usersByName[String(u.name).trim()] = u; }); } catch { /* تجاهل */ }

  for (const p of profiles) {
    const tasks = tasksByProfile[p.tab] || [];
    const b = dueBuckets(tasks);
    const total = b.overdue.length + b.today.length + b.soon.length;

    // اللوحة الشاملة → مستلِمو البروفايل (قد يكونون أكثر من واحد) — بريد + تيليجرام لكلٍّ منهم
    const compRecipients = String(p.digestTo || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (compRecipients.length && total) {
      const html = buildComprehensiveBoardHtml(p.label || p.tab, b, appUrl);
      const text = boardTextComprehensive(p.label || p.tab, b, appUrl);
      for (const rcpt of compRecipients) {
        const key = `board|comp|${p.tab}|${rcpt.toLowerCase()}|${todayStr}`;
        if (sentSet.has(key)) continue;
        const u = usersByEmail[rcpt.toLowerCase()];
        let any = false;
        if (canMail) { try { await sendEmail({ to: rcpt, subject: `لوحة المهام الشاملة — ${p.label || p.tab} (${total})`, html }); result.email++; any = true; } catch (e) { result.errors.push('comp email ' + p.tab + ': ' + e.message); } }
        if (telegram.enabled && u && u.telegramChatId) { try { const ok = await telegram.sendMessage(u.telegramChatId, text); if (ok) { result.telegram++; any = true; } } catch (e) { result.errors.push('comp tg ' + p.tab + ': ' + e.message); } }
        if (any) { result.boards++; toMark.push(key); sentSet.add(key); }
      }
    }

    // اللوحات المخصّصة → لكل مسؤول معني له حساب
    const byOwner = groupByOwner(tasks);
    for (const ownerName of Object.keys(byOwner)) {
      const u = usersByName[ownerName];
      if (!u || !u.email) continue;
      const pb = dueBuckets(byOwner[ownerName]);
      const ptotal = pb.overdue.length + pb.today.length + pb.soon.length;
      if (!ptotal) continue;
      const key = `board|pers|${u.email.toLowerCase()}|${p.tab}|${todayStr}`;
      if (sentSet.has(key)) continue;
      let any = false;
      if (canMail) { try { await sendEmail({ to: u.email, subject: `مهامك اليومية — ${p.label || p.tab} (${ptotal})`, html: buildPersonalBoardHtml(u.name, p.label || p.tab, pb, appUrl) }); result.email++; any = true; } catch (e) { result.errors.push('pers email ' + u.email + ': ' + e.message); } }
      if (telegram.enabled && u.telegramChatId) { try { const ok = await telegram.sendMessage(u.telegramChatId, boardTextPersonal(u.name, p.label || p.tab, pb, appUrl)); if (ok) { result.telegram++; any = true; } } catch (e) { result.errors.push('pers tg ' + u.email + ': ' + e.message); } }
      if (any) { result.boards++; toMark.push(key); sentSet.add(key); }
    }
  }
  if (toMark.length && !opts.force) { try { await store.markSent(toMark); } catch (e) { result.errors.push('markSent: ' + e.message); } }
  return result;
}

module.exports = {
  getTransporter, sendEmail, emailEnabled, emailProvider, initVapid, addSubscription, removeSubscription, subscriptionCount,
  dueBuckets, buildDigestHtml, sendDailyDigest,
  dueOffsetsToday, sendDueReminders, sendScheduledReminders, analyzeReminders,
  sendDailyBoards, DEFAULT_OWNER_REMINDER,
};
