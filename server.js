'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const sheets = require('./lib/sheets');
const auth = require('./lib/auth');
const notify = require('./lib/notify');

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

app.get('/api/me', (req, res) => {
  if (!auth.authEnabled()) return res.json({ ok: true, user: { name: 'زائر', role: 'admin' }, authDisabled: true });
  if (req.session && req.session.user) return res.json({ ok: true, user: req.session.user });
  res.status(401).json({ ok: false, error: 'غير مسجّل الدخول' });
});

app.get('/api/admin/users', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ ok: true, users: auth.listUsers() });
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

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  notify.addSubscription(req.body);
  res.json({ ok: true });
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
    const result = await notify.sendDailyDigest(tasks, appUrl);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('daily-digest', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.post('/api/cron/daily-digest', runDailyDigest);
app.get('/api/cron/daily-digest', runDailyDigest);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, canWrite: sheets.canWrite, tz: require('./lib/dates').TZ });
});

app.listen(PORT, async () => {
  console.log(`EO-Dashboard يعمل على المنفذ ${PORT} (الكتابة: ${sheets.canWrite ? 'مفعّلة' : 'معطّلة - قراءة فقط'})`);
  if (sheets.canWrite) {
    try {
      await sheets.ensureStatusColumn();
      console.log('تم التأكد من عمود «الحالة».');
    } catch (e) {
      console.warn('تعذّر إنشاء عمود الحالة:', e.message);
    }
  }
});
