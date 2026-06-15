'use strict';

const { recurrenceInfo } = require('./dates');

// أيام ICS لرقم اليوم (0=الأحد..6=السبت)
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// تحويل رمز التوقيت إلى عدد أيام قبل الموعد
const OFFSET_DAYS = { morning: 0, '1d': 1, '3d': 3, '7d': 7 };

function pad(n) { return String(n).padStart(2, '0'); }
function dateCompact(iso) { return iso.replace(/-/g, ''); }
function nowStamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function esc(s) { return String(s == null ? '' : s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'); }

function todayIsoUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function alarms(offsets, title) {
  return offsets.map((o) => {
    const n = OFFSET_DAYS[o];
    if (n == null) return '';
    const trigger = n === 0 ? '-PT0M' : `-P${n}D`;
    return `BEGIN:VALARM\nACTION:DISPLAY\nDESCRIPTION:${esc('تذكير: ' + title)}\nTRIGGER:${trigger}\nEND:VALARM`;
  }).filter(Boolean).join('\n');
}

function veventForTask(t, offsets) {
  const uid = `eo-task-${t.row}@eo-dashboard`;
  const title = `${t.project || ''}${t.file ? ' — ' + t.file : ''}`.trim() || 'مهمة';
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowStamp()}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc((t.deliverable || '') + (t.owner ? '\nالمسؤول: ' + t.owner : '') + '\nالأولوية: ' + (t.priority || ''))}`,
  ];

  if (t.deadlineIso) {
    lines.push(`DTSTART;VALUE=DATE:${dateCompact(t.deadlineIso)}`);
  } else if (t.isRecurring) {
    const info = recurrenceInfo(t.recurrence || t.deadlineRaw || '');
    const anchor = dateCompact(todayIsoUTC());
    lines.push(`DTSTART;VALUE=DATE:${anchor}`);
    if (info.kind === 'daily') lines.push('RRULE:FREQ=DAILY');
    else if (info.kind === 'weekday') lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[info.dow]}`);
    else if (info.kind === 'weekly') lines.push('RRULE:FREQ=WEEKLY');
    else if (info.kind === 'monthly') lines.push('RRULE:FREQ=MONTHLY');
  } else {
    return ''; // بلا موعد ولا دورية → لا حدث
  }

  const al = alarms(offsets && offsets.length ? offsets : ['morning'], title);
  if (al) lines.push(al);
  lines.push('END:VEVENT');
  return lines.join('\n');
}

/**
 * بناء ملف ICS لمهام المستخدم التي اختار لها طريقة «التقويم».
 * tasksByRow: خريطة رقم الصف → المهمة. userReminders: خريطة رقم الصف → {methods, offsets}.
 */
function buildICS(tasksByRow, userReminders) {
  const events = [];
  for (const [row, pref] of Object.entries(userReminders || {})) {
    if (!pref.methods || !pref.methods.includes('calendar')) continue;
    const t = tasksByRow[row];
    if (!t) continue;
    const ev = veventForTask(t, pref.offsets);
    if (ev) events.push(ev);
  }
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EO-Dashboard//AR//',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:مهام المكتب التنفيذي',
    'X-WR-TIMEZONE:Asia/Damascus',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

module.exports = { buildICS, OFFSET_DAYS };
