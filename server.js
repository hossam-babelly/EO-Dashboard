'use strict';

// فرض ترتيب IPv4 أولاً في حلّ DNS — يعالج انقطاع الاتصال بخوادم Google
// (oauth2.googleapis.com / sheets.googleapis.com) عبر IPv6 المعطّل على بعض الاستضافات
// الذي يظهر كخطأ «Premature close / ECONNRESET». يجب أن يسبق أي اتصال شبكي.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* إصدار Node لا يدعمه */ }

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const sheets = require('./lib/sheets');
const auth = require('./lib/auth');
const notify = require('./lib/notify');
const store = require('./lib/store');
const calendar = require('./lib/calendar');
const { TZ } = require('./lib/dates');

// طابع زمني «YYYY-MM-DD HH:MM» بتوقيت دمشق (أرقام لاتينية)
function nowStamp() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

// اسم المستخدم الكامل المستخدَم في سجلّ الأحداث (الاسم الكامل لا الأول فقط)
function authorName(u) {
  return (u && (String(u.name || '').trim() || [u.firstName, u.lastName].filter(Boolean).join(' ').trim())) || 'مستخدم';
}

const ROLES = ['viewer', 'editor', 'admin'];
const REMINDER_METHODS = ['email', 'push', 'calendar'];
const REMINDER_OFFSETS = ['morning', '1d', '3d', '7d'];

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // خلف وكيل Render
app.use(express.json({ limit: '1mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// صفحات عامة لا تتطلب دخولاً
const PUBLIC_FILES = new Set(['/login.html', '/styles.css']);

// بوابة الصفحة الرئيسية: تحويل لتسجيل الدخول عند تفعيل المصادقة وعدم وجود جلسة
app.get('/', (req, res, next) => {
  if (auth.authEnabled() && !(req.session && req.session.user)) {
    return res.redirect('/login.html');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ===== المصادقة =====
function requireAuth(req, res, next) {
  if (!auth.authEnabled()) return next(); // إن لم تُضبط حسابات، يبقى مفتوحاً
  if (req.session && req.session.user) return next();
  res.status(401).json({ ok: false, error: 'يجب تسجيل الدخول' });
}
function requireRole(min) {
  return (req, res, next) => {
    if (!auth.authEnabled()) return next();
    if (auth.hasRole(req.session.user, min)) return next();
    res.status(403).json({ ok: false, error: 'صلاحيتك لا تسمح بهذا الإجراء' });
  };
}

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await auth.verify(email, password);
    if (!user) return res.status(401).json({ ok: false, error: 'البريد أو كلمة المرور غير صحيحة' });
    req.session.user = user;
    res.json({ ok: true, user });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!auth.authEnabled()) return res.json({ ok: true, user: { name: 'زائر', role: 'admin' }, authDisabled: true, storeEnabled: store.enabled });
  if (!(req.session && req.session.user)) return res.status(401).json({ ok: false, error: 'غير مسجّل الدخول' });
  const user = { ...req.session.user };
  // رمز التقويم الشخصي (للاشتراك في تغذية ICS)
  if (store.enabled) {
    try {
      const full = (await store.getUsersFull()).find((u) => u.email.toLowerCase() === user.email.toLowerCase());
      if (full) user.calToken = full.token;
    } catch { /* تجاهل */ }
  }
  res.json({ ok: true, user, storeEnabled: store.enabled });
});

// قائمة المستخدمين (للاختيار كمسؤول معني) — متاحة لكل مسجّل دخول، تُعيد الاسم والبريد فقط
app.get('/api/users/list', requireAuth, async (req, res) => {
  try {
    const users = (await auth.listUsers()).filter((u) => u.active !== false);
    res.json({ ok: true, users: users.map((u) => ({ name: u.name, email: u.email, firstName: u.firstName, lastName: u.lastName })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// تعديل المستخدم لحسابه هو (الاسم + كلمة المرور) — لا يمسّ الدور ولا التفعيل
app.patch('/api/account', requireAuth, async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const me = req.session.user;
    const patch = {};
    const { firstName, lastName, password } = req.body || {};
    if (firstName != null) patch.firstName = String(firstName).trim();
    if (lastName != null) patch.lastName = String(lastName).trim();
    if (password) patch.hash = await auth.hashPassword(password);
    await store.updateUser(String(me.email).toLowerCase(), patch);
    // تحديث الجلسة بالاسم الجديد
    if (patch.firstName != null || patch.lastName != null) {
      const fn = patch.firstName != null ? patch.firstName : me.firstName;
      const ln = patch.lastName != null ? patch.lastName : (me.lastName || '');
      me.firstName = fn;
      me.name = `${fn} ${ln}`.trim() || me.name;
      req.session.user = me;
    }
    res.json({ ok: true, user: { name: me.name, firstName: me.firstName, role: me.role, email: me.email } });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ===== إدارة المستخدمين (مدير) =====
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try { res.json({ ok: true, users: await auth.listUsers(), storeEnabled: store.enabled }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const { email, name, firstName, lastName, password, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'البريد وكلمة المرور مطلوبان' });
    if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'دور غير صالح' });
    const hash = await auth.hashPassword(password);
    await store.addUser({ email: String(email).trim().toLowerCase(), name, firstName, lastName, role, hash });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.patch('/api/admin/users/:email', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const patch = {};
    const { name, firstName, lastName, role, active, password, email: newEmail } = req.body || {};
    if (name != null) patch.name = name;
    if (firstName != null) patch.firstName = firstName;
    if (lastName != null) patch.lastName = lastName;
    if (role != null) { if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'دور غير صالح' }); patch.role = role; }
    if (active != null) patch.active = !!active;
    if (password) patch.hash = await auth.hashPassword(password);
    if (newEmail != null && String(newEmail).trim() && String(newEmail).trim().toLowerCase() !== String(req.params.email).toLowerCase()) {
      const ne = String(newEmail).trim().toLowerCase();
      const all = (await store.getUsersFull()) || [];
      if (all.some((u) => u.email.toLowerCase() === ne)) return res.status(400).json({ ok: false, error: 'البريد الجديد مستخدم مسبقاً' });
      patch.email = ne;
    }
    await store.updateUser(String(req.params.email).toLowerCase(), patch);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ذاكرة تخزين مؤقتة قصيرة لتقليل طلبات Google API مع إبقاء التحديث شبه لحظي
let cache = { at: 0, tasks: [] };
const CACHE_MS = Number(process.env.CACHE_MS || 8000);

async function loadTasks(force = false) {
  const now = Date.now();
  if (!force && now - cache.at < CACHE_MS && cache.tasks.length) return cache.tasks;
  const tasks = await sheets.getTasks();
  cache = { at: now, tasks };
  return tasks;
}

function invalidateCache() { cache = { at: 0, tasks: [] }; }

// حارس الكتابة: يمنع التعديل عند غياب صلاحية الكتابة (مفتاح قراءة فقط)
function requireWrite(req, res, next) {
  if (!sheets.canWrite) {
    return res.status(403).json({ ok: false, error: 'الكتابة معطّلة — لم يُضبط حساب الخدمة (Service Account).' });
  }
  next();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
}

function summarize(tasks) {
  const s = {
    total: tasks.length,
    today: 0,
    overdue: 0,
    soon3: 0,
    thisWeek: 0,
    undated: 0,
    recurring: 0,
    done: 0,
    byPriority: {},
    byStatus: {},
    byType: {},
    meetings: { total: 0, scheduled: 0, unscheduled: 0 },
  };
  let completionSum = 0;
  for (const t of tasks) {
    if (t.isToday) s.today++;
    if (t.isOverdue) s.overdue++;
    if (t.isSoon3) s.soon3++;
    if (t.isThisWeek) s.thisWeek++;
    if (t.isUndated) s.undated++;
    if (t.isRecurring) s.recurring++;
    if (t.isDone) s.done++;
    s.byPriority[t.priority] = (s.byPriority[t.priority] || 0) + 1;
    s.byStatus[t.status] = (s.byStatus[t.status] || 0) + 1;
    const tk = t.type || '';
    s.byType[tk] = (s.byType[tk] || 0) + 1;
    // عدّ الاجتماعات لكل اجتماع على حدة (المهمة قد تحوي عدّة اجتماعات)
    for (const m of (t.meetings || [])) {
      s.meetings.total++;
      if (m.scheduled) s.meetings.scheduled++; else s.meetings.unscheduled++;
    }
    completionSum += taskCompletion(t);
  }
  // نسبة الإنجاز تشمل الإنجاز الجزئي للمخرجات (مهمة بنصف مخرجاتها منجزة = 0.5)
  s.completion = s.total ? Math.round((completionSum / s.total) * 100) : 0;
  return s;
}

// نسبة إنجاز المهمة الواحدة (0..1): منجزة كلياً=1، وإلا نسبة المخرجات المؤشَّرة، وبلا مخرجات=0
function taskCompletion(t) {
  if (t.isDone) return 1;
  const dB = sheets.fuBlocks(t.deliverable || '');
  if (!dB.length) return 0;
  const done = dB.filter((b) => /^✓/.test(b)).length;
  return done / dB.length;
}

// كل المهام + ملخص + خيارات الفلاتر
app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const tasks = await loadTasks(req.query.refresh === '1');
    res.json({
      ok: true,
      tasks,
      summary: summarize(tasks),
      filters: {
        projects: uniqueSorted(tasks.map((t) => t.project)),
        owners: uniqueSorted(tasks.flatMap((t) => t.owners)),
        priorities: uniqueSorted(tasks.map((t) => t.priority)),
        statuses: sheets.STATUSES,
        files: uniqueSorted(tasks.map((t) => t.file)),
        types: uniqueSorted(tasks.map((t) => t.type)),
        linked: uniqueSorted(tasks.flatMap((t) => t.linkedList || [])),
      },
      meta: { canWrite: sheets.canWrite, fetchedAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error('GET /api/tasks', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// تعديل مهمة قائمة (حقول متعددة)
app.patch('/api/tasks/:row', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const task = await sheets.updateTask(req.params.row, req.body || {});
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) {
    console.error('PATCH /api/tasks', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// تغيير حالة مهمة (للوحة كانبان)
app.post('/api/tasks/:row/status', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!sheets.STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: 'حالة غير صالحة' });
    }
    const task = await sheets.updateTask(req.params.row, { status });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// إضافة حدث إلى سجل «نتائج المتابعة اليومية» (يُلحق سطراً مؤرّخاً باسم المستخدم)
app.post('/api/tasks/:row/followup', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim(); // نحفظ أسطر الحدث، ونمنع السطر الفارغ داخله
    if (!text) return res.status(400).json({ ok: false, error: 'نصّ الحدث فارغ' });
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const u = req.session && req.session.user;
    const author = authorName(u);
    const logLine = `[${nowStamp()} — ${author}]`;
    // الكتل متوازية: نصّ الحدث في «المتابعة» والسجل في «السجل»، والأحداث اليدوية تأخذ «----------»
    const fB = sheets.fuBlocks(t ? t.followup : '');
    const lB = sheets.fuBlocks(t ? t.log : '');
    while (lB.length < fB.length) lB.push('----------');
    fB.push(text);
    lB.push(logLine);
    const task = await sheets.updateTask(req.params.row, { followup: fB.join('\n\n'), log: lB.join('\n\n') });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) {
    console.error('POST followup', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// تعديل حدث متابعة بالموضع: النصّ والتاريخ/الوقت (مدير/محرّر) · اسم المستخدم في السجل (المدير فقط) — المشاهد ممنوع
app.patch('/api/tasks/:row/followup/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const fB = sheets.fuBlocks(t ? t.followup : '');
    const lB = sheets.fuBlocks(t ? t.log : '');
    while (lB.length < fB.length) lB.push('----------');
    if (!Number.isInteger(idx) || idx < 0 || idx >= fB.length) return res.status(400).json({ ok: false, error: 'حدث غير موجود' });

    const u = req.session && req.session.user;
    const role = !auth.authEnabled() ? 'admin' : ((u && u.role) || 'viewer');
    const isAdmin = role === 'admin';
    const canText = isAdmin || role === 'editor';

    // النصّ: يعدّله المدير/المحرّر فقط؛ المشاهد يُبقيه كما هو
    if (canText) {
      const text = String((req.body && req.body.text) || '').replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim();
      if (!text) return res.status(400).json({ ok: false, error: 'نصّ الحدث فارغ' });
      fB[idx] = text;
    }
    // السجل: نقرأ القيم الأصلية لنحافظ على اسم المستخدم عند غير المدير
    const m = String(lB[idx] || '').match(/^\s*\[(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[—–-]\s*(.+?)\]\s*$/);
    const origAuthor = m ? m[3].trim() : authorName(u);
    const { date, time, author: customAuthor } = req.body || {};
    const stamp = nowStamp();
    const dt = (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) ? date : (m ? m[1] : stamp.slice(0, 10));
    const tm = /^\d{1,2}:\d{2}$/.test(String(time || '')) ? time : (m ? m[2] : stamp.slice(11));
    // اسم المستخدم في السجل: المدير فقط يعدّله؛ غيره يُبقي الاسم الأصلي
    const au = isAdmin ? (String(customAuthor || '').trim() || origAuthor) : origAuthor;
    lB[idx] = `[${dt} ${tm} — ${au}]`;

    const task = await sheets.updateTask(req.params.row, { followup: fB.join('\n\n'), log: lB.join('\n\n') });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) { console.error('PATCH followup', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// حذف حدث متابعة بالموضع — يحذف نصّه وسجلّه معاً
app.delete('/api/tasks/:row/followup/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const fB = sheets.fuBlocks(t ? t.followup : '');
    const lB = sheets.fuBlocks(t ? t.log : '');
    while (lB.length < fB.length) lB.push('----------');
    if (!Number.isInteger(idx) || idx < 0 || idx >= fB.length) return res.status(400).json({ ok: false, error: 'حدث غير موجود' });
    fB.splice(idx, 1);
    lB.splice(idx, 1);
    const task = await sheets.updateTask(req.params.row, { followup: fB.join('\n\n'), log: lB.join('\n\n') });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) { console.error('DELETE followup', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// ===== المخرجات المطلوبة ككائنات (كتل مفصولة بسطر فارغ في نفس الخلية) =====
app.post('/api/tasks/:row/deliverable', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim().replace(/\n\s*\n+/g, '\n');
    if (!text) return res.status(400).json({ ok: false, error: 'نصّ المخرج فارغ' });
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    dB.push(text);
    const task = await sheets.updateTask(req.params.row, { deliverable: dB.join('\n\n') });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) { console.error('POST deliverable', err.message); res.status(400).json({ ok: false, error: err.message }); }
});
app.patch('/api/tasks/:row/deliverable/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim().replace(/\n\s*\n+/g, '\n');
    if (!text) return res.status(400).json({ ok: false, error: 'نصّ المخرج فارغ' });
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    dB[idx] = text;
    const task = await sheets.updateTask(req.params.row, { deliverable: dB.join('\n\n') });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});
app.delete('/api/tasks/:row/deliverable/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    dB.splice(idx, 1);
    const task = await sheets.updateTask(req.params.row, { deliverable: dB.join('\n\n') });
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// تأشير/إلغاء تأشير مخرج كمنجَز (بإضافة/إزالة «✓»)؛ عند إنجاز كل المخرجات تصبح المهمة «منجزة»
app.post('/api/tasks/:row/deliverable/:idx/toggle', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    const done = /^✓/.test(dB[idx]);
    dB[idx] = done ? dB[idx].replace(/^✓\s*/, '') : '✓ ' + dB[idx];
    const patch = { deliverable: dB.join('\n\n') };
    if (dB.length && dB.every((b) => /^✓/.test(b))) patch.status = sheets.DONE_STATUS;
    const task = await sheets.updateTask(req.params.row, patch);
    invalidateCache();
    res.json({ ok: true, task });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// حذف مهمة (يحذف صفّها من الشيت)
app.delete('/api/tasks/:row', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    await sheets.deleteTask(req.params.row);
    invalidateCache();
    res.json({ ok: true });
  } catch (err) { console.error('DELETE /api/tasks', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// إضافة مهمة جديدة (مع أحداث متابعة اختيارية)
app.post('/api/tasks', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const body = { ...(req.body || {}) };
    const events = Array.isArray(body.events) ? body.events.map((e) => String(e).replace(/\r/g, '').replace(/\n[ \t]*\n+/g, '\n').trim()).filter(Boolean) : [];
    delete body.events;
    if (events.length) {
      const u = req.session && req.session.user;
      const author = authorName(u);
      const stamp = nowStamp();
      body.followup = events.join('\n\n');
      body.log = events.map(() => `[${stamp} — ${author}]`).join('\n\n');
    }
    await sheets.addTask(body);
    invalidateCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/tasks', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ===== الإشعارات =====
app.get('/api/push/key', requireAuth, (req, res) => {
  res.json({ ok: true, key: process.env.VAPID_PUBLIC_KEY || null });
});

app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  notify.addSubscription(req.body);
  try { if (store.enabled && req.session.user) await store.savePush(req.session.user.email, req.body); } catch (e) { console.warn('savePush', e.message); }
  res.json({ ok: true });
});

// ===== التذكيرات (لكل مستخدم/مهمة) =====
app.get('/api/reminders', requireAuth, async (req, res) => {
  try {
    const email = req.session?.user?.email;
    if (!store.enabled || !email) return res.json({ ok: true, reminders: {}, storeEnabled: store.enabled });
    res.json({ ok: true, reminders: await store.getReminders(email), methods: REMINDER_METHODS, offsets: REMINDER_OFFSETS });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/tasks/:row/reminder', requireAuth, async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const email = req.session.user.email;
    const methods = (req.body.methods || []).filter((m) => REMINDER_METHODS.includes(m));
    const offsets = (req.body.offsets || []).filter((o) => REMINDER_OFFSETS.includes(o));
    const dates = (req.body.dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const time = /^\d{1,2}:\d{2}$/.test(String(req.body.time || '')) ? req.body.time : '';
    const repeatCount = Math.min(20, Math.max(0, parseInt(req.body.repeatCount, 10) || 0));
    const repeatEvery = Math.min(720, Math.max(0, parseInt(req.body.repeatEvery, 10) || 0));
    await store.setReminder(email, req.params.row, methods, offsets, dates, time, repeatCount, repeatEvery);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ===== تغذية التقويم (ICS) — اشتراك دائم برمز شخصي =====
app.get('/api/calendar/:token.ics', async (req, res) => {
  try {
    const user = await store.getUserByToken(req.params.token);
    if (!user) return res.status(404).send('NOT FOUND');
    const tasks = await loadTasks();
    const byRow = {}; tasks.forEach((t) => { byRow[String(t.row)] = t; });
    const reminders = await store.getReminders(user.email);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="eo-dashboard.ics"');
    res.send(calendar.buildICS(byRow, reminders));
  } catch (e) { res.status(500).send('ERROR: ' + e.message); }
});

// المهمة المجدولة: ملخص يومي عبر البريد و Push (يستدعيها GitHub Actions)
async function runDailyDigest(req, res) {
  const secret = req.get('x-cron-secret') || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'رمز غير صالح' });
  }
  try {
    const tasks = await loadTasks(true);
    const appUrl = process.env.APP_URL || '';
    const digest = await notify.sendDailyDigest(tasks, appUrl);
    // تذكيرات لكل مستخدم/مهمة حسب تفضيلاتهم
    let reminders = { emails: 0, push: 0 };
    if (store.enabled) {
      const byRow = {}; tasks.forEach((t) => { byRow[String(t.row)] = t; });
      reminders = await notify.sendDueReminders(byRow, await store.getAllReminders(), appUrl, store);
    }
    res.json({ ok: true, mail: { enabled: notify.emailEnabled(), provider: notify.emailProvider() }, digest, reminders });
  } catch (e) {
    console.error('daily-digest', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.post('/api/cron/daily-digest', runDailyDigest);
app.get('/api/cron/daily-digest', runDailyDigest);

// نسخة node-fetch الفعلية المثبّتة (للتشخيص) — نبحث في المواقع المحتملة داخل node_modules
function pkgVersion(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')).version; } catch { return null; } }
function nodeFetchVersion() {
  const nm = path.join(__dirname, 'node_modules');
  const candidates = [
    path.join(nm, 'node-fetch', 'package.json'),
    path.join(nm, 'gaxios', 'node_modules', 'node-fetch', 'package.json'),
    path.join(nm, 'google-auth-library', 'node_modules', 'node-fetch', 'package.json'),
  ];
  for (const c of candidates) { const v = pkgVersion(c); if (v) return v; }
  return 'unknown';
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    canWrite: sheets.canWrite,
    tz: require('./lib/dates').TZ,
    storeEnabled: store.enabled,
    mailProvider: notify.emailProvider(),
    notifyEmailSet: !!process.env.NOTIFY_EMAIL,
    node: process.version,         // إصدار Node الفعلي على Render
    nodeFetch: nodeFetchVersion(), // إصدار node-fetch الفعلي (يجب أن يكون 2.6.13)
    dnsOrder: (() => { try { return require('dns').getDefaultResultOrder(); } catch { return 'n/a'; } })(),
  });
});

// تشخيص حيّ لاتصال Google: يحاول جلب رمز عبر نفس مكتبات التطبيق ويعيد النتيجة الدقيقة
app.get('/api/diag/google', async (req, res) => {
  const out = { node: process.version, nodeFetch: nodeFetchVersion() };
  try {
    const { request } = require('gaxios');
    const r = await request({
      url: 'https://oauth2.googleapis.com/token', method: 'POST',
      data: { grant_type: 'x' }, validateStatus: () => true, retry: false, timeout: 15000,
    });
    out.googleTransport = 'OK';   // اكتمل الاتصال (حتى لو رمز 400) ⇒ المشكلة محلولة
    out.googleStatus = r.status;
  } catch (e) {
    out.googleTransport = 'FAIL'; // فشل النقل ⇒ ما زالت المشكلة قائمة
    out.googleError = e.message;
  }
  res.json(out);
});

app.listen(PORT, async () => {
  console.log(`EO-Dashboard يعمل على المنفذ ${PORT} (الكتابة: ${sheets.canWrite ? 'مفعّلة' : 'معطّلة - قراءة فقط'})`);
  if (sheets.canWrite) {
    try {
      await sheets.ensureColumns();
      console.log('تم التأكد من عمودَي «الحالة» و«تمت جدولة الاجتماع».');
    } catch (e) {
      console.warn('تعذّر إنشاء الأعمدة المُدارة:', e.message);
    }
  }
  console.log(`التخزين الدائم (المستخدمون/التذكيرات): ${store.enabled ? 'مفعّل' : 'معطّل — USERS_JSON فقط'}`);
});
