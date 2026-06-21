# EO-Dashboard — لوحة متابعة مهام الإدارة التنفيذية

منصة ويب عصرية (RTL عربية) لمتابعة مهام ومخرجات الإدارة التنفيذية لمجموعة **سنكري القابضة**،
تقرأ وتعدّل بياناتها مباشرةً من **Google Sheets** (تبويب «الملخص التنفيذي»).

## ✨ الميزات
- 📊 **لوحة مؤشرات**: مهام اليوم، المتأخرة، خلال ٣ أيام، هذا الأسبوع (السبت→الخميس)، بلا موعد، المتكررة، نسبة الإنجاز.
- 📋 **جدول** بفرز وفلترة حسب المشروع/المسؤول/الأولوية/الحالة + بحث نصي + تلوين حسب الحالة الزمنية.
- 🗂️ **كانبان** بأعمدة الحالة مع السحب والإفلات.
- 🗓️ **تقويم** شهري RTL يبدأ السبت مع إبراز اليوم.
- ✏️ **تعديل وإضافة** المهام مباشرةً (يُكتب إلى الشيت).
- 🔄 **مزامنة شبه لحظية** (سحب دوري + زر تحديث).
- 🔐 **حسابات متعددة** بأدوار (مدير/محرّر/مشاهد).
- 🔔 **تنبيهات**: جرس داخل المنصة + ملخص بريد يومي + إشعارات متصفح (Web Push).

## 🚀 التشغيل محلياً
```bash
npm install
cp .env.example .env   # ثم املأ القيم
npm start              # http://localhost:3000
```

## 🔌 ربط Google Sheets
- **قراءة فقط (تطوير):** عيّن `GOOGLE_API_KEY` لمفتاح Google Sheets API، والشيت مُشارَك «أي شخص لديه الرابط».
- **قراءة + كتابة (إنتاج):** عيّن `GOOGLE_SERVICE_ACCOUNT_JSON` لمحتوى ملف حساب الخدمة، وشارك الشيت مع إيميل الحساب بصلاحية **Editor**.

## ⚙️ متغيّرات البيئة
انظر [`.env.example`](.env.example).

## 📁 الهيكل
```
EO-Dashboard/
├── server.js          # خادم Express + واجهة API
├── lib/
│   ├── sheets.js      # تكامل Google Sheets (قراءة/كتابة)
│   └── dates.js       # منطق التواريخ (توقيت دمشق، الأسبوع سبت→خميس)
├── public/            # الواجهة (index.html + app.js + styles.css)
├── package.json
└── .env.example
```

## 🔐 الحسابات والأدوار
- ولّد مستخدماً: `node scripts/hash-user.js <email> <password> <admin|editor|viewer> <name>`
- اجمع المخرجات داخل مصفوفة JSON واحدة في `USERS_JSON`.

## 🔔 التنبيهات
- **بريد يومي:** اضبط `SMTP_*` و`NOTIFY_EMAIL` (واختيارياً `OWNER_EMAILS`).
- **Web Push:** ولّد المفاتيح `node scripts/gen-vapid.js` واضبط `VAPID_*`.
- **الجدولة:** يستدعي [GitHub Actions](.github/workflows/daily-digest.yml) نقطة `/api/cron/daily-digest` يومياً (يحتاج سرّي `APP_URL` و`CRON_SECRET` في المستودع).
- **تذكيرات بالوقت الدقيق (بريد/تيليجرام دون فتح اللوحة):** يستدعي [workflow التذكيرات](.github/workflows/reminders.yml) نقطة `/api/cron/reminders` كل ٥ دقائق فتُرسل التذكيرات المستحقة في أوقاتها المضبوطة. التواريخ تُحفظ في تبويب `reminders` بملف الـ Data، وتُمنَع التكرارات عبر تبويب `sent`. التوقيت بتوقيت دمشق (UTC+3 ثابت)؛ خيارات اختيارية: `REMINDER_GRACE_MIN` (نافذة السماح للتذكيرات المتأخرة، الافتراضي 120 دقيقة) و`TZ_OFFSET_MIN` (الافتراضي 180).
  - **لدقّة أعلى (كل دقيقة):** الحد الأدنى لجدولة GitHub هو ٥ دقائق وقد يتأخر وقت الذروة. للحصول على دقّة دقيقة واحدة أنشئ مهمة مجانية على [cron-job.org](https://cron-job.org): العنوان `https://<تطبيقك>.onrender.com/api/cron/reminders`، الطريقة POST، أضف ترويسة `x-cron-secret` بقيمة `CRON_SECRET`، والفاصل كل دقيقة. (هذا أيضاً يبقي خادم Render المجاني مستيقظاً.)

## ☁️ النشر على Render
- استخدم [`render.yaml`](render.yaml) أو أنشئ Web Service يدوياً: `buildCommand: npm install`، `startCommand: npm start`.
- اضبط متغيّرات البيئة (خصوصاً `GOOGLE_SERVICE_ACCOUNT_JSON`, `SHEET_ID`, `SESSION_SECRET`, `USERS_JSON`).
