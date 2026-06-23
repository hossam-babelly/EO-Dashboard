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
  const recurrenceWords = ['يوميا', 'يومياً', 'يومي', 'كل ', 'أسبوعي', 'اسبوعي', 'أسبوعياً', 'شهري', 'شهرياً', 'سنوي', 'دوري', 'دورية'];
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

  // لا يوجد تاريخ صريح → دورية فقط إن وُجدت كلمة دورية، وإلا فهي «بلا موعد»
  return { iso: null, recurrence: looksRecurring ? raw : null, raw };
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
      applyRecurrenceOccurrence(parsed.recurrence, weekday(today), flags);
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

// أسماء أيام الأسبوع (بصيغة مجرّدة تطابق مع/بدون «ال») → رقم اليوم (0=الأحد .. 6=السبت)
const WEEKDAY_NAMES = {
  'أحد': 0, 'احد': 0, 'إثنين': 1, 'اثنين': 1, 'ثلاثاء': 2,
  'أربعاء': 3, 'اربعاء': 3, 'خميس': 4, 'جمعة': 5, 'سبت': 6,
};

/** تحليل نمط الدورية من النص. */
function recurrenceInfo(text) {
  const t = String(text || '');
  if (/يوميا|يومياً|يومي/.test(t)) return { kind: 'daily' };
  for (const [name, dow] of Object.entries(WEEKDAY_NAMES)) {
    if (t.includes(name)) return { kind: 'weekday', dow };
  }
  if (/أسبوعي|اسبوعي|أسبوعياً/.test(t)) return { kind: 'weekly' };
  if (/شهري|شهرياً/.test(t)) return { kind: 'monthly' };
  return { kind: 'other' };
}

/**
 * تحديد ظهور المهمة الدورية ضمن فلاتر اليوم/٣ أيام/هذا الأسبوع.
 * dowToday: يوم اليوم (0=الأحد..6=السبت).
 */
function applyRecurrenceOccurrence(recurrenceText, dowToday, flags) {
  const info = recurrenceInfo(recurrenceText);
  flags.recurrenceKind = info.kind;
  if (info.kind === 'daily') {
    flags.isToday = true; flags.isSoon3 = true; flags.isThisWeek = true;
  } else if (info.kind === 'weekday') {
    flags.isToday = info.dow === dowToday;
    for (let k = 1; k <= 3; k++) { if (((dowToday + k) % 7) === info.dow) { flags.isSoon3 = true; break; } }
    if (info.dow !== 5) flags.isThisWeek = true; // كل يوم عدا الجمعة يقع ضمن أسبوع السبت→الخميس
  } else if (info.kind === 'weekly') {
    flags.isThisWeek = true;
  }
  // شهري/أخرى: تبقى دورية فقط دون أعلام يومية
}

module.exports = { TZ, todayParts, parseDeadline, classify, dayIndex, recurrenceInfo };
