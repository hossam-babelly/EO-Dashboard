'use strict';
/* نظام ترجمة الواجهة (عربي/إنكليزي) + اتجاه (RTL/LTR).
   القاموس مفتاحه النصّ العربي؛ أي نصّ غير موجود يبقى عربياً (تدرّج آمن).
   بيانات المهام المُدخَلة لا تُترجَم — تُترجَم تسميات الواجهة فقط. */
(function () {
  const DICT = {
    // ===== الترويسة =====
    'لوحة الإدارة التنفيذية': 'Executive Management Board',
    'إدارة المستخدمين': 'User management',
    'مجموعة سنكري القابضة — متابعة المهام والمخرجات': 'Sankari Holding — Tasks & deliverables',
    'مجموعة سنكري القابضة': 'Sankari Holding',
    'مهمة جديدة': 'New task', 'تحديث': 'Refresh', 'المستخدمون': 'Users', 'حسابي': 'My account', 'خروج': 'Log out',
    'تفعيل إشعارات المتصفح': 'Enable browser notifications', 'إشعارات المتصفح مُفعّلة': 'Browser notifications enabled',
    'البروفايل': 'Profile', '← رجوع للوحة': '← Back to board', 'رجوع': 'Back',
    'مدير': 'Admin', 'محرّر': 'Editor', 'مشاهد': 'Viewer', 'زائر': 'Guest',
    // ===== الأدوات والفلاتر =====
    '🔍 بحث في المهام...': '🔍 Search tasks...', 'مسح الفلاتر': 'Clear filters', '📄 تقرير': '📄 Report',
    'كل المشاريع': 'All projects', 'كل المسؤولين': 'All owners', 'كل المرتبطين': 'All linked',
    'كل الأنواع': 'All types', 'كل الأولويات': 'All priorities', 'كل الحالات': 'All statuses',
    'المشاريع': 'Projects', 'المسؤولين': 'Owners', 'المرتبطين': 'Linked', 'الأنواع': 'Types', 'الأولويات': 'Priorities', 'الحالات': 'Statuses',
    'بلا نوع': 'No type', 'لا خيارات': 'No options',
    // ===== العروض =====
    '📋 جدول': '📋 Table', '🗂️ كانبان': '🗂️ Kanban', '🗓️ تقويم': '🗓️ Calendar',
    '📌 مهام': '📌 Tasks', '🤝 اجتماعات': '🤝 Meetings', '📦 المخرجات': '📦 Deliverables',
    '↕ عرض موسّع': '↕ Expanded view', '↕ عرض مضغوط': '↕ Compact view', '⚙ الأعمدة': '⚙ Columns',
    // ===== البطاقات (KPI) =====
    'إجمالي المهام': 'Total tasks', 'نسبة الإنجاز': 'Completion', '🤝 اجتماعات مطلوبة': '🤝 Meetings required',
    // ===== شرائح الوقت =====
    'الكل': 'All', 'اليوم': 'Today', 'خلال 3 أيام': 'Within 3 days', 'هذا الأسبوع': 'This week',
    'متأخر': 'Overdue', 'بلا موعد': 'Undated', 'دورية': 'Recurring',
    // ===== أعمدة الجدول =====
    'م': '#', 'المشروع': 'Project', 'الملف': 'File', 'النوع': 'Type', 'المسؤول المعني': 'Owner',
    'المخرج المطلوب': 'Deliverable', 'الموعد': 'Due', 'الأولوية': 'Priority', 'الحالة': 'Status',
    'المتابعة': 'Follow-up', 'تاريخ الإنشاء': 'Created', 'ملاحظات': 'Notes',
    'اسم الاجتماع': 'Meeting', 'موعد الاجتماع': 'Meeting time', 'موعد المهمة': 'Task due', 'حالة الاجتماع': 'Meeting status',
    'مطلوب': 'Required', 'مجدول': 'Scheduled', 'تم': 'Done',
    // ===== نصوص نسبية =====
    'غداً': 'Tomorrow', 'دورية ': 'Recurring',
    // ===== النوافذ =====
    'تفاصيل المهمة': 'Task details', 'إضافة مهمة جديدة': 'Add new task', 'تعديل المهمة': 'Edit task',
    'مرتبط بـ': 'Linked to', 'المخرجات المطلوبة': 'Deliverables', 'الموعد / الدورية': 'Due / recurrence',
    '🤝 الاجتماعات': '🤝 Meetings', 'سجلّ المتابعة اليومية': 'Daily follow-up log', '📎 المرفقات': '📎 Attachments',
    'لا توجد مخرجات بعد.': 'No deliverables yet.', 'لا توجد متابعة بعد.': 'No follow-up yet.',
    'لا اجتماعات. أضف اجتماعاً ليظهر في عرض الاجتماعات.': 'No meetings. Add one to show it in the meetings view.',
    'لا مرفقات.': 'No attachments.', 'لا أحد': 'None', 'لا يوجد (اختياري)': 'None (optional)',
    'المخصَّص:': 'Assigned to:', '— بلا —': '— None —',
    'أضف مخرجاً مطلوباً جديداً…': 'Add a new deliverable…', 'أضف مخرجاً مطلوباً…': 'Add a deliverable…',
    'أضف تحديث متابعة جديد… (يُسجَّل باسمك ووقته تلقائياً)': 'Add a follow-up update… (auto-stamped with your name & time)',
    'أضف حدث متابعة…': 'Add a follow-up event…', 'عنوان الاجتماع…': 'Meeting title…',
    '➕ إضافة مخرج': '➕ Add deliverable', '➕ إضافة حدث': '➕ Add event', '➕ إضافة اجتماع': '➕ Add meeting',
    'الاجتماع': 'Meeting', 'المهمة': 'Task', 'مخرج': 'Deliverable', 'تذكير': 'Reminder', 'تغيير الحالة': 'Change status', 'مختار': 'selected',
    '➕ إضافة جديد…': '➕ Add new…', '➕ إضافة مهمة': '➕ Add task',
    // أزرار عامة
    '💾 حفظ': '💾 Save', 'حفظ': 'Save', 'إلغاء': 'Cancel', 'حذف': 'Delete', 'تعديل': 'Edit', 'أضف': 'Add',
    '💾 حفظ التذكير': '💾 Save reminder', '💾 حفظ الإعدادات': '💾 Save settings',
    '📤 إرسال تجريبي الآن': '📤 Send test now', '➕ إضافة بروفايل': '➕ Add profile', '➕ أضف تاريخاً': '➕ Add date', '➕ أضف توقيتاً': '➕ Add time',
    // التذكيرات
    '🔔 تذكيرات هذه المهمة': '🔔 Reminders for this task', '🔔 تذكير هذا الاجتماع': '🔔 Reminder for this meeting',
    '🔔 التذكيرات': '🔔 Reminders', 'طريقة التذكير:': 'Method:', 'أيام التذكير:': 'Reminder days:',
    '+ تواريخ ثابتة:': '+ Fixed dates:', 'توقيت التذكير (سوريا):': 'Time (Syria):', 'إعدادات المستخدم:': 'User settings:',
    '📧 بريد إلكتروني': '📧 Email', '🔔 إشعار متصفح/حاسوب': '🔔 Browser/desktop notification', '🗓️ تقويم الحاسوب': '🗓️ Computer calendar',
    'موعد المهمة': 'Task due', 'موعد الاجتماع': 'Meeting time', 'قبل يوم': '1 day before', 'قبل 3 أيام': '3 days before', 'قبل أسبوع': '1 week before',
    'كرّر': 'Repeat', 'مرّة، كل': 'time(s), every', 'دقيقة': 'min',
    // التقرير
    'توليد تقرير': 'Generate report', 'اسم ملف التقرير:': 'Report file name:',
    '📕 تقرير PDF': '📕 PDF report', '📘 تقرير Word': '📘 Word report', '📗 تقرير Excel': '📗 Excel report',
    'الأعمدة الظاهرة في التقرير:': 'Columns shown in the report:',
    // الحساب
    'تعديل حسابي': 'Edit my account', 'البريد (اسم الدخول)': 'Email (login)', 'الاسم الأول': 'First name', 'الاسم الأخير': 'Last name',
    'كلمة المرور (اتركها فارغة لعدم التغيير)': 'Password (leave blank to keep)', 'كلمة المرور': 'Password',
    'الدور': 'Role', 'تعطيل': 'Disable', 'تمكين': 'Enable', '✏️ تعديل': '✏️ Edit',
    // إدارة المستخدمين
    '🗂️ البروفايلات': '🗂️ Profiles', '➕ إضافة مستخدم': '➕ Add user', '👥 المستخدمون': '👥 Users',
    '📬 اللوحات اليومية (متأخرة / اليوم / خلال ٣ أيام)': '📬 Daily boards (overdue / today / within 3 days)',
    'توقيت الإرسال اليومي (بتوقيت سوريا)': 'Daily send time (Syria time)', 'مستلِم اللوحة الشاملة لكل بروفايل:': 'Comprehensive board recipient per profile:',
    'اسم البروفايل الجديد': 'New profile name', 'البريد': 'Email', 'الاسم': 'Name', 'إجراءات': 'Actions',
    'رقم الهاتف (تيليجرام)': 'Phone (Telegram)', 'البروفايلات المتاحة (بلا تحديد = الكل)': 'Available profiles (none = all)',
    // تسجيل الدخول
    'تسجيل الدخول': 'Sign in', 'الدخول': 'Sign in', 'دخول': 'Sign in', 'كلمة المرور غير صحيحة': 'Incorrect password',
    'البريد الإلكتروني': 'Email', 'اختر البروفايل للدخول': 'Choose a profile to sign in',
    // عام
    'جارٍ التحميل…': 'Loading…', 'جارٍ تحميل المهام…': 'Loading tasks…',
    // ===== التصاميم والمظهر (نظام الكسوة) =====
    'جدول': 'Table', 'كانبان': 'Kanban', 'تقويم': 'Calendar',
    'مهام': 'Tasks', 'اجتماعات': 'Meetings', 'المخرجات': 'Deliverables',
    'تقرير': 'Report', 'الأعمدة': 'Columns', 'عرض موسّع': 'Expanded view', 'عرض مضغوط': 'Compact view',
    'التصميم والمظهر': 'Design & appearance', 'التصميم': 'Design',
    'الوضع الداكن': 'Dark mode', 'الشفافية الزجاجية': 'Glass transparency',
    'خط الواجهة العربية والعناوين': 'Arabic UI & headings font', 'خط اللاتيني والأرقام': 'Latin & numbers font',
    'افتراضي (Cairo)': 'Default (Cairo)',
    'الكلاسيكي': 'Classic', 'جَناح سنكري': 'Sankari Wing', 'مخطّط الكلك': 'Blueprint', 'المِرصَد': 'Marsad', 'مخصّص (هجين)': 'Custom (hybrid)',
    'الخطوط': 'Fonts',
    'تطبيق هذا التصميم على جميع المستخدمين': 'Apply this design to all users',
    'اختر لكل مفصل من الواجهة تصميمه — فينتج تصميمك الهجين الخاص.': 'Pick a design for each interface facet to build your own hybrid.',
    'المفصل': 'Facet',
    'الخلفية والأسطح والنصوص': 'Background, surfaces & text', 'اللون المميّز (النحاسي)': 'Accent color (copper)',
    'ألوان الحالة (منجَز/تأخّر/تنبيه)': 'State colors (done / late / alert)',
    'الشكل والتوقيع (الزوايا/الظلال/الأيقونات)': 'Shape & signature (corners/shadows/icons)',
    'الترويسة (الشريط العلوي)': 'Header (top bar)', 'خلفية الصفحة (توهّج / شبكة)': 'Page background (glow / grid)',
    'سيُطبَّق التصميم الحالي على جميع المستخدمين (يبقى لكلٍّ تغييره لاحقاً). هل تريد المتابعة؟': 'The current design will be applied to all users (each can still change it later). Continue?',
    'تمّ تطبيق التصميم على جميع المستخدمين': 'Design applied to all users', 'تعذّر التطبيق': 'Could not apply',
    'المدير فقط — يطبّق تصميمك الحالي على كل الحسابات': 'Admin only — applies your current design to all accounts',
    // ===== التصميمان الجديدان + مفتاح اللون + العلامة المائية =====
    'الأفق': 'Horizon', 'اللؤلؤ': 'Pearl',
    'لون التصميم (المميّز)': 'Design accent color', 'نحاسي سنكري': 'Sankari copper', 'تركوازي': 'Teal',
    'توسيع/تضييق الشريط الجانبي': 'Expand/collapse sidebar',
    'إعدادات العلامة المائية': 'Watermark settings',
    'حجم العلامة (٪ من عرض الصفحة)': 'Watermark size (% of page width)',
    'الشفافية (٪)': 'Opacity (%)', 'غماقية اللون': 'Color darkness',
    'العلامة فوق المحتوى': 'Watermark above content', '↺ إعادة الضبط الافتراضي': '↺ Reset to default',
    // ===== نافذة التقرير: الهوية ومستوى التفاصيل =====
    'هوية التقرير (تشمل تقرير المهمة الواحدة):': 'Report identity (incl. single-task report):',
    'سنكري الرسمية (ثابتة)': 'Official Sankari (fixed)', 'تتبع تصميم الواجهة': 'Follow UI design',
    'مستوى التفاصيل (PDF):': 'Detail level (PDF):',
    'كامل التفاصيل': 'Full details', 'آخر 3 أحداث': 'Last 3 events', 'المخرجات فقط': 'Deliverables only',
    // ===== اللوحات اليومية: توقيت لكل مستخدم =====
    'توقيت الإرسال الموحّد (بتوقيت سوريا)': 'Unified send time (Syria time)', '📢 تعميم على الجميع': '📢 Apply to all',
    'توقيت كل مستخدم على حدة:': 'Per-user send time:', '💾 حفظ المستلِمين': '💾 Save recipients',
    'فارغة (--:--) تعني أنّ لبعض المستخدمين توقيتاً مختلفاً. اكتب وقتاً واضغط «تعميم على الجميع» لتوحيدهم.': 'Empty (--:--) means some users have a different time. Enter a time and press “Apply to all” to unify them.',
  };
  // ===== الخطوط القابلة للتبديل (٥ عربية + ٥ لاتينية) — الافتراض غير محدَّد = Cairo (الكلاسيكي مطابق) =====
  const FONT_AR = {
    cairo: "'Cairo', system-ui, 'Segoe UI', sans-serif",
    tajawal: "'Tajawal', 'Cairo', system-ui, sans-serif",
    almarai: "'Almarai', 'Cairo', system-ui, sans-serif",
    plexar: "'IBM Plex Sans Arabic', 'Cairo', system-ui, sans-serif",
    readex: "'Readex Pro', 'Cairo', system-ui, sans-serif",
  };
  const FONT_LATIN = {
    ibmplex: "'IBM Plex Sans', system-ui, sans-serif",
    sora: "'Sora', system-ui, sans-serif",
    space: "'Space Grotesk', system-ui, sans-serif",
    manrope: "'Manrope', system-ui, sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace",
  };
  const FONT_AR_LABELS = { cairo: 'Cairo', tajawal: 'Tajawal', almarai: 'Almarai', plexar: 'IBM Plex Sans Arabic', readex: 'Readex Pro' };
  const FONT_LATIN_LABELS = { ibmplex: 'IBM Plex Sans', sora: 'Sora', space: 'Space Grotesk', manrope: 'Manrope', mono: 'IBM Plex Mono' };
  let fontAr = localStorage.getItem('eo_font_ar') || '';
  let fontLatin = localStorage.getItem('eo_font_latin') || '';
  function applyFonts() {
    const s = document.documentElement.style;
    if (FONT_AR[fontAr]) s.setProperty('--font-ar', FONT_AR[fontAr]); else s.removeProperty('--font-ar');
    if (FONT_LATIN[fontLatin]) s.setProperty('--font-latin', FONT_LATIN[fontLatin]); else s.removeProperty('--font-latin');
  }

  const I = {
    lang: localStorage.getItem('eo_lang') === 'en' ? 'en' : 'ar',
    dir: localStorage.getItem('eo_dir') === 'ltr' ? 'ltr' : 'rtl',
    get fontAr() { return fontAr; },
    get fontLatin() { return fontLatin; },
    fontOptions() { return { ar: Object.keys(FONT_AR), latin: Object.keys(FONT_LATIN) }; },
    fontLabels() { return { ar: FONT_AR_LABELS, latin: FONT_LATIN_LABELS }; },
    setFontAr(v) { fontAr = FONT_AR[v] ? v : ''; localStorage.setItem('eo_font_ar', fontAr); applyFonts(); },
    setFontLatin(v) { fontLatin = FONT_LATIN[v] ? v : ''; localStorage.setItem('eo_font_latin', fontLatin); applyFonts(); },
    t(s) { return (this.lang === 'en' && DICT[s] != null) ? DICT[s] : s; },
    setLang(l) { this.lang = (l === 'en') ? 'en' : 'ar'; localStorage.setItem('eo_lang', this.lang); document.documentElement.lang = this.lang; },
    setDir(d) {
      this.dir = (d === 'ltr') ? 'ltr' : 'rtl';
      localStorage.setItem('eo_dir', this.dir);
      // نضبط السمة + نمط direction inline (لأنّ styles.css يفرض direction:rtl على body)
      document.documentElement.setAttribute('dir', this.dir);
      document.documentElement.style.direction = this.dir;
      if (document.body) { document.body.setAttribute('dir', this.dir); document.body.style.direction = this.dir; }
    },
    // ترجمة العناصر الساكنة المعلَّمة data-i18n / data-i18n-ph / data-i18n-title
    applyStatic(root) {
      const r = root || document;
      r.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.getAttribute('data-i18n')); });
      r.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', this.t(el.getAttribute('data-i18n-ph'))); });
      r.querySelectorAll('[data-i18n-title]').forEach((el) => { el.setAttribute('title', this.t(el.getAttribute('data-i18n-title'))); });
    },
  };
  // طبّق الاتجاه/اللغة المحفوظَين فوراً (قبل الرسم)
  document.documentElement.setAttribute('dir', I.dir);
  document.documentElement.style.direction = I.dir;
  document.documentElement.setAttribute('lang', I.lang);
  applyFonts(); // طبّق الخطّ المحفوظ فوراً (قبل الرسم)

  window.I18N = I;
  window.tr = (s) => I.t(s); // اسم «tr» تفادياً لتعارض «t» المستخدَم لكائن المهمة في app.js
  window.addEventListener('DOMContentLoaded', () => { if (document.body) { document.body.setAttribute('dir', I.dir); document.body.style.direction = I.dir; } I.applyStatic(); });
})();
