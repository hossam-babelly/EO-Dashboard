/**
 * ─────────────────────────────────────────────────────────────
 *  نموذج طرح دراسة مشروع — Backend Server v2
 *  Express · docx · ExcelJS · Nodemailer
 * ─────────────────────────────────────────────────────────────
 */

const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const nodemailer = require('nodemailer');
const ExcelJS    = require('exceljs');
const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  AlignmentType, WidthType,
  HeadingLevel, ShadingType
} = require('docx');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Directories ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ──────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36).toUpperCase() + '-' +
         crypto.randomBytes(3).toString('hex').toUpperCase();
}
function loadIndex() {
  const p = path.join(DATA_DIR, 'index.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}
function saveIndex(index) {
  fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
}
const MONTHS = ['شهر 1','شهر 2','شهر 3','شهر 4','شهر 5','شهر 6',
                'شهر 7','شهر 8','شهر 9','شهر 10','شهر 11','شهر 12'];

// ════════════════════════════════════════════════════════════
//  EXCEL GENERATOR
// ════════════════════════════════════════════════════════════
async function generateExcel(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نموذج دراسة مشروع';
  wb.created = new Date();

  const C_HEADER = '1A3A5C';
  const C_ACCENT = 'C8A84B';
  const C_SUBTOT = 'EAF0F8';
  const C_TOTAL  = 'D1DBE8';

  function hStyle(bg) {
    return {
      font:      { bold:true, color:{argb:'FFFFFFFF'}, name:'Arial', size:11 },
      fill:      { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+bg} },
      alignment: { horizontal:'center', vertical:'middle', wrapText:true, readingOrder:2 },
      border:    { top:{style:'thin'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} }
    };
  }
  function tStyle(bg) {
    return {
      font:      { bold:true, name:'Arial', size:11 },
      fill:      { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+bg} },
      alignment: { horizontal:'right', vertical:'middle', readingOrder:2 },
      border:    { top:{style:'medium'}, bottom:{style:'thin'}, left:{style:'thin'}, right:{style:'thin'} }
    };
  }
  function dStyle() {
    return {
      font:      { name:'Arial', size:10 },
      alignment: { horizontal:'center', vertical:'middle', readingOrder:2 },
      border:    { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:'hair'}, right:{style:'hair'} }
    };
  }

  // ── Sheet 1: الملخص ─────────────────────────────────────
  const s0 = wb.addWorksheet('الملخص', { rightToLeft:true });
  s0.columns = [{ width:38 }, { width:28 }];
  s0.mergeCells('A1:B1');
  Object.assign(s0.getCell('A1'), {
    value: 'ملخص معلومات المشروع',
    font:  { bold:true, size:16, color:{argb:'FFFFFFFF'}, name:'Arial' },
    fill:  { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C_HEADER} },
    alignment: { horizontal:'center', vertical:'middle', readingOrder:2 }
  });
  s0.getRow(1).height = 30;

  s0.mergeCells('A2:B2');
  Object.assign(s0.getCell('A2'), {
    value: 'قسم المشاريع التنموية',
    font:  { bold:true, size:12, color:{argb:'FF'+C_HEADER}, name:'Arial' },
    fill:  { type:'pattern', pattern:'solid', fgColor:{argb:'FF'+C_ACCENT} },
    alignment: { horizontal:'center', readingOrder:2 }
  });

  [
    ['فكرة المشروع', data.projectIdea||''],
    ['إجمالي التكاليف التأسيسية', data.summary?.foundingTotal||'$0'],
    ['إجمالي الإيرادات المتوقعة (سنوياً)', data.summary?.revenueAnnual||'$0'],
    ['إجمالي التكاليف التشغيلية (سنوياً)', data.summary?.opsAnnual||'$0'],
    ['إجمالي التكاليف الثابتة (سنوياً)', data.summary?.fixedAnnual||'$0'],
    ['الاهتلاك (سنوياً)', data.summary?.depreciation||'$0'],
    ['الربح الصافي (سنوياً)', data.summary?.netProfit||'$0'],
    ['عدد الموظفين', data.summary?.employees||'0'],
  ].forEach(([label, val], i) => {
    const r = s0.getRow(i+3);
    r.height = 22;
    r.getCell(1).value = label;
    r.getCell(1).font  = { bold:true, name:'Arial', size:10 };
    r.getCell(1).alignment = { readingOrder:2 };
    r.getCell(2).value = String(val);
    r.getCell(2).alignment = { horizontal:'center', readingOrder:2 };
    r.getCell(2).font  = { name:'Arial', size:10 };
    [1,2].forEach(c => {
      r.getCell(c).border = { top:{style:'hair'}, bottom:{style:'hair'}, left:{style:'hair'}, right:{style:'hair'} };
    });
  });

  // ── Sheet 2: التكاليف التأسيسية ────────────────────────
  if (data.foundingRows?.length) {
    const s1 = wb.addWorksheet('التكاليف التأسيسية', { rightToLeft:true });
    s1.columns = [
      {width:6},{width:16},{width:24},{width:10},{width:8},{width:20},{width:20},{width:20}
    ];
    const hr = s1.getRow(1);
    hr.height = 24;
    ['#','الصنف','البيان','اهتلاك','العدد','ملاحظات','التكلفة للواحدة ($)','التكلفة الإجمالية ($)']
      .forEach((h,i) => { hr.getCell(i+1).value=h; Object.assign(hr.getCell(i+1), hStyle(C_HEADER)); });

    let tot = 0;
    data.foundingRows.forEach((r,i) => {
      const v = parseFloat(String(r.total||'0').replace(/[^0-9.]/g,''))||0;
      tot += v;
      const row = s1.getRow(i+2);
      row.height = 20;
      [r ? i+1 : '', r.cat, r.bayan, r.dep?'✓':'', r.qty, r.notes, parseFloat(r.price)||0, v]
        .forEach((val,c) => {
          row.getCell(c+1).value = val;
          Object.assign(row.getCell(c+1), dStyle());
          if(c===6||c===7) row.getCell(c+1).numFmt='"$"#,##0.00';
        });
    });
    const n = data.foundingRows.length;
    s1.mergeCells(`A${n+2}:G${n+2}`);
    s1.getCell(`A${n+2}`).value = 'الإجمالي';
    Object.assign(s1.getCell(`A${n+2}`), tStyle(C_TOTAL));
    s1.getCell(`H${n+2}`).value = tot;
    s1.getCell(`H${n+2}`).numFmt = '"$"#,##0.00';
    Object.assign(s1.getCell(`H${n+2}`), tStyle(C_TOTAL));
  }

  // ── Sheet 3: الإيرادات ────────────────────────────────
  const pids = Object.keys(data.products||{}).filter(p=>data.products[p]?.name);
  if (pids.length) {
    const s2 = wb.addWorksheet('الإيرادات المتوقعة', { rightToLeft:true });
    s2.columns = [{width:28},{width:10},...MONTHS.map(()=>({width:12}))];
    const hr = s2.getRow(1); hr.height=24;
    ['البيان','الواحدة',...MONTHS].forEach((h,i) => { hr.getCell(i+1).value=h; Object.assign(hr.getCell(i+1), hStyle(C_HEADER)); });

    let rowIdx = 2;
    pids.forEach(pid => {
      const p = data.products[pid];
      const rev = data.revenueData?.[pid]||[];
      const qr = s2.getRow(rowIdx++);
      qr.getCell(1).value = p.name+' — الكمية';
      qr.getCell(1).font = {bold:true,name:'Arial',size:10};
      qr.getCell(2).value = p.unit||'';
      rev.forEach((m,i) => { qr.getCell(i+3).value=parseFloat(m.qty)||0; Object.assign(qr.getCell(i+3),dStyle()); });

      const ur = s2.getRow(rowIdx++);
      ur.getCell(1).value = p.name+' — سعر الوحدة';
      ur.getCell(2).value = '$';
      rev.forEach((m,i) => { ur.getCell(i+3).value=parseFloat(m.unitPrice)||0; ur.getCell(i+3).numFmt='"$"#,##0.00'; Object.assign(ur.getCell(i+3),dStyle()); });

      const tr = s2.getRow(rowIdx++);
      tr.getCell(1).value = p.name+' — إجمالي المبيعات';
      tr.getCell(1).font = {bold:true,name:'Arial',size:10};
      rev.forEach((m,i) => {
        const v = parseFloat(String(m.total||'0').replace(/[^0-9.]/g,''))||0;
        tr.getCell(i+3).value=v; tr.getCell(i+3).numFmt='"$"#,##0.00';
        Object.assign(tr.getCell(i+3),dStyle());
        tr.getCell(i+3).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+C_SUBTOT}};
      });
    });
  }

  // ── Sheet 4: التكاليف الثابتة ─────────────────────────
  if (data.fixedRows?.length) {
    const s4 = wb.addWorksheet('التكاليف الثابتة', { rightToLeft:true });
    s4.columns = [{width:6},{width:16},{width:24},{width:8},{width:20},{width:22},{width:22}];
    const hr = s4.getRow(1); hr.height=24;
    ['#','الصنف','البيان','العدد','ملاحظات','التكلفة الشهرية للواحدة ($)','التكلفة الشهرية الإجمالية ($)']
      .forEach((h,i) => { hr.getCell(i+1).value=h; Object.assign(hr.getCell(i+1), hStyle(C_HEADER)); });

    let tot=0;
    data.fixedRows.forEach((r,i) => {
      const v = parseFloat(String(r.total||'0').replace(/[^0-9.]/g,''))||0;
      tot+=v;
      const row = s4.getRow(i+2); row.height=20;
      [i+1, r.cat, r.bayan, r.qty, r.notes, parseFloat(r.price)||0, v]
        .forEach((val,c) => {
          row.getCell(c+1).value=val; Object.assign(row.getCell(c+1),dStyle());
          if(c===5||c===6) row.getCell(c+1).numFmt='"$"#,##0.00';
        });
    });
    const n = data.fixedRows.length;
    s4.mergeCells(`A${n+2}:F${n+2}`);
    s4.getCell(`A${n+2}`).value='الإجمالي الشهري'; Object.assign(s4.getCell(`A${n+2}`),tStyle(C_TOTAL));
    s4.getCell(`G${n+2}`).value=tot; s4.getCell(`G${n+2}`).numFmt='"$"#,##0.00'; Object.assign(s4.getCell(`G${n+2}`),tStyle(C_TOTAL));
  }

  // ── Sheet 5: الموارد البشرية ──────────────────────────
  if (data.hrRows?.length) {
    const s5 = wb.addWorksheet('الموارد البشرية', { rightToLeft:true });
    s5.columns = [{width:6},{width:20},{width:16},{width:8},{width:20},{width:22},{width:22}];
    const hr = s5.getRow(1); hr.height=24;
    ['#','المنصب','النوع','العدد','تابع لـ','الراتب الشهري الفردي ($)','الراتب الشهري الإجمالي ($)']
      .forEach((h,i) => { hr.getCell(i+1).value=h; Object.assign(hr.getCell(i+1), hStyle(C_HEADER)); });

    let tot=0;
    data.hrRows.forEach((r,i) => {
      const v = parseFloat(String(r.total||'0').replace(/[^0-9.]/g,''))||0;
      tot+=v;
      const row = s5.getRow(i+2); row.height=20;
      [i+1, r.position, r.type, r.qty, r.reports, parseFloat(r.salary)||0, v]
        .forEach((val,c) => {
          row.getCell(c+1).value=val; Object.assign(row.getCell(c+1),dStyle());
          if(c===5||c===6) row.getCell(c+1).numFmt='"$"#,##0.00';
        });
    });
    const n = data.hrRows.length;
    s5.mergeCells(`A${n+2}:F${n+2}`);
    s5.getCell(`A${n+2}`).value='إجمالي الرواتب'; Object.assign(s5.getCell(`A${n+2}`),tStyle(C_TOTAL));
    s5.getCell(`G${n+2}`).value=tot; s5.getCell(`G${n+2}`).numFmt='"$"#,##0.00'; Object.assign(s5.getCell(`G${n+2}`),tStyle(C_TOTAL));
  }

  return wb.xlsx.writeBuffer();
}

// ════════════════════════════════════════════════════════════
//  WORD GENERATOR
// ════════════════════════════════════════════════════════════
function makeRow(cells, isHeader=false) {
  return new TableRow({
    tableHeader: isHeader,
    children: cells.map(text => new TableCell({
      shading: isHeader ? { type:ShadingType.SOLID, color:'1A3A5C', fill:'1A3A5C' } : undefined,
      margins: { top:60, bottom:60, left:80, right:80 },
      children: [new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text:String(text??''), bold:isHeader, size:isHeader?22:20, font:'Arial', color:isHeader?'FFFFFF':undefined })],
      })],
    })),
  });
}

function sectionTitle(title) {
  return new Paragraph({
    bidirectional: true,
    heading: HeadingLevel.HEADING_2,
    spacing: { before:300, after:150 },
    children: [new TextRun({ text:title, bold:true, size:26, font:'Arial', color:'1A3A5C' })],
  });
}

async function generateWord(data) {
  const pids = Object.keys(data.products||{}).filter(p=>data.products[p]?.name);
  const ch = [];

  // عنوان
  ch.push(new Paragraph({
    bidirectional:true, alignment:AlignmentType.CENTER, spacing:{after:100},
    children:[new TextRun({text:'نموذج طرح دراسة مشروع',bold:true,size:40,font:'Arial',color:'1A3A5C'})],
  }));
  ch.push(new Paragraph({
    bidirectional:true, alignment:AlignmentType.CENTER, spacing:{after:400},
    children:[new TextRun({text:'قسم المشاريع التنموية',size:24,font:'Arial',color:'888888'})],
  }));

  // الملخص
  ch.push(sectionTitle('ملخص معلومات المشروع'));
  ch.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, bidirectional:true,
    rows:[
      makeRow(['البند','القيمة'],true),
      makeRow(['فكرة المشروع', data.projectIdea||'']),
      makeRow(['التكاليف التأسيسية', data.summary?.foundingTotal||'$0']),
      makeRow(['الإيرادات السنوية', data.summary?.revenueAnnual||'$0']),
      makeRow(['التكاليف التشغيلية السنوية', data.summary?.opsAnnual||'$0']),
      makeRow(['التكاليف الثابتة السنوية', data.summary?.fixedAnnual||'$0']),
      makeRow(['الاهتلاك السنوي', data.summary?.depreciation||'$0']),
      makeRow(['الربح الصافي السنوي', data.summary?.netProfit||'$0']),
      makeRow(['عدد الموظفين', data.summary?.employees||'0']),
    ],
  }));

  // التكاليف التأسيسية
  if (data.foundingRows?.length) {
    ch.push(new Paragraph({children:[],spacing:{before:300}}));
    ch.push(sectionTitle('التكاليف التأسيسية'));
    ch.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, bidirectional:true,
      rows:[
        makeRow(['#','الصنف','البيان','اهتلاك','العدد','التكلفة للواحدة','الإجمالي'],true),
        ...data.foundingRows.map((r,i)=>makeRow([i+1,r.cat,r.bayan,r.dep?'✓':'',r.qty,r.price,r.total])),
      ],
    }));
  }

  // التكاليف الثابتة
  if (data.fixedRows?.length) {
    ch.push(new Paragraph({children:[],spacing:{before:300}}));
    ch.push(sectionTitle('التكاليف الثابتة (الشهرية)'));
    ch.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, bidirectional:true,
      rows:[
        makeRow(['#','الصنف','البيان','العدد','ت. الشهرية للواحدة','الإجمالي الشهري'],true),
        ...data.fixedRows.map((r,i)=>makeRow([i+1,r.cat,r.bayan,r.qty,r.price,r.total])),
      ],
    }));
  }

  // الموارد البشرية
  if (data.hrRows?.length) {
    ch.push(new Paragraph({children:[],spacing:{before:300}}));
    ch.push(sectionTitle('الموارد البشرية'));
    ch.push(new Table({ width:{size:100,type:WidthType.PERCENTAGE}, bidirectional:true,
      rows:[
        makeRow(['#','المنصب','النوع','العدد','تابع لـ','الراتب الفردي','الإجمالي'],true),
        ...data.hrRows.map((r,i)=>makeRow([i+1,r.position,r.type,r.qty,r.reports,r.salary,r.total])),
      ],
    }));
  }

  // المنتجات
  if (pids.length) {
    ch.push(new Paragraph({children:[],spacing:{before:300}}));
    ch.push(sectionTitle('المنتجات ومكوناتها'));
    pids.forEach(pid => {
      const p = data.products[pid];
      ch.push(new Paragraph({
        bidirectional:true, spacing:{before:160,after:60},
        children:[new TextRun({text:`${p.name}  (${p.unit})`,bold:true,size:22,font:'Arial'})],
      }));
      (p.components||[]).filter(c=>c).forEach(c => {
        ch.push(new Paragraph({
          bidirectional:true,
          children:[new TextRun({text:`    •  ${c}`,size:20,font:'Arial'})],
        }));
      });
    });
  }

  ch.push(new Paragraph({children:[],spacing:{before:400}}));
  ch.push(new Paragraph({
    bidirectional:true,
    children:[new TextRun({text:`تاريخ الإرسال: ${new Date(data.submittedAt||Date.now()).toLocaleString('ar-SA')}`,size:18,font:'Arial',color:'999999'})],
  }));

  const doc = new Document({
    sections:[{ properties:{ page:{ size:{width:11906,height:16838}, margin:{top:1440,right:1440,bottom:1440,left:1440} } }, children:ch }],
  });
  return Packer.toBuffer(doc);
}

// ════════════════════════════════════════════════════════════
//  EMAIL SENDER
// ════════════════════════════════════════════════════════════
async function sendEmail(data, id, excelBuf, wordBuf) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('⚠️  متغيرات الإيميل غير مضبوطة — تخطي الإرسال');
    return;
  }
  const transporter = nodemailer.createTransport({
    service:'gmail',
    auth:{ user:process.env.EMAIL_USER, pass:process.env.EMAIL_PASS },
  });
  const to = process.env.RECEIVER_EMAIL || process.env.EMAIL_USER;
  await transporter.sendMail({
    from:    `"نظام دراسة المشاريع" <${process.env.EMAIL_USER}>`,
    to,
    subject: `📋 مشروع جديد — ${(data.projectIdea||'').substring(0,50)}`,
    html: `
<div dir="rtl" style="font-family:Arial;max-width:620px;margin:auto;border:1px solid #ddd;border-radius:12px;overflow:hidden">
  <div style="background:#1a3a5c;color:white;padding:20px 24px">
    <h2 style="margin:0;font-size:18px">📋 نموذج طرح دراسة مشروع جديد</h2>
    <p style="margin:6px 0 0;opacity:.75;font-size:13px">رقم الطلب: ${id}</p>
  </div>
  <div style="padding:20px 24px">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#eaf0f8"><td style="padding:10px;font-weight:bold">فكرة المشروع</td><td style="padding:10px">${data.projectIdea||''}</td></tr>
      <tr><td style="padding:10px;font-weight:bold">التكاليف التأسيسية</td><td style="padding:10px">${data.summary?.foundingTotal||'$0'}</td></tr>
      <tr style="background:#eaf0f8"><td style="padding:10px;font-weight:bold">الإيرادات السنوية</td><td style="padding:10px">${data.summary?.revenueAnnual||'$0'}</td></tr>
      <tr><td style="padding:10px;font-weight:bold">التكاليف التشغيلية السنوية</td><td style="padding:10px">${data.summary?.opsAnnual||'$0'}</td></tr>
      <tr style="background:#eaf0f8"><td style="padding:10px;font-weight:bold">التكاليف الثابتة السنوية</td><td style="padding:10px">${data.summary?.fixedAnnual||'$0'}</td></tr>
      <tr><td style="padding:10px;font-weight:bold">الاهتلاك السنوي</td><td style="padding:10px">${data.summary?.depreciation||'$0'}</td></tr>
      <tr style="background:#1a3a5c;color:white"><td style="padding:10px;font-weight:bold">الربح الصافي السنوي</td><td style="padding:10px;font-weight:bold">${data.summary?.netProfit||'$0'}</td></tr>
      <tr><td style="padding:10px;font-weight:bold">عدد الموظفين</td><td style="padding:10px">${data.summary?.employees||'0'}</td></tr>
    </table>
  </div>
  <div style="background:#f5f7fa;padding:12px 24px;font-size:11px;color:#888;border-top:1px solid #eee">
    تاريخ الإرسال: ${new Date().toLocaleString('ar-SA')} | مرفق: ملف Excel + ملف Word
  </div>
</div>`,
    attachments:[
      { filename:`مشروع_${id}.xlsx`, content:excelBuf, contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { filename:`مشروع_${id}.docx`, content:wordBuf,  contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    ],
  });
  console.log(`📧 إيميل أُرسل: ${id} → ${to}`);
}

// ════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════
app.post('/api/submit', async (req, res) => {
  try {
    const body = req.body;
    if (!body?.projectIdea) return res.status(400).json({ success:false, message:'فكرة المشروع مطلوبة' });

    const id = genId();
    const submission = { id, submittedAt: body.submittedAt||new Date().toISOString(), ...body };
    fs.writeFileSync(path.join(DATA_DIR,`${id}.json`), JSON.stringify(submission,null,2), 'utf8');
    const index = loadIndex();
    index.unshift({ id, projectIdea:body.projectIdea.substring(0,80), submittedAt:submission.submittedAt, summary:body.summary||{} });
    saveIndex(index);

    const [excelBuf, wordBuf] = await Promise.all([generateExcel(body), generateWord(body)]);
    fs.writeFileSync(path.join(DATA_DIR,`${id}.xlsx`), excelBuf);
    fs.writeFileSync(path.join(DATA_DIR,`${id}.docx`), wordBuf);

    await sendEmail(body, id, excelBuf, wordBuf).catch(e => console.error('Email error:', e.message));

    console.log(`✅ طلب جديد: ${id}`);
    return res.json({ success:true, id });
  } catch(err) {
    console.error('❌', err);
    return res.status(500).json({ success:false, message:err.message });
  }
});

app.get('/api/submissions', (req, res) => res.json({ success:true, submissions:loadIndex() }));

app.get('/api/submissions/:id', (req, res) => {
  const sid = req.params.id.replace(/[^A-Z0-9\-]/g,'');
  const fp = path.join(DATA_DIR,`${sid}.json`);
  if (!fs.existsSync(fp)) return res.status(404).json({ success:false });
  res.json({ success:true, submission:JSON.parse(fs.readFileSync(fp,'utf8')) });
});

app.get('/api/download/:id/excel', (req, res) => {
  const sid = req.params.id.replace(/[^A-Z0-9\-]/g,'');
  const fp = path.join(DATA_DIR,`${sid}.xlsx`);
  if (!fs.existsSync(fp)) return res.status(404).send('غير موجود');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="project_${sid}.xlsx"`);
  res.send(fs.readFileSync(fp));
});

app.get('/api/download/:id/word', (req, res) => {
  const sid = req.params.id.replace(/[^A-Z0-9\-]/g,'');
  const fp = path.join(DATA_DIR,`${sid}.docx`);
  if (!fs.existsSync(fp)) return res.status(404).send('غير موجود');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition',`attachment; filename="project_${sid}.docx"`);
  res.send(fs.readFileSync(fp));
});

app.delete('/api/submissions/:id', (req, res) => {
  const sid = req.params.id.replace(/[^A-Z0-9\-]/g,'');
  ['json','xlsx','docx'].forEach(ext => {
    const fp = path.join(DATA_DIR,`${sid}.${ext}`);
    if(fs.existsSync(fp)) fs.unlinkSync(fp);
  });
  saveIndex(loadIndex().filter(s=>s.id!==sid));
  res.json({ success:true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, () => console.log(`🚀 يعمل على المنفذ ${PORT}`));
module.exports = app;
