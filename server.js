'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const sheets = require('./lib/sheets');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await loadTasks(req.query.refresh === '1');
    res.json({
      ok: true,
      tasks,
      summary: summarize(tasks),
      filters: {
        projects: uniqueSorted(tasks.map((t) => t.dept || t.project)),
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
app.patch('/api/tasks/:row', requireWrite, async (req, res) => {
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
app.post('/api/tasks/:row/status', requireWrite, async (req, res) => {
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
app.post('/api/tasks', requireWrite, async (req, res) => {
  try {
    await sheets.addTask(req.body || {});
    invalidateCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/tasks', err.message);
    res.status(400).json({ ok: false, error: err.message });
  }
});

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
