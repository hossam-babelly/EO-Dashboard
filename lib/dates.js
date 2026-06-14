'use strict';

/**
 * منطق التواريخ لمنصة EO-Dashboard.
 * - كل الحسابات بتوقيت Asia/Damascus.
 * - الأسبوع يبدأ السبت وينتهي الخميس (الجمعة عطلة).
 */

const TZ = process.env.APP_TZ || 'Asia/Damascus';

/** أجزاء تاريخ اليوم {y,m,d} حسب توقيت دمشق. */
function todayParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** فهرس يوم (عدد الأيام منذ حقبة UTC) لإجراء حساب فروقات آمن. */
function dayIndex({ y, m, d }) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** يوم الأسبوع: 0=الأحد .. 6=السبت. */
function weekday({ y, m, d }) {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * تحليل نص «الموعد / الدورية».
 * يدعم: DD/M/YYYY و DD-M-YYYY و DD/M (السنة الحالية).
 * يُعيد: { iso: 'YYYY-MM-DD'|null, recurrence: string|null, raw }
 */
function parseDeadline(rawInput) {
  const raw = (rawInput == null ? '' : String(rawInput)).trim();
  if (!raw) return { iso: null, recurrence: null, raw: '' };

  // كلمات الدورية الشائعة في الملف
  const recurrenceWords = ['يوميا', 'يومياً', 'كل', 'أسبوعي', 'اسبوعي', 'شهري', 'دوري'];
  const looksRecurring = recurrenceWords.some((w) => raw.includes(w));

  // ابحث عن أول نمط تاريخ داخل النص (قد يكون مدفوناً بنص)
  const m = raw.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*(\d{2,4}))?/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    let year = m[3] ? Number(m[3]) : todayParts().y;
    if (year < 100) year += 2000;
    // تحقق منطقي بسيط
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { iso, recurrence: looksRecurring ? raw : null, raw };
    }
  }

  // لا يوجد تاريخ صريح → إمّا دورية أو نص غير محدد
  return { iso: null, recurrence: looksRecurring ? raw : (raw || null), raw };
}

/** تحويل ISO إلى أجزاء. */
function isoToParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/**
 * تصنيف مهمة زمنياً بالنسبة لليوم.
 * يُعيد كائن أعلام جاهزة للفلترة في الواجهة.
 */
function classify(parsed, isDone) {
  const today = todayParts();
  const tIdx = dayIndex(today);

  // حدود الأسبوع الحالي (السبت → الخميس)
  const dow = weekday(today); // 0=أحد..6=سبت
  const offsetFromSaturday = (dow + 1) % 7; // السبت=0
  const weekStartIdx = tIdx - offsetFromSaturday; // السبت
  const weekEndIdx = weekStartIdx + 5; // الخميس (نتجاوز الجمعة)

  const flags = {
    timeBucket: 'undated', // overdue | today | soon | week | future | recurring | undated
    diffDays: null,
    isOverdue: false,
    isToday: false,
    isSoon3: false, // خلال ٣ أيام (لا يشمل اليوم)
    isThisWeek: false,
    isUndated: false,
    isRecurring: false,
    dateIso: parsed.iso,
  };

  if (!parsed.iso) {
    if (parsed.recurrence) {
      flags.timeBucket = 'recurring';
      flags.isRecurring = true;
    } else {
      flags.timeBucket = 'undated';
      flags.isUndated = true;
    }
    return flags;
  }

  const dIdx = dayIndex(isoToParts(parsed.iso));
  const diff = dIdx - tIdx;
  flags.diffDays = diff;

  if (diff < 0) {
    if (!isDone) flags.isOverdue = true;
    flags.timeBucket = isDone ? 'past' : 'overdue';
  } else if (diff === 0) {
    flags.isToday = true;
    flags.timeBucket = 'today';
  } else if (diff <= 3) {
    flags.isSoon3 = true;
    flags.timeBucket = 'soon';
  } else {
    flags.timeBucket = 'future';
  }

  // ضمن هذا الأسبوع (سبت→خميس)؟
  if (dIdx >= weekStartIdx && dIdx <= weekEndIdx) {
    flags.isThisWeek = true;
  }

  return flags;
}

module.exports = { TZ, todayParts, parseDeadline, classify, dayIndex };
