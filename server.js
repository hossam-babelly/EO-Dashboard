# نموذج طرح دراسة مشروع 📋

نظام متكامل (Frontend + Backend) لاستقبال وحفظ بيانات دراسات المشاريع.

---

## 📁 هيكل المشروع

```
project-form/
├── public/
│   └── index.html        ← الفورم الكامل (HTML + CSS + JS)
├── data/                 ← يتم إنشاؤه تلقائياً عند أول إرسال
│   ├── index.json        ← فهرس جميع الطلبات
│   └── XXXX.json         ← بيانات كل طلب منفصلاً
├── server.js             ← الـ Backend (Express)
├── package.json
└── README.md
```

---

## 🚀 التثبيت والتشغيل

### المتطلبات
- Node.js v16 أو أحدث
- npm

### الخطوات

```bash
# 1. انتقل إلى مجلد المشروع
cd project-form

# 2. ثبّت المكتبات
npm install

# 3. شغّل الخادم
npm start
```

افتح المتصفح على: **http://localhost:3000**

### للتطوير (مع إعادة تشغيل تلقائية)
```bash
npm run dev
```

---

## 🌐 API Endpoints

| الطريقة | المسار | الوصف |
|---------|--------|-------|
| `GET` | `/` | عرض الفورم |
| `POST` | `/api/submit` | إرسال بيانات مشروع جديد |
| `GET` | `/api/submissions` | قائمة جميع الطلبات |
| `GET` | `/api/submissions/:id` | تفاصيل طلب محدد |
| `DELETE` | `/api/submissions/:id` | حذف طلب |
| `GET` | `/api/export/:id` | تصدير طلب كـ JSON |

### مثال: إرسال عبر fetch
```javascript
const response = await fetch('/api/submit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ projectIdea: '...', ... })
});
const result = await response.json();
// { success: true, id: 'LXYZ-ABC123' }
```

---

## 🌍 النشر على السيرفر

### متغيرات البيئة
```bash
PORT=3000   # المنفذ (افتراضي 3000)
```

### مع PM2 (موصى به للإنتاج)
```bash
npm install -g pm2
pm2 start server.js --name "project-form"
pm2 save
pm2 startup
```

### مع Nginx (Reverse Proxy)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 📊 ميزات الفورم

- **8 خطوات** منظمة: فكرة المشروع ← التكاليف التأسيسية ← المنتجات ← الإيرادات ← التكاليف التشغيلية ← التكاليف الثابتة ← الاهتلاك ← الموارد البشرية
- **ملخص ديناميكي** يتحدث تلقائياً
- **حسابات تلقائية**: الإجماليات، الأرباح، الاهتلاك
- **جداول ديناميكية**: إضافة/حذف أسطر
- **هيكل تنظيمي** يُرسم تلقائياً
- **قوائم منسدلة** قابلة للتوسيع بإضافة خيارات جديدة
- **تنسيق العملة** تلقائي بصيغة $12,200

---

## 🔒 الأمان (للإنتاج)

يُنصح بإضافة:
1. **المصادقة** (JWT أو Session)
2. **Rate Limiting**: `npm install express-rate-limit`
3. **Helmet**: `npm install helmet`
4. **التحقق من البيانات**: `npm install joi`

مثال سريع:
```javascript
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

app.use(helmet());
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 100 }));
```
