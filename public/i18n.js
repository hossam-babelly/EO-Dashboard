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
    '📌 مهام': '📌 Tasks', '🤝 اجتماعات': '🤝 Meetings',
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
  };

  const I = {
    lang: localStorage.getItem('eo_lang') === 'en' ? 'en' : 'ar',
    dir: localStorage.getItem('eo_dir') === 'ltr' ? 'ltr' : 'rtl',
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

  window.I18N = I;
  window.tr = (s) => I.t(s); // اسم «tr» تفادياً لتعارض «t» المستخدَم لكائن المهمة في app.js
  window.addEventListener('DOMContentLoaded', () => { if (document.body) { document.body.setAttribute('dir', I.dir); document.body.style.direction = I.dir; } I.applyStatic(); });
})();
