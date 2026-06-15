'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const sheets = require('./lib/sheets');
const auth = require('./lib/auth');
const notify = require('./lib/notify');
const store = require('./lib/store');
const calendar = require('./lib/calendar');

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

// ===== إدارة المستخدمين (مدير) =====
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try { res.json({ ok: true, users: await auth.listUsers(), storeEnabled: store.enabled }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const { email, name, password, role } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'البريد وكلمة المرور مطلوبان' });
    if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'دور غير صالح' });
    const hash = await auth.hashPassword(password);
    await store.addUser({ email: String(email).trim().toLowerCase(), name, role, hash });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.patch('/api/admin/users/:email', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const patch = {};
    const { name, role, active, password } = req.body || {};
    if (name != null) patch.name = name;
    if (role != null) { if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'دور غير صالح' }); patch.role = role; }
    if (active != null) patch.active = !!active;
    if (password) patch.hash = await auth.hashPassword(password);
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
    if (t.isMeeting) {
      s.meetings.total++;
      if (t.meetingScheduled) s.meetings.scheduled++; else s.meetings.unscheduled++;
    }
  }
  s.completion = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return s;
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

// إضافة مهمة جديدة
app.post('/api/tasks', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    await sheets.addTask(req.body || {});
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
    await store.setReminder(email, req.params.row, methods, offsets);
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

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    canWrite: sheets.canWrite,
    tz: require('./lib/dates').TZ,
    storeEnabled: store.enabled,
    mailProvider: notify.emailProvider(),
    notifyEmailSet: !!process.env.NOTIFY_EMAIL,
  });
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
