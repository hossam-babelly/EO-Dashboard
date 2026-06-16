'use strict';
/* توليد تقارير (Word / Excel / PDF) للمهام المعروضة حالياً — بهوية سنكري وشعارها.
   يعتمد على المتغيّرات/الدوال العامة من app.js: state, applyFilters, sortList, esc, parseFollowup, fuShort, TIME_CHIPS, toast */

const RB = { ink: '#211d1a', copper: '#bd6a43', copperDeep: '#a4572f', champagne: '#d8c4b0', cream: '#f7f2ea', line: '#e7ddcf', red: '#b4453c', green: '#5f7457', amber: '#c0822f', muted: '#8a8175' };

const REPORT_COLS = [
  { k: 'i', label: '#', w: 5 },
  { k: 'project', label: 'المشروع', w: 16 },
  { k: 'file', label: 'الملف', w: 14 },
  { k: 'type', label: 'النوع', w: 12 },
  { k: 'owner', label: 'المسؤول', w: 16 },
  { k: 'deliverable', label: 'المخرج المطلوب', w: 30 },
  { k: 'deadline', label: 'الموعد', w: 12 },
  { k: 'priority', label: 'الأولوية', w: 10 },
  { k: 'status', label: 'الحالة', w: 12 },
  { k: 'followup', label: 'آخر متابعة', w: 26 },
];

function reportTasks() { return sortList(applyFilters()); }

function reportRow(t, i) {
  const evs = parseFollowup(t.followup, t.log);
  const last = evs.length ? evs[evs.length - 1] : null;
  const fu = last ? ((last.manual ? '' : (last.author + ' · ' + fuShort(last.date, last.time) + ' — ')) + (last.text || '')) : '';
  return {
    i: i + 1,
    project: t.project || '',
    file: t.file || '',
    type: t.type || '—',
    owner: (t.owner || '').replace(/\n+/g, '، '),
    deliverable: t.deliverable || '',
    deadline: t.deadlineIso || t.deadlineRaw || '—',
    priority: t.priority || '',
    status: t.status || '',
    followup: fu,
  };
}

function reportFiltersText() {
  const f = [];
  if (state.time && state.time !== 'all') { const c = TIME_CHIPS.find((x) => x.key === state.time); if (c) f.push('النطاق: ' + c.label); }
  if (state.projects.length) f.push('المشاريع: ' + state.projects.join('، '));
  if (state.owners.length) f.push('المسؤولون: ' + state.owners.join('، '));
  if (state.types.length) f.push('الأنواع: ' + state.types.map((x) => x === '__none__' ? 'بلا نوع' : x).join('، '));
  if (state.priorities.length) f.push('الأولويات: ' + state.priorities.join('، '));
  if (state.statuses.length) f.push('الحالات: ' + state.statuses.join('، '));
  if (state.search) f.push('بحث: «' + state.search + '»');
  return f.length ? f.join('  •  ') : 'كل المهام (بلا فلاتر)';
}

function nowText() {
  try { return new Date().toLocaleString('ar-SY-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }); }
  catch { return new Date().toISOString().slice(0, 16).replace('T', ' '); }
}

let _logoData = null;
async function logoDataUrl() {
  if (_logoData) return _logoData;
  try {
    const blob = await (await fetch('/assets/logo-horizontal.png')).blob();
    _logoData = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  } catch { _logoData = ''; }
  return _logoData;
}

function dl(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function priColor(p) { return p === 'حرجة' ? RB.red : p === 'عالية' ? RB.amber : RB.copperDeep; }
function stColor(s) { return s === 'منجزة' ? RB.green : s === 'متوقفة' ? RB.red : s === 'قيد التنفيذ' ? RB.copperDeep : RB.muted; }

// الأعمدة المختارة من النافذة (الكل افتراضياً)
function activeCols() {
  const checked = [...document.querySelectorAll('#reportCols input:checked')].map((i) => i.value);
  return checked.length ? REPORT_COLS.filter((c) => checked.includes(c.k)) : REPORT_COLS.slice();
}

// ===== HTML للتقرير (يُستخدم لـ PDF و Word) =====
async function reportHTML() {
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const logo = await logoDataUrl();
  const th = COLS.map((c) => `<th style="background:${RB.ink};color:${RB.champagne};padding:8px 6px;font-size:12px;border:1px solid ${RB.copperDeep};text-align:right;white-space:nowrap">${esc(c.label)}</th>`).join('');
  const trs = rows.map((r, idx) => `<tr style="background:${idx % 2 ? '#faf5ee' : '#ffffff'}">${COLS.map((c) => {
    let v = esc(String(r[c.k]));
    let style = `padding:7px 6px;font-size:11.5px;border:1px solid ${RB.line};vertical-align:top;text-align:right`;
    if (c.k === 'priority') v = `<span style="color:${priColor(r.priority)};font-weight:700">${v}</span>`;
    if (c.k === 'status') v = `<span style="color:${stColor(r.status)};font-weight:700">${v}</span>`;
    if (c.k === 'i') style += ';text-align:center;color:' + RB.muted;
    return `<td style="${style}">${v}</td>`;
  }).join('')}</tr>`).join('');

  return `<div dir="rtl" style="font-family:'Cairo',Arial,sans-serif;color:${RB.ink};background:#fff;width:100%;padding:0;box-sizing:border-box">
    <div style="background:${RB.ink};padding:18px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid ${RB.copper}">
      <div>
        <div style="font-size:22px;font-weight:800;color:#fff">تقرير المهام — المكتب التنفيذي</div>
        <div style="font-size:13px;color:${RB.champagne};margin-top:3px">مجموعة سنكري القابضة</div>
      </div>
      ${logo ? `<img src="${logo}" style="height:46px">` : ''}
    </div>
    <div style="padding:14px 24px;background:${RB.cream};border-bottom:1px solid ${RB.line};font-size:12.5px;color:${RB.copperDeep}">
      <div><b>تاريخ التقرير:</b> ${esc(nowText())}</div>
      <div style="margin-top:5px"><b>عدد المهام:</b> ${rows.length}</div>
    </div>
    <div style="padding:18px 24px">
      <table style="width:100%;border-collapse:collapse;border:1px solid ${RB.copperDeep}">
        <thead><tr>${th}</tr></thead><tbody>${trs || `<tr><td colspan="${COLS.length}" style="padding:20px;text-align:center;color:${RB.muted}">لا توجد مهام مطابقة.</td></tr>`}</tbody>
      </table>
      <div style="margin-top:14px;font-size:11px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — المكتب التنفيذي · تقرير مُولَّد آلياً</div>
    </div>
  </div>`;
}

async function exportPDF() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;left:-11000px;top:0;width:1080px';
  wrap.innerHTML = await reportHTML();
  document.body.appendChild(wrap);
  try {
    await html2pdf().set({
      margin: [6, 6], filename: 'تقرير-المهام.pdf',
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(wrap.firstElementChild).save();
  } finally { wrap.remove(); }
}

async function exportWord() {
  const html = await reportHTML();
  const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>تقرير المهام</title>`
    + `<style>@page Section1 { size: 841.95pt 595.35pt; mso-page-orientation: landscape; margin: 1.2cm; } div.Section1 { page: Section1; } body { margin: 0; font-family: 'Cairo', Arial, sans-serif; }</style>`
    + `</head><body dir='rtl'><div class='Section1'>${html}</div></body></html>`;
  dl(new Blob(['﻿', doc], { type: 'application/msword' }), 'تقرير-المهام.doc');
}

async function exportExcel() {
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المهام', { views: [{ rightToLeft: true, showGridLines: false }] });
  ws.columns = COLS.map((c) => ({ key: c.k, width: c.w }));
  const last = COLS.length;
  const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const L = colLetter(last);

  // ترويسة + شعار
  ws.mergeCells(`A1:${L}1`); ws.mergeCells(`A2:${L}2`); ws.mergeCells(`A3:${L}3`); ws.mergeCells(`A4:${L}4`);
  const titleCell = ws.getCell('A1');
  titleCell.value = 'تقرير المهام — المكتب التنفيذي | مجموعة سنكري القابضة';
  titleCell.font = { name: 'Cairo', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
  ['A1', 'A2', 'A3', 'A4'].forEach((a) => { ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF211D1A' } }; });
  ws.getRow(1).height = 34;
  const meta1 = ws.getCell('A2'); meta1.value = 'تاريخ التقرير: ' + nowText() + '   •   عدد المهام: ' + rows.length;
  meta1.font = { name: 'Cairo', size: 10, color: { argb: 'FFD8C4B0' } }; meta1.alignment = { horizontal: 'right', indent: 1 };
  ws.getRow(3).height = 6;
  ws.getRow(4).height = 6;

  const dataUrl = await logoDataUrl();
  if (dataUrl) { try { const id = wb.addImage({ base64: dataUrl, extension: 'png' }); ws.addImage(id, { tl: { col: last - 2.0, row: 0.15 }, ext: { width: 150, height: 38 } }); } catch { /* تجاهل */ } }

  // صفّ العناوين
  const hdrRowIdx = 5;
  const hdr = ws.getRow(hdrRowIdx);
  COLS.forEach((c, i) => {
    const cell = hdr.getCell(i + 1);
    cell.value = c.label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBD6A43' } };
    cell.font = { name: 'Cairo', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFA4572F' } } };
  });
  hdr.height = 22;

  // الصفوف
  rows.forEach((r, idx) => {
    const row = ws.getRow(hdrRowIdx + 1 + idx);
    COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.k];
      cell.alignment = { horizontal: c.k === 'i' ? 'center' : 'right', vertical: 'top', wrapText: true };
      cell.font = { name: 'Cairo', size: 10, color: { argb: 'FF2B2823' } };
      if (idx % 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5EE' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE7DDCF' } } };
      if (c.k === 'priority') cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: r.priority === 'حرجة' ? 'FFB4453C' : r.priority === 'عالية' ? 'FFC0822F' : 'FFA4572F' } };
      if (c.k === 'status') cell.font = { name: 'Cairo', size: 10, bold: true, color: { argb: r.status === 'منجزة' ? 'FF5F7457' : r.status === 'متوقفة' ? 'FFB4453C' : 'FF8A8175' } };
    });
  });
  ws.autoFilter = { from: { row: hdrRowIdx, column: 1 }, to: { row: hdrRowIdx, column: last } };

  const buf = await wb.xlsx.writeBuffer();
  dl(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'تقرير-المهام.xlsx');
}

function runExport(btn, fn, label) {
  return async () => {
    const o = btn.textContent; btn.disabled = true; btn.textContent = '... ' + label;
    try { await fn(); toast('تم توليد ' + label + ' ✓'); }
    catch (e) { toast('تعذّر التوليد: ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = o; }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const colsBox = document.getElementById('reportCols');
  if (colsBox) colsBox.innerHTML = REPORT_COLS.map((c) => `<label class="rep-col"><input type="checkbox" value="${c.k}" checked> ${esc(c.label)}</label>`).join('');
  const open = document.getElementById('reportBtn');
  const back = document.getElementById('reportModalBack');
  const close = () => back && back.classList.remove('open');
  if (open && back) open.onclick = () => {
    if (!reportTasks().length) { toast('لا توجد مهام معروضة لتوليد التقرير', true); return; }
    back.classList.add('open');
  };
  const cl = document.getElementById('reportClose'); if (cl) cl.onclick = close;
  if (back) back.onclick = (e) => { if (e.target === back) close(); };
  const pdf = document.getElementById('reportPdf'); if (pdf) pdf.onclick = runExport(pdf, exportPDF, 'PDF');
  const word = document.getElementById('reportWord'); if (word) word.onclick = runExport(word, exportWord, 'Word');
  const excel = document.getElementById('reportExcel'); if (excel) excel.onclick = runExport(excel, exportExcel, 'Excel');
});
