'use strict';

// فرض ترتيب IPv4 أولاً في حلّ DNS — يعالج انقطاع الاتصال بخوادم Google
// (oauth2.googleapis.com / sheets.googleapis.com) عبر IPv6 المعطّل على بعض الاستضافات
// الذي يظهر كخطأ «Premature close / ECONNRESET». يجب أن يسبق أي اتصال شبكي.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) { /* إصدار Node لا يدعمه */ }

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const sheets = require('./lib/sheets');
const auth = require('./lib/auth');
const notify = require('./lib/notify');
const store = require('./lib/store');
const calendar = require('./lib/calendar');
const drive = require('./lib/drive');
const telegram = require('./lib/telegram');
const { TZ } = require('./lib/dates');

// طابع زمني «YYYY-MM-DD HH:MM» بتوقيت دمشق (أرقام لاتينية)
function nowStamp() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${date} ${time}`;
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// اسم المستخدم الكامل المستخدَم في سجلّ الأحداث (الاسم الكامل لا الأول فقط)
function authorName(u) {
  return (u && (String(u.name || '').trim() || [u.firstName, u.lastName].filter(Boolean).join(' ').trim())) || 'مستخدم';
}

const ROLES = ['viewer', 'editor', 'admin'];
const REMINDER_METHODS = ['email', 'push', 'calendar', 'telegram'];
const REMINDER_OFFSETS = ['morning', '1d', '3d', '7d'];

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // خلف وكيل Render
app.use(express.json({ limit: '12mb' })); // يتّسع لرفع المرفقات (base64)
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

// ===== إحياء الجلسة بعد نوم/إعادة تشغيل الخادم (الحزمة 34) =====
// جلسات express-session تعيش في ذاكرة العملية، فتُفقد عند كل نوم/استيقاظ لـRender —
// ومع «جدولة النبضة» صار النوم يومياً، فكان الجميع سيُسجَّل خروجهم كل استيقاظ.
// الحل: كوكي «تذكُّر» موقّعة (HMAC بسرّ الجلسة) تحمل البريد + البروفايل المختار + انتهاء ٧ أيام؛
// عند وصول طلب بلا جلسة وكوكي صالحة، تُعاد بناء الجلسة من تخزين المستخدمين (الكلمة السرية لا تُخزَّن).
const REMEMBER_COOKIE = 'eo_remember';
const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
const rememberSecret = () => process.env.SESSION_SECRET || 'dev-secret-change-me';
function signRemember(email, profile) {
  const payload = Buffer.from(JSON.stringify({ e: String(email || '').toLowerCase(), p: String(profile || ''), x: Date.now() + REMEMBER_MS }), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', rememberSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyRemember(val) {
  try {
    const [payload, sig] = String(val || '').split('.');
    if (!payload || !sig) return null;
    const expect = crypto.createHmac('sha256', rememberSecret()).update(payload).digest('base64url');
    if (expect.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!o || !o.e || !(Number(o.x) > Date.now())) return null;
    return { email: o.e, profile: o.p || '' };
  } catch { return null; }
}
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); } }
  }
  return null;
}
const rememberCookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: REMEMBER_MS });
function setRememberCookie(res, email, profile) { res.cookie(REMEMBER_COOKIE, signRemember(email, profile), rememberCookieOpts()); }
app.use(async (req, res, next) => {
  try {
    if (auth.authEnabled() && req.session && !req.session.user) {
      const r = verifyRemember(readCookie(req, REMEMBER_COOKIE));
      if (r) {
        const u = (await auth.listUsers()).find((x) => String(x.email).toLowerCase() === r.email && x.active !== false);
        if (u) {
          req.session.user = { email: u.email, name: u.name, firstName: u.firstName, lastName: u.lastName || '', role: u.role, profiles: u.profiles || [], phone: u.phone || '' };
          const profiles = await availableProfilesFor(req.session.user);
          req.session.profile = (r.profile && profiles.some((p) => p.tab === r.profile)) ? r.profile : (profiles[0] ? profiles[0].tab : DEFAULT_TAB);
        }
      }
    }
  } catch (e) { /* أي فشل ⇒ يسقط الطلب على مسار الدخول الاعتيادي */ }
  next();
});

// صفحات عامة لا تتطلب دخولاً
const PUBLIC_FILES = new Set(['/login.html', '/styles.css']);

// بوابة الصفحة الرئيسية: تحويل لتسجيل الدخول عند تفعيل المصادقة وعدم وجود جلسة
app.get('/', (req, res, next) => {
  if (auth.authEnabled() && !(req.session && req.session.user)) {
    return res.redirect('/login.html');
  }
  next();
});

// no-cache للـ HTML/CSS/JS: المتصفح وتطبيق الأندرويد يعيدان التحقق كل مرة
// (مع ETag يكون الردّ 304 خفيفاً) — WebView قد يحتفظ بنسخ قديمة أياماً فلا تصل التحديثات.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ============================ تطبيق الأندرويد (الحزمة 33) ============================
// ملف الـ APK يبنيه GitHub Actions تلقائياً ويضعه في public/apk/ (لا يوجد في حزم ZIP).
const APK_PATH = path.join(__dirname, 'public', 'apk', 'eo-dashboard.apk');
// إعدادات عامة بلا مصادقة (تلزم شاشة الدخول وتطبيق الأندرويد قبل الدخول):
// name = الاسم المعروض داخل التطبيق (يعدّله المدير) · apk = هل ملف التطبيق منشور على الخادم.
app.get('/api/app-config', async (req, res) => {
  let name = 'EO-Dashboard';
  try { name = await store.getSetting('app_name', 'EO-Dashboard') || 'EO-Dashboard'; } catch (e) { /* الاسم الافتراضي */ }
  res.json({ ok: true, name, apk: fs.existsSync(APK_PATH) });
});

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
    const profiles = await availableProfilesFor(user);
    req.session.profile = profiles[0] ? profiles[0].tab : DEFAULT_TAB; // افتراضي (يُغيّره الاختيار)
    setRememberCookie(res, user.email, req.session.profile); // كوكي الإحياء — تُبقي الدخول بعد نوم/استيقاظ الخادم
    res.json({ ok: true, user, profiles, needProfile: profiles.length > 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(REMEMBER_COOKIE, rememberCookieOpts()); // إلغاء كوكي الإحياء كي لا تعود الجلسة بعد الخروج
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!auth.authEnabled()) return res.json({ ok: true, user: { name: 'زائر', role: 'admin' }, authDisabled: true, storeEnabled: store.enabled, attachmentsEnabled: drive.enabled, telegramEnabled: telegram.enabled, telegramBot: process.env.TELEGRAM_BOT_USERNAME || '' });
  if (!(req.session && req.session.user)) return res.status(401).json({ ok: false, error: 'غير مسجّل الدخول' });
  const user = { ...req.session.user };
  // رمز التقويم الشخصي + حالة ربط تيليجرام + تصميم المستخدم
  let globalTheme = null;
  if (store.enabled) {
    try {
      const full = (await store.getUsersFull()).find((u) => u.email.toLowerCase() === user.email.toLowerCase());
      if (full) { user.calToken = full.token; user.phone = full.phone || user.phone || ''; user.telegramLinked = !!full.telegramChatId; user.theme = full.theme || null; }
    } catch { /* تجاهل */ }
    try { const gv = await store.getSetting('global_theme', ''); globalTheme = gv ? JSON.parse(gv) : null; } catch { /* تجاهل */ }
  }
  const profiles = await availableProfilesFor(req.session.user);
  res.json({ ok: true, user, global_theme: globalTheme, storeEnabled: store.enabled, attachmentsEnabled: drive.enabled, telegramEnabled: telegram.enabled, telegramBot: process.env.TELEGRAM_BOT_USERNAME || '', profile: activeTab(req), profiles });
});

// البروفايلات المتاحة للمستخدم الحالي
app.get('/api/profiles', requireAuth, async (req, res) => {
  try { res.json({ ok: true, profiles: await availableProfilesFor(req.session.user), active: activeTab(req) }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// اختيار البروفايل النشط للجلسة (يجب أن يكون ضمن المتاح للمستخدم)
app.post('/api/profile', requireAuth, async (req, res) => {
  try {
    const tab = String((req.body && req.body.profile) || '').trim();
    const profiles = await availableProfilesFor(req.session.user);
    if (!profiles.some((p) => p.tab === tab)) return res.status(400).json({ ok: false, error: 'بروفايل غير متاح' });
    req.session.profile = tab;
    setRememberCookie(res, req.session.user && req.session.user.email, tab); // تحديث الكوكي ليُستعاد نفس البروفايل بعد الاستيقاظ
    res.json({ ok: true, profile: tab });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
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
    const { firstName, lastName, password, phone } = req.body || {};
    if (firstName != null) patch.firstName = String(firstName).trim();
    if (lastName != null) patch.lastName = String(lastName).trim();
    if (phone != null) patch.phone = String(phone).trim();
    if (password) patch.hash = await auth.hashPassword(password);
    await store.updateUser(String(me.email).toLowerCase(), patch);
    if (phone != null) me.phone = String(phone).trim();
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

// ===== التصاميم (Theme) لكل مستخدم + بثّ المدير =====
function sanitizeTheme(t) {
  if (!t || typeof t !== 'object') return null;
  const base = ['classic', 'wing', 'bp', 'marsad', 'horizon', 'pearl'];
  const design = base.concat(['custom']).includes(t.design) ? t.design : 'classic';
  const mode = t.mode === 'dark' ? 'dark' : 'light';
  const out = { design, mode, glass: !!t.glass };
  // مفتاح «لون التصميم» (تركوازي/نحاسي سنكري)
  if (['teal', 'sankari'].includes(t.accent)) out.accent = t.accent;
  // متحكّمات العلامة المائية (بحدود مضبوطة خادمياً)
  if (t.wm && typeof t.wm === 'object') {
    const clamp = (v, lo, hi) => { const n = Number(v); return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
    const wm = {};
    if (t.wm.size != null) { const v = clamp(t.wm.size, 20, 300); if (v != null) wm.size = v; }
    if (t.wm.op != null) { const v = clamp(t.wm.op, 1, 40); if (v != null) wm.op = v; }
    if (t.wm.dark != null) { const v = clamp(t.wm.dark, -30, 60); if (v != null) wm.dark = v; }
    if (t.wm.top) wm.top = true;
    if (Object.keys(wm).length) out.wm = wm;
  }
  if (design === 'custom' && t.custom && typeof t.custom === 'object') {
    const c = {};
    for (const k of Object.keys(t.custom)) { if (base.includes(t.custom[k])) c[String(k).slice(0, 24)] = t.custom[k]; }
    out.custom = c;
  }
  return out;
}
// المستخدم يحفظ تصميمه الشخصي (يَغلِب التصميم العامّ عند الإقلاع)
app.patch('/api/me/theme', requireAuth, async (req, res) => {
  try {
    if (!store.enabled) return res.json({ ok: true }); // بلا تخزين دائم: يبقى محلياً فقط
    const t = sanitizeTheme((req.body || {}).theme);
    await store.setUserTheme(String(req.session.user.email).toLowerCase(), t ? JSON.stringify(t) : '');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// المدير يبثّ تصميماً لجميع المستخدمين: يخزّنه عامّاً ويكتبه على تصميم كل المستخدمين (دون تثبيت)
app.post('/api/admin/theme-broadcast', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const t = sanitizeTheme((req.body || {}).theme);
    if (!t) return res.status(400).json({ ok: false, error: 'تصميم غير صالح' });
    const value = JSON.stringify(t);
    await store.setSetting('global_theme', value);
    const count = await store.broadcastTheme(value);
    res.json({ ok: true, count });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// المدير فقط يعدّل اسم تطبيق الأندرويد (يظهر داخل التطبيق وشاشة المهام فور فتحه متصلاً؛
// اسم الأيقونة على الشاشة الرئيسية يتبدّل مع تثبيت APK محدَّث — قيد نظام أندرويد).
app.post('/api/admin/app-config', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const name = String((req.body || {}).name || '').trim().slice(0, 40) || 'EO-Dashboard';
    await store.setSetting('app_name', name);
    res.json({ ok: true, name });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== إدارة المستخدمين (مدير) =====
app.get('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try { res.json({ ok: true, users: await auth.listUsers(), storeEnabled: store.enabled }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    const { email, name, firstName, lastName, password, role, profiles, phone } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, error: 'البريد وكلمة المرور مطلوبان' });
    if (!ROLES.includes(role)) return res.status(400).json({ ok: false, error: 'دور غير صالح' });
    const hash = await auth.hashPassword(password);
    await store.addUser({ email: String(email).trim().toLowerCase(), name, firstName, lastName, role, hash, profiles: Array.isArray(profiles) ? profiles : [], phone });
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
    if (req.body && Array.isArray(req.body.profiles)) patch.profiles = req.body.profiles;
    if (req.body && req.body.phone != null) patch.phone = String(req.body.phone).trim();
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

// حذف مستخدم نهائياً (مدير) — لا يمكن حذف الحساب الحالي
app.delete('/api/admin/users/:email', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const email = String(req.params.email).toLowerCase();
    if (email === String(req.session.user.email).toLowerCase()) return res.status(400).json({ ok: false, error: 'لا يمكنك حذف حسابك الحالي.' });
    await store.deleteUser(email);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// إدارة البروفايلات (مدير): عرض + إضافة بروفايل جديد (يُنشئ تبويباً جديداً تلقائياً)
app.get('/api/admin/profiles', requireAuth, requireRole('admin'), async (req, res) => {
  try { res.json({ ok: true, profiles: await store.getProfiles() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/profiles', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    if (!sheets.canWrite) return res.status(400).json({ ok: false, error: 'الكتابة على الشيت معطّلة.' });
    const label = String((req.body && req.body.label) || '').trim();
    if (!label) return res.status(400).json({ ok: false, error: 'اسم البروفايل مطلوب' });
    // اسم التبويب = اسم البروفايل
    await sheets.createProfileTab(label);  // ينشئ التبويب بنفس بنية الجدول
    const prof = await store.addProfile(label, label);
    res.json({ ok: true, profile: prof });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// إعداد اللوحات اليومية (مدير): توقيت الإرسال العام + مستلِم اللوحة الشاملة لكل بروفايل
app.get('/api/admin/digest', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const globalTime = store.enabled ? await store.getSetting('digestTime', '') : '';
    const profiles = await store.getProfiles();
    const full = store.enabled ? (await store.getUsersFull() || []) : (await auth.listUsers());
    const users = full.filter((u) => u.active !== false).map((u) => ({ name: u.name, email: u.email, digestTime: u.digestTime || '' }));
    // القيمة الموحّدة للخانة العليا: التوقيت الفعّال (الخاص أو الموحّد) إن تطابق لدى الجميع، وإلا فارغة («--:--»).
    const validHM = (s) => /^\d{1,2}:\d{2}$/.test(String(s || ''));
    const eff = users.map((u) => (validHM(u.digestTime) ? u.digestTime : globalTime));
    const commonTime = (users.length > 0 && eff.every((t) => t && t === eff[0])) ? eff[0] : '';
    res.json({ ok: true, time: commonTime, globalTime: globalTime || '', profiles, users, storeEnabled: store.enabled });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/digest', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const { time, recipients } = req.body || {};
    // تعميم توقيت موحّد على جميع المستخدمين (زرّ «تعميم على الجميع») + تخزينه افتراضاً عامّاً للمستخدمين الجدد.
    if (time != null) {
      const t = String(time).trim();
      if (t && !/^\d{1,2}:\d{2}$/.test(t)) return res.status(400).json({ ok: false, error: 'صيغة التوقيت غير صحيحة (HH:MM)' });
      await store.setSetting('digestTime', t);
      await store.broadcastDigestTime(t);
      scheduleUpcomingRefresh(); // توقيتات اللوحات من مواعيد الإرسال القادمة (للإيقاظ المسبق)
    }
    if (recipients && typeof recipients === 'object') {
      // قيمة كل بروفايل = مصفوفة بُرُد (أو نصّ مفصول بفواصل) → تُخزَّن مفصولة بفواصل
      for (const [tab, val] of Object.entries(recipients)) {
        const list = Array.isArray(val) ? val : String(val || '').split(',');
        await store.setProfileDigest(tab, list.map((s) => String(s).trim()).filter(Boolean).join(','));
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// توقيت اللوحة اليومية لمستخدم واحد (فارغ = يستعمل التوقيت الموحّد/الافتراضي)
app.post('/api/admin/digest/user', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const t = String((req.body || {}).time || '').trim();
    if (!email) return res.status(400).json({ ok: false, error: 'البريد مطلوب' });
    if (t && !/^\d{1,2}:\d{2}$/.test(t)) return res.status(400).json({ ok: false, error: 'صيغة التوقيت غير صحيحة (HH:MM)' });
    await store.setUserDigestTime(email, t);
    scheduleUpcomingRefresh(); // توقيت المستخدم من مواعيد الإرسال القادمة (للإيقاظ المسبق)
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
// إرسال تجريبي فوري للّوحات اليومية (مدير): يتجاوز التوقيت ومنع التكرار، ولا يعطّل الإرسال المجدول
app.post('/api/admin/digest/test', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const profiles = await store.getProfiles();
    const tasksByProfile = {};
    for (const p of profiles) {
      try { tasksByProfile[p.tab] = await loadTasks(p.tab, true); }
      catch (e) { console.warn('digest-test tab', p.tab, e.message); }
    }
    const result = await notify.sendDailyBoards(profiles, tasksByProfile, store, process.env.APP_URL || '', { force: true });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== جدولة النبضة (فترات عمل الخادم والتذكيرات) — الحزمة 34، ومفتاح «إجبار الإيقاظ» الحزمة 35 =====
// المدير يحدّد أيام الأسبوع وفترة اليوم (بتوقيت دمشق) التي يعمل فيها زناد Apps Script،
// مع مفتاحين مستقلَّين: «النبضة مفعّلة» (enabled = طرقات الدقيقة داخل الفترة)
// و«إجبار الإيقاظ» (force = إيقاظ الخادم قبل كل موعد إرسال بمهلة prewake — يعمل حتى مع تعطيل النبضة).
// الحالات الأربع: enabled+force = فترة + إيقاظ خارجها · enabled فقط = الفترة حصراً (لا إيقاظ خارجها)
// · force فقط = لا فترة إطلاقاً لكن يستيقظ قبل كل إرسال · كلاهما معطَّل = لا يستيقظ أبداً.
// أيام الأسبوع بترقيم JS: 0=الأحد .. 6=السبت.
//
// ⚠️ طبقة ترجمة (كي لا يحتاج سكربت Apps Script v3 الملصوق أيَّ تعديل):
// السكربت يقرأ من settings.trigger الحقول {enabled, days, start, end, prewake} فقط ويفهمها هكذا:
// enabled=false ⇒ صمت تام · days=[] ⇒ لا فترة (إيقاظ مسبق فقط) · prewake=0 ⇒ لا إيقاظ خارج الفترة.
// لذا يخزّن الخادم القيم «المترجمة» للسكربت في هذه الحقول، ويحفظ اختيارات المدير الحرفية في
// حقل فرعي `ui` هو مصدر الحقيقة لواجهة الإعدادات (GET يعيد بناء المنطق منه):
//   enabled+force  ⇒ {enabled:true,  days:أيام المدير, prewake:N}
//   enabled فقط    ⇒ {enabled:true,  days:أيام المدير, prewake:0}
//   force فقط      ⇒ {enabled:true,  days:[],          prewake:N}
//   كلاهما معطَّل  ⇒ {enabled:false}
const TRIGGER_DEFAULT = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59', prewake: 5, force: true };
function sanitizeTrigger(o) {
  if (!o || typeof o !== 'object') return null;
  const validHM = (s) => /^\d{1,2}:\d{2}$/.test(String(s || ''));
  const days = Array.isArray(o.days)
    ? [...new Set(o.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : TRIGGER_DEFAULT.days.slice();
  let prewake = Math.min(120, Math.max(0, parseInt(o.prewake, 10) || 0));
  const force = !!o.force;
  if (force && prewake === 0) prewake = 5; // إجبار الإيقاظ يحتاج مهلة — صفر مع force يُرفع للافتراضي
  return {
    enabled: o.enabled !== false,
    days, // قائمة فارغة = لا فترة عمل
    start: validHM(o.start) ? o.start : TRIGGER_DEFAULT.start,
    end: validHM(o.end) ? o.end : TRIGGER_DEFAULT.end,
    prewake,
    force,
  };
}
// المنطق (اختيارات المدير) → الصيغة المخزّنة التي يفهمها سكربت v3 (انظر جدول الترجمة أعلاه)
function triggerToStored(t) {
  const stored = { enabled: t.enabled || t.force, days: t.days.slice(), start: t.start, end: t.end, prewake: t.prewake };
  if (t.enabled && !t.force) stored.prewake = 0;      // الفترة حصراً — لا إيقاظ خارجها
  if (!t.enabled && t.force) stored.days = [];         // لا فترة إطلاقاً — إيقاظ مسبق فقط
  stored.ui = { enabled: t.enabled, force: t.force, days: t.days.slice(), prewake: t.prewake }; // اختيارات المدير الحرفية
  return stored;
}
// الصيغة المخزّنة → المنطق: من ui إن وُجد؛ وإلا صيغة الحزمة 34 القديمة.
// اشتقاق force للقديمة يطابق سلوكَها الفعلي: الإيقاظ المسبق كان يعمل فقط مع النبضة المفعّلة وprewake>0
// (المعطَّلة كلياً تبقى «المفتاحين معطَّلين» — لا يُخترع لها إجبار لم يكن يعمل).
function storedToTrigger(s) {
  if (s && s.ui && typeof s.ui === 'object') {
    return sanitizeTrigger({ enabled: s.ui.enabled, force: s.ui.force, days: s.ui.days, start: s.start, end: s.end, prewake: s.ui.prewake });
  }
  const legacy = sanitizeTrigger(s);
  if (legacy) legacy.force = legacy.enabled && legacy.prewake > 0;
  return legacy;
}
async function getTriggerCfg() {
  try { const v = await store.getSetting('trigger', ''); const o = v ? storedToTrigger(JSON.parse(v)) : null; return o || { ...TRIGGER_DEFAULT, days: TRIGGER_DEFAULT.days.slice() }; }
  catch { return { ...TRIGGER_DEFAULT, days: TRIGGER_DEFAULT.days.slice() }; }
}
app.get('/api/admin/trigger', requireAuth, requireRole('admin'), async (req, res) => {
  try { res.json({ ok: true, trigger: await getTriggerCfg(), storeEnabled: store.enabled }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/trigger', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل.' });
    const t = sanitizeTrigger((req.body || {}).trigger);
    if (!t) return res.status(400).json({ ok: false, error: 'إعدادات غير صالحة' });
    await store.setSetting('trigger', JSON.stringify(triggerToStored(t)));
    scheduleUpcomingRefresh(); // تحديث «مواعيد الإرسال القادمة» فوراً كي يعمل الإيقاظ المسبق بالجدول الجديد
    res.json({ ok: true, trigger: t });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ===== «مواعيد الإرسال القادمة» (settings.upcoming_sends) — وقود الإيقاظ المسبق =====
// يكتبها الخادم ليقرأها سكربت Apps Script من الشيت مباشرةً ويطرق قبل كل موعد بمقدار prewake.
// تُحدَّث مع كل نبضة (بالبيانات المُحمَّلة أصلاً — بلا قراءات إضافية) وتُكتب فقط عند تغيّر القائمة،
// وتُجدول (بمهلة 5 ثوانٍ تجمع التعديلات المتتالية) بعد أي تعديل يغيّر مواعيد الإرسال.
let _lastUpcomingSig = null;
async function updateUpcomingSends(tasksByRow, reminders) {
  if (!store.enabled) return;
  try {
    const times = (await notify.collectUpcomingSends(tasksByRow, reminders, store)).slice(0, 300);
    const sig = JSON.stringify(times);
    if (sig === _lastUpcomingSig) return;
    await store.setSetting('upcoming_sends', JSON.stringify({ updatedAt: nowStamp(), times }));
    _lastUpcomingSig = sig;
  } catch (e) { console.warn('upcoming_sends', e.message); }
}
async function refreshUpcomingSends() {
  if (!store.enabled) return;
  const reminders = await store.getAllReminders();
  const profiles = await store.getProfiles();
  const tasksByRow = {};
  for (const p of profiles) {
    try { const tasks = await loadTasks(p.tab); for (const t of tasks) if (!(String(t.row) in tasksByRow)) tasksByRow[String(t.row)] = t; }
    catch (e) { console.warn('upcoming-refresh tab', p.tab, e.message); }
  }
  await updateUpcomingSends(tasksByRow, reminders);
}
let _upcomingTimer = null;
function scheduleUpcomingRefresh() {
  if (!store.enabled) return;
  clearTimeout(_upcomingTimer);
  _upcomingTimer = setTimeout(() => { refreshUpcomingSends().catch((e) => console.warn('upcoming-refresh', e.message)); }, 5000);
}

// ذاكرة تخزين مؤقتة قصيرة لكل تبويب (بروفايل) لتقليل طلبات Google API
const DEFAULT_TAB = (store.DEFAULT_PROFILE && store.DEFAULT_PROFILE.tab) || sheets.TAB;
const caches = {}; // tab → { at, tasks }
const CACHE_MS = Number(process.env.CACHE_MS || 8000);

// التبويب النشط للطلب = البروفايل المختار في الجلسة (أو الافتراضي)
function activeTab(req) { return (req && req.session && req.session.profile) || DEFAULT_TAB; }

async function loadTasks(tab, force = false) {
  const t = tab || DEFAULT_TAB;
  const now = Date.now();
  const c = caches[t];
  if (!force && c && now - c.at < CACHE_MS && c.tasks.length) return c.tasks;
  const tasks = await sheets.getTasks(t);
  caches[t] = { at: now, tasks };
  return tasks;
}

function invalidateCache(tab) { if (tab) delete caches[tab]; else Object.keys(caches).forEach((k) => delete caches[k]); }

// قائمة البروفايلات المتاحة لمستخدم (فارغ = الكل)
async function availableProfilesFor(user) {
  const all = store.enabled ? await store.getProfiles() : [store.DEFAULT_PROFILE];
  if (!user || !user.profiles || !user.profiles.length) return all;
  const set = new Set(user.profiles);
  const filtered = all.filter((p) => set.has(p.tab));
  return filtered.length ? filtered : all;
}

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

// ===== تخصيص المخرجات لمستخدمين =====
// مكلّفو المخرجات كتل متوازية لكتل «المخرج المطلوب»؛ «-» (أو «—») = بلا تخصيص.
function splitOwnerNames(raw) {
  return String(raw || '').split(/[\n,،/]+/).map((s) => s.trim()).filter(Boolean);
}
function alignAssignees(raw, n) {
  const a = sheets.fuBlocks(raw || '');
  while (a.length < n) a.push('-');
  return a.slice(0, n);
}
// مواعيد المخرجات: كتل متوازية لكتل «المخرج المطلوب» («-» = بلا موعد) — تُحاذى كالمكلّفين
function alignDvDates(raw, n) {
  const a = sheets.fuBlocks(raw || '');
  while (a.length < n) a.push('-');
  return a.slice(0, n);
}
function dvAssigneeName(v) {
  const s = String(v == null ? '' : v).trim();
  return (s && s !== '-' && s !== '—' && s !== '----------') ? s : '';
}
// هل يحقّ للمستخدم الحالي التصرّف بمخرَج مخصَّص؟ المدير دائماً؛ غير المخصَّص متاح للمحرّر؛ وإلا المخصَّص فقط.
function canActOnDeliv(req, assigneeName) {
  if (!auth.authEnabled()) return true;
  const u = req.session && req.session.user;
  if (auth.hasRole(u, 'admin')) return true;
  if (!assigneeName) return true;
  return String((u && u.name) || '').trim() === String(assigneeName).trim();
}

// تنبيه تيليجرام لمن عُيّن مسؤولاً عن مهمة من قِبل مستخدم آخر (يُتجاهَل من ليس له تيليجرام مربوط)
async function notifyOwnersAssigned(req, info, addedNames) {
  try {
    if (!telegram.enabled || !store.enabled) return;
    const actor = authorName(req.session && req.session.user);
    const added = (addedNames || []).map((s) => String(s).trim()).filter(Boolean).filter((n) => n !== actor);
    if (!added.length) return;
    const users = (await store.getUsersFull()) || [];
    const appUrl = process.env.APP_URL || '';
    const title = esc(`${info.project || 'مهمة'}${info.file ? ' — ' + info.file : ''}`);
    for (const name of added) {
      const u = users.find((x) => String(x.name || '').trim() === name && x.telegramChatId);
      if (!u) continue;
      const line = `📌 تم تعيينك مسؤولاً عن مهمة: <b>${title}</b> من قِبل ${esc(actor)}${info.deadlineRaw ? `\nالموعد: ${esc(info.deadlineRaw)}` : ''}`;
      telegram.sendMessage(u.telegramChatId, `${line}${appUrl ? '\n' + appUrl : ''}`).catch(() => { /* تجاهل */ });
    }
  } catch (e) { console.warn('notifyOwnersAssigned', e.message); }
}

// تنبيه تيليجرام لمن أُسند إليه مخرَج من قِبل مستخدم آخر (نفس مبدأ تنبيه إسناد المهمة)
async function notifyDeliverableAssigned(req, info, assigneeName, deliverableText) {
  try {
    if (!telegram.enabled || !store.enabled) return;
    const actor = authorName(req.session && req.session.user);
    const name = String(assigneeName || '').trim();
    if (!name || name === actor) return;
    const u = ((await store.getUsersFull()) || []).find((x) => String(x.name || '').trim() === name && x.telegramChatId);
    if (!u) return;
    const appUrl = process.env.APP_URL || '';
    const title = esc(`${(info && info.project) || 'مهمة'}${info && info.file ? ' — ' + info.file : ''}`);
    const line = `📎 تم إسناد مخرَج إليك ضمن مهمة: <b>${title}</b> من قِبل ${esc(actor)}${deliverableText ? `\nالمخرَج: ${esc(deliverableText)}` : ''}`;
    telegram.sendMessage(u.telegramChatId, `${line}${appUrl ? '\n' + appUrl : ''}`).catch(() => { /* تجاهل */ });
  } catch (e) { console.warn('notifyDeliverableAssigned', e.message); }
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
    meetings: { total: 0, required: 0, scheduled: 0, done: 0 },
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
    // عدّ الاجتماعات حسب الحالة (مطلوب/مجدول/تم) — المهمة قد تحوي عدّة اجتماعات
    for (const m of (t.meetings || [])) {
      s.meetings.total++;
      if (m.status === 'done') s.meetings.done++;
      else if (m.status === 'scheduled') s.meetings.scheduled++;
      else s.meetings.required++;
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
    const tasks = await loadTasks(activeTab(req), req.query.refresh === '1');
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
    // المسؤولون قبل التعديل (لاكتشاف المُضافين حديثاً وتنبيههم)
    let oldOwners = [];
    if (req.body && 'owner' in req.body) {
      try { const before = (await loadTasks(activeTab(req))).find((x) => String(x.row) === String(req.params.row)); oldOwners = (before && before.owners) || []; } catch { /* تجاهل */ }
    }
    const task = await sheets.updateTask(activeTab(req), req.params.row, req.body || {});
    invalidateCache(activeTab(req));
    scheduleUpcomingRefresh(); // الموعد/الحالة/المسؤولون يغيّرون مواعيد الإرسال القادمة
    res.json({ ok: true, task });
    // تنبيه المسؤولين المُضافين حديثاً عبر تيليجرام (بعد الردّ، لا يعطّل الاستجابة)
    if (req.body && 'owner' in req.body) {
      const oldSet = oldOwners.map((o) => o.trim());
      const added = (task.owners || []).filter((n) => !oldSet.includes(n.trim()));
      if (added.length) notifyOwnersAssigned(req, task, added);
    }
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
    const task = await sheets.updateTask(activeTab(req), req.params.row, { status });
    invalidateCache(activeTab(req));
    scheduleUpcomingRefresh(); // إنجاز المهمة يُسقط تذكيراتها من مواعيد الإرسال القادمة
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
    const tasks = await loadTasks(activeTab(req), true);
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
    const task = await sheets.updateTask(activeTab(req), req.params.row, { followup: fB.join('\n\n'), log: lB.join('\n\n') });
    invalidateCache(activeTab(req));
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
    const tasks = await loadTasks(activeTab(req), true);
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

    const task = await sheets.updateTask(activeTab(req), req.params.row, { followup: fB.join('\n\n'), log: lB.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { console.error('PATCH followup', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// حذف حدث متابعة بالموضع — يحذف نصّه وسجلّه معاً
app.delete('/api/tasks/:row/followup/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const fB = sheets.fuBlocks(t ? t.followup : '');
    const lB = sheets.fuBlocks(t ? t.log : '');
    while (lB.length < fB.length) lB.push('----------');
    if (!Number.isInteger(idx) || idx < 0 || idx >= fB.length) return res.status(400).json({ ok: false, error: 'حدث غير موجود' });
    fB.splice(idx, 1);
    lB.splice(idx, 1);
    const task = await sheets.updateTask(activeTab(req), req.params.row, { followup: fB.join('\n\n'), log: lB.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { console.error('DELETE followup', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// ===== المخرجات المطلوبة ككائنات (كتل مفصولة بسطر فارغ في نفس الخلية) =====
app.post('/api/tasks/:row/deliverable', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim().replace(/\n\s*\n+/g, '\n');
    if (!text) return res.status(400).json({ ok: false, error: 'نصّ المخرج فارغ' });
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    const aB = alignAssignees(t ? t.assignees : '', dB.length);
    const dD = alignDvDates(t ? t.dvdates : '', dB.length);
    const dN = alignDvDates(t ? t.dvdone : '', dB.length);
    dB.push(text); aB.push('-'); dD.push('-'); dN.push('-'); // المخرج الجديد بلا تخصيص ولا موعد ولا إنجاز
    const task = await sheets.updateTask(activeTab(req), req.params.row, { deliverable: dB.join('\n\n'), dvowners: aB.join('\n\n'), dvdates: dD.join('\n\n'), dvdone: dN.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { console.error('POST deliverable', err.message); res.status(400).json({ ok: false, error: err.message }); }
});
app.patch('/api/tasks/:row/deliverable/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '').trim().replace(/\n\s*\n+/g, '\n');
    if (!text) return res.status(400).json({ ok: false, error: 'نصّ المخرج فارغ' });
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    const aB = alignAssignees(t ? t.assignees : '', dB.length);
    if (!canActOnDeliv(req, dvAssigneeName(aB[idx]))) return res.status(403).json({ ok: false, error: 'هذا المخرج مخصَّص لمستخدم آخر' });
    dB[idx] = text;
    const task = await sheets.updateTask(activeTab(req), req.params.row, { deliverable: dB.join('\n\n'), dvowners: aB.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});
app.delete('/api/tasks/:row/deliverable/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    const aB = alignAssignees(t ? t.assignees : '', dB.length);
    if (!canActOnDeliv(req, dvAssigneeName(aB[idx]))) return res.status(403).json({ ok: false, error: 'هذا المخرج مخصَّص لمستخدم آخر' });
    const dD = alignDvDates(t ? t.dvdates : '', dB.length);
    const dN = alignDvDates(t ? t.dvdone : '', dB.length);
    dB.splice(idx, 1); aB.splice(idx, 1); dD.splice(idx, 1); dN.splice(idx, 1);
    const task = await sheets.updateTask(activeTab(req), req.params.row, { deliverable: dB.join('\n\n'), dvowners: aB.join('\n\n'), dvdates: dD.join('\n\n'), dvdone: dN.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// تأشير/إلغاء تأشير مخرج كمنجَز (بإضافة/إزالة «✓»)؛ عند إنجاز كل المخرجات تصبح المهمة «منجزة»
app.post('/api/tasks/:row/deliverable/:idx/toggle', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    const aB = alignAssignees(t ? t.assignees : '', dB.length);
    if (!canActOnDeliv(req, dvAssigneeName(aB[idx]))) return res.status(403).json({ ok: false, error: 'هذا المخرج مخصَّص لمستخدم آخر' });
    const done = /^✓/.test(dB[idx]);
    dB[idx] = done ? dB[idx].replace(/^✓\s*/, '') : '✓ ' + dB[idx];
    const patch = { deliverable: dB.join('\n\n'), dvowners: aB.join('\n\n') };
    // تثبيت/مسح تاريخ إنجاز المخرَج (لتجميد عدّاد الأيام عند الإنجاز؛ done=true يعني كان منجزاً فنُلغيه)
    const dN = alignDvDates(t ? t.dvdone : '', dB.length);
    dN[idx] = done ? '-' : nowStamp().slice(0, 10);
    patch.dvdone = dN.join('\n\n');
    if (dB.length && dB.every((b) => /^✓/.test(b))) patch.status = sheets.DONE_STATUS;
    const task = await sheets.updateTask(activeTab(req), req.params.row, patch);
    invalidateCache(activeTab(req));
    scheduleUpcomingRefresh(); // إنجاز/إلغاء إنجاز مخرَج يغيّر أهداف التذكير القادمة
    res.json({ ok: true, task });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// تخصيص مخرَج لمستخدم (أو إزالة التخصيص بإرسال قيمة فارغة) — للمحرّر/المدير
app.post('/api/tasks/:row/deliverable/:idx/assignee', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const assignee = String((req.body && req.body.assignee) || '').trim();
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    const aB = alignAssignees(t ? t.assignees : '', dB.length);
    // إعادة التخصيص محصورة بالمخصَّص الحالي أو المدير (غير المخصَّص متاح لأي محرّر)
    if (!canActOnDeliv(req, dvAssigneeName(aB[idx]))) return res.status(403).json({ ok: false, error: 'هذا المخرج مخصَّص لمستخدم آخر' });
    const prevAssignee = dvAssigneeName(aB[idx]);
    aB[idx] = assignee || '-';
    const task = await sheets.updateTask(activeTab(req), req.params.row, { dvowners: aB.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
    // تنبيه المُسنَد إليه المخرَج عبر تيليجرام (فور الإسناد، إن اختلف عن المُسنَد سابقاً وعن الفاعل)
    if (assignee && assignee.trim() !== prevAssignee) notifyDeliverableAssigned(req, { project: t && t.project, file: t && t.file }, assignee, dB[idx]);
  } catch (err) { console.error('POST deliverable assignee', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// إعادة تسمية مشروع عبر كل مهام البروفايل الحالي (تحديث كل المهام التي مشروعها بالاسم القديم)
app.post('/api/projects/rename', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const from = String((req.body && req.body.from) || '').trim();
    const to = String((req.body && req.body.to) || '').trim();
    if (!from || !to) return res.status(400).json({ ok: false, error: 'الاسم القديم والجديد مطلوبان' });
    const count = await sheets.renameFieldValue(activeTab(req), 'project', from, to);
    invalidateCache(activeTab(req));
    res.json({ ok: true, count });
  } catch (err) { console.error('POST projects/rename', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// إعادة تسمية اسم شخص داخل عمود «مرتبط بـ» عبر كل مهام البروفايل الحالي
app.post('/api/linked/rename', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const from = String((req.body && req.body.from) || '').trim();
    const to = String((req.body && req.body.to) || '').trim();
    if (!from || !to) return res.status(400).json({ ok: false, error: 'الاسم القديم والجديد مطلوبان' });
    const count = await sheets.renameLinkedName(activeTab(req), from, to);
    invalidateCache(activeTab(req));
    res.json({ ok: true, count });
  } catch (err) { console.error('POST linked/rename', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// ضبط/إزالة موعد مخرَج (يُسجَّل في عمود «مواعيد المخرجات» ككتلة متوازية؛ فارغ = إزالة الموعد).
// موعد المخرَج يُدرِج المهمة في اللوحة/التذكير عند اقترابه دون التأثير على آلية موعد المهمة العامة.
app.post('/api/tasks/:row/deliverable/:idx/date', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const date = String((req.body && req.body.date) || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date) && !/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(date)) {
      return res.status(400).json({ ok: false, error: 'صيغة تاريخ غير صحيحة (YYYY-MM-DD)' });
    }
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const dB = sheets.fuBlocks(t ? t.deliverable : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= dB.length) return res.status(400).json({ ok: false, error: 'مخرج غير موجود' });
    const aB = alignAssignees(t ? t.assignees : '', dB.length);
    if (!canActOnDeliv(req, dvAssigneeName(aB[idx]))) return res.status(403).json({ ok: false, error: 'هذا المخرج مخصَّص لمستخدم آخر' });
    const dD = alignDvDates(t ? t.dvdates : '', dB.length);
    dD[idx] = date || '-';
    const task = await sheets.updateTask(activeTab(req), req.params.row, { dvdates: dD.join('\n\n') });
    invalidateCache(activeTab(req));
    scheduleUpcomingRefresh(); // موعد المخرَج هدف تذكير مستقلّ — يغيّر مواعيد الإرسال القادمة
    res.json({ ok: true, task });
  } catch (err) { console.error('POST deliverable date', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// حذف مهمة (يحذف صفّها من الشيت)
app.delete('/api/tasks/:row', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    await sheets.deleteTask(activeTab(req), req.params.row);
    invalidateCache(activeTab(req));
    scheduleUpcomingRefresh(); // حذف المهمة يُسقط تذكيراتها من مواعيد الإرسال القادمة
    res.json({ ok: true });
  } catch (err) { console.error('DELETE /api/tasks', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

// ===== المرفقات (رفع إلى Google Drive وحفظ الرابط في عمود «مرفقات») =====
app.post('/api/tasks/:row/attachment', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    if (!drive.enabled) return res.status(400).json({ ok: false, error: 'المرفقات غير مفعّلة (إعداد Google Drive مطلوب).' });
    const { name, mime, data } = req.body || {};
    if (!data) return res.status(400).json({ ok: false, error: 'لا يوجد ملف' });
    const buffer = Buffer.from(String(data), 'base64');
    if (!buffer.length) return res.status(400).json({ ok: false, error: 'ملف فارغ' });
    if (buffer.length > 8 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'حجم الملف يتجاوز ٨ ميغابايت' });
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const folderName = `${(t && t.project) || 'مشروع'} - ${(t && t.file) || 'ملف'}`.trim();
    const up = await drive.uploadFile({ folderName, filename: String(name || 'ملف'), mimeType: mime, buffer });
    const blocks = sheets.fuBlocks(t ? t.attachments : '');
    blocks.push(`${up.name}\n${up.url}`);
    const task = await sheets.updateTask(activeTab(req), req.params.row, { attachments: blocks.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { console.error('POST attachment', err.message); res.status(400).json({ ok: false, error: err.message }); }
});

app.delete('/api/tasks/:row/attachment/:idx', requireAuth, requireRole('editor'), requireWrite, async (req, res) => {
  try {
    const idx = Number(req.params.idx);
    const tasks = await loadTasks(activeTab(req), true);
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    const blocks = sheets.fuBlocks(t ? t.attachments : '');
    if (!Number.isInteger(idx) || idx < 0 || idx >= blocks.length) return res.status(400).json({ ok: false, error: 'مرفق غير موجود' });
    const url = (blocks[idx].split('\n')[1] || '').trim();
    drive.deleteFile(url).catch(() => { /* تجاهل */ });
    blocks.splice(idx, 1);
    const task = await sheets.updateTask(activeTab(req), req.params.row, { attachments: blocks.join('\n\n') });
    invalidateCache(activeTab(req));
    res.json({ ok: true, task });
  } catch (err) { console.error('DELETE attachment', err.message); res.status(400).json({ ok: false, error: err.message }); }
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
    await sheets.addTask(activeTab(req), body);
    invalidateCache(activeTab(req));
    scheduleUpcomingRefresh(); // مهمة جديدة مؤرّخة = تذكير افتراضي جديد ضمن مواعيد الإرسال
    res.json({ ok: true });
    // تنبيه المسؤولين المعيَّنين عند الإنشاء عبر تيليجرام (عدا من أنشأ المهمة)
    const owners = splitOwnerNames(body.owner);
    if (owners.length) notifyOwnersAssigned(req, { project: body.project, file: body.file, deadlineRaw: body.deadlineRaw }, owners);
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
    let email = req.session?.user?.email;
    // المدير يستطيع جلب تذكيرات مستخدم آخر عبر ?user=
    if (req.query.user && auth.hasRole(req.session.user, 'admin')) email = String(req.query.user).toLowerCase();
    if (!store.enabled || !email) return res.json({ ok: true, reminders: {}, storeEnabled: store.enabled });
    res.json({ ok: true, reminders: await store.getReminders(email), methods: REMINDER_METHODS, offsets: REMINDER_OFFSETS });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// تطبيع مصفوفة التوقيتات [{t,count,every}]
function sanitizeTimes(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => ({ t: /^\d{1,2}:\d{2}$/.test(String(x && x.t)) ? x.t : '', count: Math.min(20, Math.max(1, parseInt(x && x.count, 10) || 1)), every: Math.min(720, Math.max(0, parseInt(x && x.every, 10) || 0)) }))
    .filter((x) => x.t);
}

app.post('/api/tasks/:row/reminder', requireAuth, async (req, res) => {
  try {
    if (!store.enabled) return res.status(400).json({ ok: false, error: 'التخزين الدائم غير مفعّل (اضبط DATA_SHEET_ID).' });
    let email = req.session.user.email;
    // المدير يضبط تذكيراً لمستخدم آخر عبر body.user
    if (req.body.user && auth.hasRole(req.session.user, 'admin')) email = String(req.body.user).toLowerCase();
    const methods = (req.body.methods || []).filter((m) => REMINDER_METHODS.includes(m));
    const days = (req.body.days || req.body.offsets || []).filter((o) => REMINDER_OFFSETS.includes(o));
    const dates = (req.body.dates || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    const times = sanitizeTimes(req.body.times);
    // فهرس الاجتماع (اختياري): إن وُجد فهو تذكير اجتماع يُحسب نسبةً لموعد ذلك الاجتماع
    const mi = parseInt(req.body.meeting, 10);
    const meeting = (req.body.meeting != null && req.body.meeting !== '' && Number.isInteger(mi) && mi >= 0) ? String(mi) : '';
    await store.setReminder(email, req.params.row, methods, days, dates, times, meeting);
    scheduleUpcomingRefresh(); // التذكير الجديد/المعدَّل يغيّر مواعيد الإرسال القادمة
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// إطلاق تذكير لحظي للمستخدم الحالي (بريد/تيليجرام) — يستدعيه محرّك التذكير عميلياً في الوقت المضبوط
app.post('/api/tasks/:row/notify', requireAuth, async (req, res) => {
  try {
    const methods = (req.body.methods || []).filter((m) => ['email', 'telegram'].includes(m));
    if (!methods.length) return res.json({ ok: true, sent: [] });
    const tasks = await loadTasks(activeTab(req));
    const t = tasks.find((x) => String(x.row) === String(req.params.row));
    if (!t) return res.status(404).json({ ok: false, error: 'مهمة غير موجودة' });
    const u = req.session.user;
    const isOwner = (t.owners || []).map((o) => o.trim()).includes(String(u.name || '').trim());
    const ownerNote = (!isOwner && t.owner) ? ` — المسؤول المعني: ${t.owner.replace(/\n+/g, '، ')}` : '';
    const title = `${t.project}${t.file ? ' — ' + t.file : ''}`;
    const line = `🔔 تذكير بمهمة: ${title}${ownerNote}${t.deadlineRaw ? ` (الموعد: ${t.deadlineRaw})` : ''}`;
    const appUrl = process.env.APP_URL || '';
    const sent = [];
    if (methods.includes('email') && notify.emailEnabled()) {
      try { await notify.sendEmail({ to: u.email, subject: `تذكير: ${t.project}`, html: `<div style="font-family:Cairo,Arial,sans-serif;direction:rtl;color:#2b2823">${esc(line)}${appUrl ? `<p style="margin-top:14px"><a href="${appUrl}" style="background:#bd6a43;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">فتح اللوحة</a></p>` : ''}</div>` }); sent.push('email'); }
      catch (e) { console.warn('notify email', e.message); }
    }
    if (methods.includes('telegram') && telegram.enabled && store.enabled) {
      try {
        const full = (await store.getUsersFull() || []).find((x) => x.email.toLowerCase() === u.email.toLowerCase());
        if (full && full.telegramChatId) { const ok = await telegram.sendMessage(full.telegramChatId, `${telegram.esc(line)}${appUrl ? '\n' + appUrl : ''}`); if (ok) sent.push('telegram'); }
      } catch (e) { console.warn('notify telegram', e.message); }
    }
    res.json({ ok: true, sent });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ===== تغذية التقويم (ICS) — اشتراك دائم برمز شخصي =====
app.get('/api/calendar/:token.ics', async (req, res) => {
  try {
    const user = await store.getUserByToken(req.params.token);
    if (!user) return res.status(404).send('NOT FOUND');
    const tasks = await loadTasks(DEFAULT_TAB);
    const byRow = {}; tasks.forEach((t) => { byRow[String(t.row)] = t; });
    const reminders = await store.getReminders(user.email);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="eo-dashboard.ics"');
    res.send(calendar.buildICS(byRow, reminders));
  } catch (e) { res.status(500).send('ERROR: ' + e.message); }
});

// ===== Telegram webhook: ربط رقم المستخدم بحسابه عند مشاركته رقمه مع البوت =====
app.post('/api/telegram/webhook', async (req, res) => {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.get('x-telegram-bot-api-secret-token') !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }
  res.sendStatus(200); // ردّ سريع لتيليجرام
  try {
    const msg = (req.body && req.body.message) || null;
    if (!msg) return;
    const chatId = msg.chat && msg.chat.id;
    if (!chatId) return;
    if (msg.contact && msg.contact.phone_number) {
      const phone = telegram.normPhone(msg.contact.phone_number);
      const linked = store.enabled ? await store.linkTelegram(phone, chatId) : null;
      await telegram.sendMessage(chatId, linked
        ? `✅ تم ربط رقمك بحساب «${linked.name}». ستصلك تذكيرات المهام هنا.`
        : '⚠️ لم نجد مستخدماً بهذا الرقم على اللوحة. تأكّد من إدخال رقمك (مع رمز الدولة) في حسابك، ثم أعد المشاركة.');
    } else {
      await telegram.sendWelcome(chatId);
    }
  } catch (e) { console.warn('telegram webhook:', e.message); }
});

// المهمة المجدولة: ملخص يومي عبر البريد و Push (يستدعيها GitHub Actions)
async function runDailyDigest(req, res) {
  const secret = req.get('x-cron-secret') || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'رمز غير صالح' });
  }
  try {
    const tasks = await loadTasks(activeTab(req), true);
    const appUrl = process.env.APP_URL || '';
    const digest = await notify.sendDailyDigest(tasks, appUrl);
    // ملاحظة: تذكيرات المهام بالتاريخ/الوقت تُطلَق عميلياً في أوقاتها المضبوطة (لا من الـ cron)
    res.json({ ok: true, mail: { enabled: notify.emailEnabled(), provider: notify.emailProvider() }, digest });
  } catch (e) {
    console.error('daily-digest', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}
app.post('/api/cron/daily-digest', runDailyDigest);
app.get('/api/cron/daily-digest', runDailyDigest);

// نبضة التذكيرات بالوقت الدقيق: يستدعيها مجدول خارجي كل دقيقة/خمس دقائق فتصل التذكيرات دون فتح اللوحة
// قفل تنفيذ داخل العملية: النبضات تأتي من أكثر من مصدر (Apps Script كل دقيقة + GitHub كل ٥ دقائق)،
// وعند دقيقة إرسال اللوحات قد تستغرق الدورة أكثر من دقيقة، فتتداخل النبضات وتقرأ سجلّ الإرسال قبل
// اكتمال تسجيله ⇒ رسائل مكرّرة. الحلّ: نبضة واحدة فقط في أي لحظة؛ المتداخلة تُرَدّ فوراً «busy».
let _tickBusy = false;
async function runReminderTick(req, res) {
  const secret = req.get('x-cron-secret') || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ ok: false, error: 'رمز غير صالح' });
  }
  if (_tickBusy) return res.json({ ok: true, skipped: 'busy' });
  _tickBusy = true;
  try {
    if (!store.enabled) return res.json({ ok: true, skipped: 'store-disabled' });
    const reminders = await store.getAllReminders();
    // خريطة الصف→المهمة عبر كل البروفايلات (البروفايل الافتراضي له الأولوية) + مهام كل بروفايل على حدة (للّوحات)
    const profiles = await store.getProfiles();
    const tasksByRow = {};
    const tasksByProfile = {};
    for (const p of profiles) {
      try { const tasks = await loadTasks(p.tab, true); tasksByProfile[p.tab] = tasks; for (const t of tasks) if (!(String(t.row) in tasksByRow)) tasksByRow[String(t.row)] = t; }
      catch (e) { console.warn('reminder-tick tab', p.tab, e.message); }
    }
    const appUrl = process.env.APP_URL || '';
    const result = await notify.sendScheduledReminders(tasksByRow, reminders, appUrl, store);
    // اللوحات اليومية في توقيتها المضبوط (مرّة/يوم)
    let boards = { skipped: 'n/a' };
    try { boards = await notify.sendDailyBoards(profiles, tasksByProfile, store, appUrl); }
    catch (e) { console.warn('daily-boards', e.message); boards = { error: e.message }; }
    // تحديث «مواعيد الإرسال القادمة» بالبيانات المُحمَّلة في هذه النبضة (يُكتب فقط عند التغيّر)
    try { await updateUpcomingSends(tasksByRow, reminders); } catch (e) { console.warn('upcoming_sends tick', e.message); }
    res.json({ ok: true, ...result, boards });
  } catch (e) {
    console.error('reminder-tick', e.message);
    res.status(500).json({ ok: false, error: e.message });
  } finally {
    _tickBusy = false; // تحرير القفل دائماً (نجاحاً أو فشلاً)
  }
}
app.post('/api/cron/reminders', runReminderTick);
app.get('/api/cron/reminders', runReminderTick);

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
    attachmentsEnabled: drive.enabled,
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

// تشخيص تيليجرام (مدير): يكشف الحلقة المعطوبة — التفعيل / الـ webhook / الحسابات المربوطة / إعداد الـ cron
async function diagTelegram(req, res) {
  try {
    const bot = await telegram.getMe();
    const webhook = await telegram.getWebhookInfo();
    let linkedUsers = [];
    if (store.enabled) {
      try { linkedUsers = ((await store.getUsersFull()) || []).filter((u) => u.telegramChatId).map((u) => ({ name: u.name, email: u.email })); }
      catch (e) { /* تجاهل */ }
    }
    res.json({
      ok: true,
      enabled: telegram.enabled,            // هل TELEGRAM_BOT_TOKEN مضبوط؟
      bot,                                  // username/id البوت أو خطأ التوكن
      webhook,                              // url + pending + lastErrorMessage (أهم مؤشّر)
      appUrl: process.env.APP_URL || null,  // يلزم لتسجيل الـ webhook
      cronSecretSet: !!process.env.CRON_SECRET,
      storeEnabled: store.enabled,
      linkedCount: linkedUsers.length,      // كم حساباً مربوطاً فعلاً
      linkedUsers,
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
app.get('/api/diag/telegram', requireAuth, requireRole('admin'), diagTelegram);

// إرسال رسالة اختبار إلى حساب المدير الحالي (يعزل مشكلة «الإرسال» عن مشكلة «الجدولة»)
async function diagTelegramTest(req, res) {
  try {
    if (!telegram.enabled) return res.json({ ok: false, error: 'البوت غير مفعّل (TELEGRAM_BOT_TOKEN غير مضبوط)' });
    if (!store.enabled) return res.json({ ok: false, error: 'التخزين الدائم غير مفعّل' });
    const me = ((await store.getUsersFull()) || []).find((u) => u.email.toLowerCase() === String(req.session.user.email).toLowerCase());
    if (!me) return res.json({ ok: false, error: 'تعذّر إيجاد حسابك في التخزين' });
    if (!me.telegramChatId) return res.json({ ok: false, error: 'حسابك غير مربوط بتيليجرام (لا يوجد chatId). أكمِل الربط: شارك رقمك مع البوت.' });
    const r = await telegram.trySend(me.telegramChatId, '✅ رسالة اختبار من لوحة الإدارة التنفيذية — إن وصلتك هذه فإنّ إرسال تيليجرام يعمل بشكل سليم.');
    res.json({ ok: r.ok, error: r.error || null, chatId: me.telegramChatId, sentTo: me.name });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
}
app.get('/api/diag/telegram/test', requireAuth, requireRole('admin'), diagTelegramTest);
app.post('/api/diag/telegram/test', requireAuth, requireRole('admin'), diagTelegramTest);

// تشخيص البريد (مدير): هل البريد مُهيّأ؟ وأيّ مزوّد؟
app.get('/api/diag/email', requireAuth, requireRole('admin'), (req, res) => {
  res.json({
    ok: true,
    enabled: notify.emailEnabled(),
    provider: notify.emailProvider(),  // gmail | brevo | smtp | none
    gmail: !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN),
    brevo: !!process.env.BREVO_API_KEY,
    smtp: !!process.env.SMTP_HOST,
    sender: process.env.GMAIL_SENDER || process.env.SENDER_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER || null,
    notifyEmail: process.env.NOTIFY_EMAIL || null,
  });
});
// إرسال بريد اختبار إلى المدير الحالي (أو ?to=) — يُرجع الخطأ الفعلي إن فشل
async function diagEmailTest(req, res) {
  try {
    if (!notify.emailEnabled()) return res.json({ ok: false, error: 'البريد غير مُهيّأ على الخادم (لم يُضبط Gmail/Brevo/SMTP)' });
    const to = (req.query.to && String(req.query.to).trim()) || req.session.user.email;
    await notify.sendEmail({ to, subject: 'اختبار بريد — لوحة الإدارة التنفيذية', html: '<div style="font-family:Cairo,Arial,sans-serif;direction:rtl;color:#2b2823">✅ إن وصلتك هذه الرسالة فإنّ إرسال البريد يعمل بشكل سليم. إن لم تجدها في الوارد فابحث في مجلد <b>الرسائل غير المرغوب فيها (Spam)</b>.</div>' });
    res.json({ ok: true, sentTo: to, provider: notify.emailProvider() });
  } catch (e) { res.json({ ok: false, error: e.message, provider: notify.emailProvider() }); }
}
app.get('/api/diag/email/test', requireAuth, requireRole('admin'), diagEmailTest);
app.post('/api/diag/email/test', requireAuth, requireRole('admin'), diagEmailTest);

// تشخيص جدولة التذكيرات (مدير): محاكاة جافة تكشف لكل تذكير هل يُنتج لحظة إطلاق مستحقّة الآن ولماذا.
// افتراضياً يحلّل تذكيراتك؛ ?all=1 لكل المستخدمين، أو ?user=email لمستخدم محدّد.
app.get('/api/diag/reminders', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!store.enabled) return res.json({ ok: false, error: 'التخزين الدائم غير مفعّل' });
    let reminders = await store.getAllReminders();
    const scope = req.query.all === '1' ? null : (req.query.user ? String(req.query.user).toLowerCase() : String(req.session.user.email).toLowerCase());
    if (scope) reminders = reminders.filter((r) => String(r.email).toLowerCase() === scope);
    // خريطة الصف→المهمة عبر كل البروفايلات (نفس منطق نبضة الـ cron)
    const profiles = await store.getProfiles();
    const tasksByRow = {};
    for (const p of profiles) {
      try { const tasks = await loadTasks(p.tab, true); for (const t of tasks) if (!(String(t.row) in tasksByRow)) tasksByRow[String(t.row)] = t; }
      catch (e) { console.warn('diag/reminders tab', p.tab, e.message); }
    }
    const analysis = await notify.analyzeReminders(tasksByRow, reminders, store);
    res.json({ ok: true, scope: scope || 'كل المستخدمين', ...analysis });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.listen(PORT, async () => {
  console.log(`EO-Dashboard يعمل على المنفذ ${PORT} (الكتابة: ${sheets.canWrite ? 'مفعّلة' : 'معطّلة - قراءة فقط'})`);
  if (sheets.canWrite) {
    try {
      const profs = store.enabled ? await store.getProfiles() : [{ tab: DEFAULT_TAB }];
      for (const p of profs) { try { await sheets.ensureColumns(p.tab); } catch (e) { console.warn('ensureColumns', p.tab, e.message); } }
      console.log('تم التأكد من الأعمدة المُدارة لكل البروفايلات.');
    } catch (e) {
      console.warn('تعذّر إنشاء الأعمدة المُدارة:', e.message);
    }
  }
  console.log(`التخزين الدائم (المستخدمون/التذكيرات): ${store.enabled ? 'مفعّل' : 'معطّل — USERS_JSON فقط'}`);
  // تحديث «مواعيد الإرسال القادمة» عند كل إقلاع (استيقاظ/نشر) كي يجد سكربت الإيقاظ المسبق جدولاً حديثاً
  scheduleUpcomingRefresh();
  // تسجيل webhook تيليجرام تلقائياً (لاستقبال ربط الأرقام)
  if (telegram.enabled && process.env.APP_URL) {
    telegram.setWebhook(`${process.env.APP_URL.replace(/\/$/, '')}/api/telegram/webhook`, process.env.TELEGRAM_WEBHOOK_SECRET).catch((e) => console.warn('telegram webhook reg:', e.message));
  }
});
