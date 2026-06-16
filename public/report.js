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

// ===== بناء التقرير (صفحات بترويسة مكرّرة، مهام كاملة لكل صفحة) =====
// يُصغّر الشعار فعلياً إلى صورة بحجم العرض (حتى يحترم Word حجمه الأصلي الصغير)
let _logo = null;
async function logoSmall(targetH) {
  if (_logo) return _logo;
  const url = await logoDataUrl();
  if (!url) { _logo = { url: '', w: 0, h: 0 }; return _logo; }
  const img = await new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  if (!img || !img.naturalWidth) { _logo = { url, w: targetH * 4, h: targetH }; return _logo; }
  const h = targetH, w = Math.round(h * img.naturalWidth / img.naturalHeight);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  _logo = { url: cv.toDataURL('image/png'), w, h };
  return _logo;
}

function headerBlock(logo, count) {
  const img = logo && logo.url ? `<img src="${logo.url}" width="${logo.w}" height="${logo.h}" style="width:${logo.w}px;height:${logo.h}px">` : '';
  return `<div class="rpt-h" style="background:${RB.ink};padding:14px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid ${RB.copper}">
      <div>
        <div style="font-size:20px;font-weight:800;color:#fff">تقرير المهام</div>
        <div style="font-size:12.5px;color:${RB.champagne};margin-top:3px">المكتب التنفيذي — مجموعة سنكري القابضة</div>
      </div>${img}
    </div>
    <div class="rpt-m" style="padding:9px 24px;background:${RB.cream};border-bottom:1px solid ${RB.line};font-size:12px;color:${RB.copperDeep}">
      <b>تاريخ التقرير:</b> ${esc(nowText())} &nbsp;•&nbsp; <b>عدد المهام:</b> ${count}
    </div>`;
}

function rowHTML(COLS, r, gi) {
  return `<tr style="background:${gi % 2 ? '#faf5ee' : '#ffffff'};page-break-inside:avoid">${COLS.map((c) => {
    let v = esc(String(r[c.k]));
    let style = `padding:7px 6px;font-size:11.5px;border:1px solid ${RB.line};vertical-align:top;text-align:right`;
    if (c.k === 'deliverable' || c.k === 'followup' || c.k === 'owner') style += ';white-space:pre-line';
    if (c.k === 'priority') v = `<span style="color:${priColor(r.priority)};font-weight:700">${v}</span>`;
    if (c.k === 'status') v = `<span style="color:${stColor(r.status)};font-weight:700">${v}</span>`;
    if (c.k === 'i') style += ';text-align:center;color:' + RB.muted;
    return `<td style="${style}">${v}</td>`;
  }).join('')}</tr>`;
}

function tableHTML(COLS, bodyHtml) {
  const totalW = COLS.reduce((s, c) => s + c.w, 0);
  const cg = `<colgroup>${COLS.map((c) => `<col style="width:${(c.w / totalW * 100).toFixed(2)}%">`).join('')}</colgroup>`;
  const th = COLS.map((c) => `<th style="background:${RB.ink};color:${RB.champagne};padding:8px 6px;font-size:12px;border:1px solid ${RB.copperDeep};text-align:right">${esc(c.label)}</th>`).join('');
  return `<table style="width:100%;border-collapse:collapse;border:1px solid ${RB.copperDeep};table-layout:fixed">${cg}<thead><tr>${th}</tr></thead><tbody>${bodyHtml || `<tr><td colspan="${COLS.length}" style="padding:20px;text-align:center;color:${RB.muted}">لا توجد مهام مطابقة.</td></tr>`}</tbody></table>`;
}

function pageHTML(COLS, logo, count, bodyHtml, isFirst) {
  return `<div class="rpt-page" dir="rtl" style="width:100%;background:#fff;box-sizing:border-box;font-family:'Cairo',Arial,sans-serif;color:${RB.ink};${isFirst ? '' : 'page-break-before:always;'}">
    ${headerBlock(logo, count)}
    <div style="padding:12px 24px 4px">${tableHTML(COLS, bodyHtml)}</div>
    <div style="padding:0 24px 10px;font-size:10px;color:${RB.muted};text-align:center">© مجموعة سنكري القابضة — المكتب التنفيذي</div>
  </div>`;
}

// يقيس ارتفاعات الصفوف ويوزّعها على صفحات بحيث لا تُقسَّم مهمة بين صفحتين
async function paginate(rows, COLS, logo) {
  const m = document.createElement('div');
  m.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;visibility:hidden';
  m.innerHTML = pageHTML(COLS, logo, rows.length, rows.map((r, i) => rowHTML(COLS, r, i)).join(''), true);
  document.body.appendChild(m);
  try { await document.fonts.ready; } catch { /* تجاهل */ }
  const page = m.firstElementChild;
  const tableEl = m.querySelector('table');
  const topArea = tableEl.getBoundingClientRect().top - page.getBoundingClientRect().top;
  const theadH = m.querySelector('thead').offsetHeight;
  const hts = [...m.querySelectorAll('tbody tr')].map((tr) => tr.offsetHeight);
  m.remove();
  // ارتفاع صفحة A4 العرضية المطبوعة ≈ 715px عند 96dpi (مع هوامش 1سم) — متحفّظ ليتّسع في PDF و Word
  const PAGE_H = 705, FOOTER = 34;
  const avail = Math.max(120, PAGE_H - topArea - theadH - FOOTER);
  const chunks = []; let cur = [], used = 0;
  for (let i = 0; i < rows.length; i++) {
    const h = hts[i] || 24;
    if (cur.length && used + h > avail) { chunks.push(cur); cur = []; used = 0; }
    cur.push(rows[i]); used += h;
  }
  if (cur.length) chunks.push(cur);
  return chunks.length ? chunks : [[]];
}

// PDF: نرسم كل صفحة كصورة مستقلّة ونضيفها لصفحة PDF — لا قصّ، مهام كاملة، ترويسة مكرّرة
async function exportPDF() {
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const logo = await logoSmall(34);
  const chunks = await paginate(rows, COLS, logo);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pw = pdf.internal.pageSize.getWidth();
  let gi = 0;
  for (let ci = 0; ci < chunks.length; ci++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;background:#fff';
    el.innerHTML = pageHTML(COLS, logo, rows.length, chunks[ci].map((r) => rowHTML(COLS, r, gi++)).join(''), true);
    document.body.appendChild(el);
    try { await document.fonts.ready; } catch { /* تجاهل */ }
    await new Promise((r) => setTimeout(r, 40));
    const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1040 });
    el.remove();
    if (ci > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, canvas.height * pw / canvas.width);
  }
  pdf.save('تقرير-المهام.pdf');
}

// Word: نضع نفس صور صفحات الـ PDF (كل صفحة صورة كاملة) فيصبح مطابقاً للـ PDF بصرياً
async function exportWord() {
  const rows = reportTasks().map(reportRow);
  const COLS = activeCols();
  const logo = await logoSmall(34);
  const chunks = rows.length ? await paginate(rows, COLS, logo) : [[]];
  const DOC_W = 1040; // عرض الصورة في الصفحة (≈ عرض A4 العرضية)
  let gi = 0;
  const imgs = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:-12000px;top:0;width:1040px;background:#fff';
    el.innerHTML = pageHTML(COLS, logo, rows.length, chunks[ci].map((r) => rowHTML(COLS, r, gi++)).join(''), true);
    document.body.appendChild(el);
    try { await document.fonts.ready; } catch { /* تجاهل */ }
    await new Promise((r) => setTimeout(r, 40));
    const canvas = await html2canvas(el.firstElementChild, { scale: 2, useCORS: true, backgroundColor: '#ffffff', windowWidth: 1040 });
    el.remove();
    imgs.push({ src: canvas.toDataURL('image/jpeg', 0.95), h: Math.round(DOC_W * canvas.height / canvas.width) });
  }
  const pagesHtml = imgs.map((im, i) => `<div style="${i > 0 ? 'page-break-before:always;' : ''}"><img src="${im.src}" width="${DOC_W}" height="${im.h}"></div>`).join('');
  const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>تقرير المهام</title>`
    + `<style>@page Section1 { size: 841.95pt 595.35pt; mso-page-orientation: landscape; margin: 0.6cm; } div.Section1 { page: Section1; } body { margin: 0; }</style>`
    + `</head><body><div class='Section1'>${pagesHtml}</div></body></html>`;
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

  const lg = await logoSmall(38);
  if (lg.url) { try { const id = wb.addImage({ base64: lg.url, extension: 'png' }); ws.addImage(id, { tl: { col: last - 2.0, row: 0.15 }, ext: { width: lg.w, height: lg.h } }); } catch { /* تجاهل */ } }

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
