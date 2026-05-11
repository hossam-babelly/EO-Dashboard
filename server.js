/**
 * ─────────────────────────────────────────────────────────────
 *  نموذج طرح دراسة مشروع — Backend Server
 *  Express.js · Node.js
 * ─────────────────────────────────────────────────────────────
 *  الميزات:
 *   • يستقبل بيانات الفورم عبر POST /api/submit
 *   • يحفظ كل طلب في ملف JSON داخل مجلد data/
 *   • يمكن استرجاع الطلبات عبر GET /api/submissions
 *   • يصدّر ملف Excel عبر GET /api/export/:id  (اختياري)
 *   • يخدم الـ Frontend من مجلد public/
 * ─────────────────────────────────────────────────────────────
 */

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Ensure data directory exists ────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Serve static frontend ────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Helper: generate short ID ────────────────────────────────
function genId() {
  return Date.now().toString(36).toUpperCase() + '-' +
         crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ── Helper: get all submissions index ───────────────────────
function loadIndex() {
  const indexPath = path.join(DATA_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  try { return JSON.parse(fs.readFileSync(indexPath, 'utf8')); }
  catch { return []; }
}

function saveIndex(index) {
  fs.writeFileSync(
    path.join(DATA_DIR, 'index.json'),
    JSON.stringify(index, null, 2),
    'utf8'
  );
}

// ────────────────────────────────────────────────────────────
//  POST /api/submit
//  يستقبل بيانات الفورم الكاملة ويحفظها
// ────────────────────────────────────────────────────────────
app.post('/api/submit', (req, res) => {
  try {
    const body = req.body;

    // Validation بسيطة
    if (!body || !body.projectIdea) {
      return res.status(400).json({ success: false, message: 'فكرة المشروع مطلوبة' });
    }

    const id = genId();
    const submission = {
      id,
      submittedAt: body.submittedAt || new Date().toISOString(),
      projectIdea: body.projectIdea,
      summary: body.summary || {},
      foundingRows: body.foundingRows || [],
      products: body.products || {},
      revenueData: body.revenueData || {},
      fixedRows: body.fixedRows || [],
      hrRows: body.hrRows || [],
    };

    // حفظ الطلب في ملف منفصل
    const filePath = path.join(DATA_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(submission, null, 2), 'utf8');

    // تحديث الفهرس
    const index = loadIndex();
    index.unshift({
      id,
      projectIdea: body.projectIdea.substring(0, 80),
      submittedAt: submission.submittedAt,
      summary: body.summary || {}
    });
    saveIndex(index);

    console.log(`[${new Date().toISOString()}] ✅ تم حفظ الطلب: ${id}`);

    return res.json({ success: true, id, message: 'تم حفظ الطلب بنجاح' });

  } catch (err) {
    console.error('❌ خطأ في /api/submit:', err);
    return res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/submissions
//  يعيد قائمة الطلبات (الملخص فقط)
// ────────────────────────────────────────────────────────────
app.get('/api/submissions', (req, res) => {
  try {
    const index = loadIndex();
    return res.json({ success: true, count: index.length, submissions: index });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'خطأ في تحميل البيانات' });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/submissions/:id
//  يعيد بيانات طلب كامل
// ────────────────────────────────────────────────────────────
app.get('/api/submissions/:id', (req, res) => {
  try {
    const { id } = req.params;
    // Sanitize id to prevent path traversal
    const safeId = id.replace(/[^A-Z0-9\-]/g, '');
    const filePath = path.join(DATA_DIR, `${safeId}.json`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return res.json({ success: true, submission: data });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'خطأ في تحميل البيانات' });
  }
});

// ────────────────────────────────────────────────────────────
//  DELETE /api/submissions/:id
// ────────────────────────────────────────────────────────────
app.delete('/api/submissions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const safeId = id.replace(/[^A-Z0-9\-]/g, '');
    const filePath = path.join(DATA_DIR, `${safeId}.json`);

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const index = loadIndex().filter(s => s.id !== safeId);
    saveIndex(index);

    return res.json({ success: true, message: 'تم حذف الطلب' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'خطأ في الحذف' });
  }
});

// ────────────────────────────────────────────────────────────
//  GET /api/export/:id
//  تصدير الطلب كـ JSON محدد الشكل (يمكن تمديده لـ Excel لاحقاً)
// ────────────────────────────────────────────────────────────
app.get('/api/export/:id', (req, res) => {
  try {
    const { id } = req.params;
    const safeId = id.replace(/[^A-Z0-9\-]/g, '');
    const filePath = path.join(DATA_DIR, `${safeId}.json`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'الطلب غير موجود' });
    }

    const data = fs.readFileSync(filePath);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="project_${safeId}.json"`);
    return res.send(data);

  } catch (err) {
    return res.status(500).json({ success: false, message: 'خطأ في التصدير' });
  }
});

// ── 404 Fallback → serve SPA ────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║  🚀 الخادم يعمل على المنفذ: ${PORT}        ║
  ║  http://localhost:${PORT}                 ║
  ╚════════════════════════════════════════╝
  `);
});

module.exports = app;
