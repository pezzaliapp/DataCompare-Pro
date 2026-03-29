/* ═══════════════════════════════════════════════════════
   DataCompare Pro — app.js
   Bug-fixed rewrite — see changelog in README
═══════════════════════════════════════════════════════ */
'use strict';

// ─── PDF.js worker (must be set before any call) ──────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ─── State ────────────────────────────────────────────────────────────────
const APP = {
  files:          [],   // {uid, name, type, size, data, raw}
  issues:         [],
  filtered:       [],
  activeFilter:   'all',
  catalog:        [],
  quote:          [],
  pdfBuf:         null,
  pdfName:        '',
  extracted:      [],
  nextId:         1     // FIX: integer counter for safe IDs (no floats)
};

// ─── DOM helpers ──────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ─── Navigation ───────────────────────────────────────────────────────────
$$('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.view').forEach(v => v.classList.remove('active'));
    $('view-' + tab.dataset.view).classList.add('active');
    if (tab.dataset.view === 'catalog') renderCatalog();
  });
});

// ─── Compare: drop zone ───────────────────────────────────────────────────
const dropZone  = $('drop-zone');
const fileInput = $('file-input');

dropZone.addEventListener('click', () => fileInput.click());
$('browse-btn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

['dragover','dragenter'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag-over'); })
);
['dragleave','drop'].forEach(ev =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'))
);
dropZone.addEventListener('drop', e => { e.preventDefault(); loadFiles([...e.dataTransfer.files]); });
fileInput.addEventListener('change', () => { loadFiles([...fileInput.files]); fileInput.value = ''; });

// ─── File loading ─────────────────────────────────────────────────────────
async function loadFiles(files) {
  const allowed = files.filter(f => /\.(xlsx|xls|csv|pdf)$/i.test(f.name));
  if (!allowed.length) { toast('Formato non supportato (usa .xlsx .xls .csv .pdf)', 'error'); return; }

  for (const f of allowed) {
    if (APP.files.find(x => x.name === f.name)) {
      toast(`"${f.name}" già caricato`, 'warn'); continue;
    }

    // FIX: use integer UID to avoid float IDs breaking DOM selectors
    const uid = APP.nextId++;
    const item = { uid, name: f.name, type: extOf(f.name), size: f.size, data: null };
    APP.files.push(item);
    renderFileList();
    showActionBar();
    setFileStatus(uid, 'loading');

    try {
      const buf = await f.arrayBuffer();
      await parseFileBuffer(buf, item);
      setFileStatus(uid, 'ready');
    } catch (err) {
      setFileStatus(uid, 'error');
      console.error('Parse error:', f.name, err);
      toast(`Errore lettura "${f.name}": ${err.message}`, 'error');
    }
  }
}

function extOf(name) {
  const e = name.split('.').pop().toLowerCase();
  if (e === 'csv') return 'csv';
  if (e === 'pdf') return 'pdf';
  return 'xlsx';
}

async function parseFileBuffer(buf, item) {
  if (item.type === 'csv') {
    // Try UTF-8, fallback to latin1
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (_) { text = new TextDecoder('iso-8859-1').decode(buf); }
    item.data = parseCSV(text);

  } else if (item.type === 'xlsx' || item.type === 'xls') {
    // FIX: XLSX.read with type:'array' needs Uint8Array, NOT ArrayBuffer
    const arr = new Uint8Array(buf);
    const wb  = XLSX.read(arr, { type: 'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    item.data = XLSX.utils.sheet_to_json(ws, { defval: '' });

  } else if (item.type === 'pdf') {
    if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js non caricato');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page    = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push({ page: p, text: content.items.map(it => it.str).join(' ') });
    }
    item.data = pages;
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = splitCSVLine(lines[0], sep).map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line, sep);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').replace(/^"|"$/g, '').trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v !== ''));
}

function splitCSVLine(line, sep) {
  const res = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; }
    else if (c === sep && !q) { res.push(cur); cur = ''; }
    else { cur += c; }
  }
  res.push(cur);
  return res;
}

// FIX: parsePrice — use /\./g regex (not string) to replace ALL dots
function parsePrice(val) {
  if (val === null || val === undefined || val === '') return null;
  let s = String(val).replace(/[€$£\s\u00a0]/g, '').trim();
  // Detect format: if ends with ,dd assume Italian (dot=thousand, comma=decimal)
  if (/,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.'); // Italian: 1.234,56 → 1234.56
  } else {
    s = s.replace(/,/g, '');                    // US: 1,234.56 → 1234.56
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

// ─── File list rendering ──────────────────────────────────────────────────
function renderFileList() {
  const list = $('file-list');
  list.innerHTML = APP.files.map(f => `
    <div class="file-item" id="fi-${f.uid}">
      <span class="file-badge badge-${f.type}">${f.type.toUpperCase()}</span>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${fmtSize(f.size)}</span>
      <span class="file-status loading" id="fst-${f.uid}">Lettura…</span>
      <button class="file-remove" onclick="removeFile(${f.uid})" title="Rimuovi">×</button>
    </div>
  `).join('');
}

// FIX: uid is now a safe integer — no dot in ID → selector works
function setFileStatus(uid, status) {
  const el = $('fst-' + uid);
  if (!el) return;
  el.className = 'file-status ' + status;
  el.textContent = status === 'loading' ? 'Lettura…' : status === 'ready' ? 'Pronto' : 'Errore';
}

window.removeFile = function(uid) {
  APP.files = APP.files.filter(f => f.uid !== uid);
  renderFileList();
  showActionBar();
};

function showActionBar() {
  const bar = $('action-bar');
  // FIX: use hidden attribute consistently, not style.display
  APP.files.length ? bar.removeAttribute('hidden') : bar.setAttribute('hidden', '');
}

$('clear-files').addEventListener('click', () => {
  APP.files = [];
  renderFileList();
  showActionBar();
  $('results-section').setAttribute('hidden', '');
});

// ─── Analysis ─────────────────────────────────────────────────────────────
$('run-compare').addEventListener('click', runAnalysis);

async function runAnalysis() {
  const btn = $('run-compare');
  btn.disabled = true;
  btn.textContent = 'Analisi…';
  setStatus('Analisi in corso', 'busy');
  await tick();

  const opts = {
    duplicates: $('opt-duplicates').checked,
    price:      $('opt-price').checked,
    desc:       $('opt-desc').checked,
    missing:    $('opt-missing').checked
  };

  try {
    APP.issues  = runCompare(APP.files, opts);
    APP.filtered = [...APP.issues];
    APP.activeFilter = 'all';
    renderResults();
    $('results-section').removeAttribute('hidden');
    $('results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const n = APP.issues.length;
    toast(n === 0 ? 'Nessuna anomalia trovata — file coerenti' : `${n} anomali${n === 1 ? 'a' : 'e'} rilevat${n === 1 ? 'a' : 'e'}`,
          n === 0 ? 'success' : 'warn');
  } catch (e) {
    toast('Errore analisi: ' + e.message, 'error');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Avvia Analisi';
  setStatus('Pronto');
}

function runCompare(files, opts) {
  const issues = [];
  const structured = files.filter(f => f.type !== 'pdf' && Array.isArray(f.data) && f.data.length);

  const meta = structured.map(f => ({
    ...f,
    codeCol:  detectCol(f.data, ['codice','code','cod','articolo','art','sku','id','ref','part number','pn']),
    descCol:  detectCol(f.data, ['descrizione','desc','description','nome','name','prodotto','product']),
    priceCol: detectCol(f.data, ['prezzo','price','listino','list','pvp','costo','cost','pricelist','pr'])
  }));

  // Build code map: code → [{file, row, desc, price}]
  const codeMap = {};
  for (const f of meta) {
    if (!f.codeCol) continue;
    f.data.forEach((row, ri) => {
      const code = String(row[f.codeCol] || '').trim().toUpperCase();
      if (!code || code === '0') return;
      if (!codeMap[code]) codeMap[code] = [];
      codeMap[code].push({
        file:  f.name,
        row:   ri + 2,
        desc:  f.descCol  ? String(row[f.descCol]  || '').trim() : '',
        price: f.priceCol ? parsePrice(row[f.priceCol]) : null
      });
    });
  }

  // 1. Duplicati nella stessa fonte
  if (opts.duplicates) {
    const seen = {};
    Object.entries(codeMap).forEach(([code, entries]) => {
      entries.forEach(e => {
        const key = e.file + '|' + code;
        if (seen[key]) {
          issues.push({
            type: 'duplicate', severity: 'critical',
            code,
            desc: `Codice duplicato in "${shortName(e.file)}"`,
            detail: `Riga ${seen[key].row} e riga ${e.row}`,
            sources: [e.file]
          });
        } else {
          seen[key] = e;
        }
      });
    });
  }

  // 2. Stesso codice, prezzi diversi tra fonti diverse
  if (opts.price) {
    Object.entries(codeMap).forEach(([code, entries]) => {
      // group by file, take first price per file
      const byFile = {};
      entries.forEach(e => {
        if (e.price !== null && !byFile[e.file]) byFile[e.file] = e.price;
      });
      const pairs = Object.entries(byFile);
      if (pairs.length < 2) return;
      const prices = [...new Set(pairs.map(([, p]) => p))];
      if (prices.length > 1) {
        issues.push({
          type: 'price', severity: 'warn',
          code,
          desc: `Prezzi difformi per "${code}"`,
          detail: pairs.map(([f, p]) => `${shortName(f)}: €${p.toFixed(2)}`).join(' vs '),
          sources: pairs.map(([f]) => f)
        });
      }
    });
  }

  // 3. Stesso codice, descrizioni diverse tra fonti
  if (opts.desc) {
    Object.entries(codeMap).forEach(([code, entries]) => {
      const byFile = {};
      entries.filter(e => e.desc).forEach(e => { if (!byFile[e.file]) byFile[e.file] = e.desc; });
      const pairs = Object.entries(byFile);
      if (pairs.length < 2) return;
      const unique = [...new Set(pairs.map(([, d]) => d.toLowerCase()))];
      if (unique.length > 1) {
        issues.push({
          type: 'desc', severity: 'info',
          code,
          desc: `Descrizioni diverse per "${code}"`,
          detail: pairs.map(([f, d]) => `"${d}" (${shortName(f)})`).join(' ≠ '),
          sources: pairs.map(([f]) => f)
        });
      }
    });
  }

  // 4. Codici mancanti tra fonti
  if (opts.missing && meta.length >= 2) {
    const sets = {};
    meta.forEach(f => {
      if (!f.codeCol) return;
      sets[f.name] = new Set(
        f.data.map(r => String(r[f.codeCol] || '').trim().toUpperCase()).filter(c => c && c !== '0')
      );
    });
    const names = Object.keys(sets);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        sets[names[i]].forEach(code => {
          if (!sets[names[j]].has(code)) {
            issues.push({
              type: 'missing', severity: 'info',
              code,
              desc: `Solo in "${shortName(names[i])}"`,
              detail: `Assente in "${shortName(names[j])}"`,
              sources: [names[i]]
            });
          }
        });
      }
    }
  }

  // 5. PDF vs PDF — codici presenti solo in uno
  const pdfs = files.filter(f => f.type === 'pdf' && Array.isArray(f.data) && f.data.length);
  if (pdfs.length >= 2) {
    const pdfSets = {};
    const codeRx = /\b([A-Z]{2,6}[-][A-Z0-9]{2,10})\b/g;
    pdfs.forEach(f => {
      const s = new Set();
      f.data.forEach(pg => { const m = pg.text.match(codeRx) || []; m.forEach(c => s.add(c)); });
      pdfSets[f.name] = s;
    });
    const pNames = Object.keys(pdfSets);
    for (let i = 0; i < pNames.length; i++) {
      for (let j = i + 1; j < pNames.length; j++) {
        pdfSets[pNames[i]].forEach(code => {
          if (!pdfSets[pNames[j]].has(code)) {
            issues.push({
              type: 'missing', severity: 'info',
              code,
              desc: `[PDF] Solo in "${shortName(pNames[i])}"`,
              detail: `Assente in "${shortName(pNames[j])}"`,
              sources: [pNames[i]]
            });
          }
        });
      }
    }
  }

  return issues;
}

function detectCol(rows, candidates) {
  if (!rows || !rows.length) return null;
  const keys = Object.keys(rows[0]);
  for (const c of candidates) {
    const m = keys.find(k => k.toLowerCase().replace(/[\s_\-]/g, '').includes(c.replace(/[\s]/g, '')));
    if (m) return m;
  }
  return null;
}

function shortName(name) {
  return name.length > 28 ? '…' + name.slice(-26) : name;
}

// ─── Results rendering ────────────────────────────────────────────────────
function renderResults() {
  const cnt = {
    duplicate: APP.issues.filter(i => i.type === 'duplicate').length,
    price:     APP.issues.filter(i => i.type === 'price').length,
    desc:      APP.issues.filter(i => i.type === 'desc').length,
    missing:   APP.issues.filter(i => i.type === 'missing').length
  };
  const total = APP.issues.length;

  $('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-label">Totale anomalie</div>
      <div class="stat-value ${total > 0 ? 'c-danger' : 'c-accent'}">${total}</div></div>
    <div class="stat-card"><div class="stat-label">Duplicati</div>
      <div class="stat-value c-danger">${cnt.duplicate}</div></div>
    <div class="stat-card"><div class="stat-label">Prezzi difformi</div>
      <div class="stat-value c-warn">${cnt.price}</div></div>
    <div class="stat-card"><div class="stat-label">Descrizioni</div>
      <div class="stat-value c-info">${cnt.desc}</div></div>
    <div class="stat-card"><div class="stat-label">Codici mancanti</div>
      <div class="stat-value">${cnt.missing}</div></div>
  `;

  $('filter-pills').innerHTML = `
    <button class="pill pill-all on"  data-f="all">Tutti (${total})</button>
    <button class="pill pill-dup"     data-f="duplicate">Duplicati (${cnt.duplicate})</button>
    <button class="pill pill-price"   data-f="price">Prezzi (${cnt.price})</button>
    <button class="pill pill-desc"    data-f="desc">Descrizioni (${cnt.desc})</button>
    <button class="pill pill-miss"    data-f="missing">Mancanti (${cnt.missing})</button>
  `;
  $$('.pill').forEach(p => p.addEventListener('click', () => {
    $$('.pill').forEach(x => x.classList.remove('on'));
    p.classList.add('on');
    const f = p.dataset.f;
    APP.filtered     = f === 'all' ? [...APP.issues] : APP.issues.filter(i => i.type === f);
    APP.activeFilter = f;
    renderTable();
  }));

  renderTable();
}

function renderTable() {
  const wrap = $('issues-table-container');
  if (!APP.filtered.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nessuna anomalia in questa categoria</p></div>';
    return;
  }

  const sevMap = { critical:['sev-critical','Critico'], warn:['sev-warn','Attenzione'], info:['sev-info','Info'] };
  const typMap = { duplicate:'Duplicato', price:'Prezzo', desc:'Descrizione', missing:'Mancante' };

  // FIX: wrap is the container — no duplicate wrapper class
  wrap.innerHTML = `
    <div class="issues-table-wrap">
      <table class="issues-tbl">
        <thead><tr>
          <th>Gravità</th><th>Tipo</th><th>Codice</th>
          <th>Problema</th><th>Dettaglio</th><th>Fonte</th>
        </tr></thead>
        <tbody>
          ${APP.filtered.map(i => {
            const [cls, lbl] = sevMap[i.severity] || ['sev-info','Info'];
            return `<tr>
              <td><span class="sev ${cls}">${lbl}</span></td>
              <td>${typMap[i.type] || i.type}</td>
              <td>${esc(i.code)}</td>
              <td style="font-family:var(--font);max-width:200px">${esc(i.desc)}</td>
              <td style="max-width:260px;color:var(--text2)">${esc(i.detail)}</td>
              <td>${(i.sources||[]).map(s => `<span class="source-chip">${esc(shortName(s))}</span>`).join('')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

$('export-csv-btn').addEventListener('click', () => {
  if (!APP.filtered.length) { toast('Nessun dato da esportare', 'warn'); return; }
  const h = ['Gravità','Tipo','Codice','Problema','Dettaglio','Fonti'];
  const rows = APP.filtered.map(i => [i.severity, i.type, i.code, i.desc, i.detail, (i.sources||[]).join('; ')]);
  download([h, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'),
    'anomalie.csv', 'text/csv');
  toast('CSV esportato', 'success');
});

$('export-print-btn').addEventListener('click', () => window.print());

// ─── PDF: drop zone ───────────────────────────────────────────────────────
const pdfDrop  = $('pdf-drop-zone');
const pdfInput = $('pdf-file-input');

pdfDrop.addEventListener('click', () => pdfInput.click());
['dragover','dragenter'].forEach(ev =>
  pdfDrop.addEventListener(ev, e => { e.preventDefault(); pdfDrop.classList.add('drag-over'); })
);
['dragleave','drop'].forEach(ev =>
  pdfDrop.addEventListener(ev, () => pdfDrop.classList.remove('drag-over'))
);
pdfDrop.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) loadPDF(f); });
pdfInput.addEventListener('change', () => { if (pdfInput.files[0]) loadPDF(pdfInput.files[0]); pdfInput.value = ''; });

async function loadPDF(file) {
  if (!/\.pdf$/i.test(file.name)) { toast('Seleziona un file PDF', 'error'); return; }
  if (typeof pdfjsLib === 'undefined') { toast('pdf.js non caricato correttamente', 'error'); return; }

  setStatus('Caricamento PDF…', 'busy');
  $('run-pdf-extract').setAttribute('disabled', '');

  const info = $('pdf-file-info');
  info.removeAttribute('hidden');
  info.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;">
      <span class="file-badge badge-pdf">PDF</span>
      <span>${esc(file.name)}</span>
      <span style="color:var(--text3);font-family:var(--mono)">${fmtSize(file.size)}</span>
    </div>
    <div class="progress-wrap"><div class="progress-fill" id="pdf-progress" style="width:0%"></div></div>`;

  try {
    const buf = await file.arrayBuffer();
    APP.pdfBuf  = buf;
    APP.pdfName = file.name;

    const pdf     = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const preview = $('pdf-preview');
    preview.innerHTML = '';
    const pagesToShow = Math.min(pdf.numPages, 6);

    for (let p = 1; p <= pagesToShow; p++) {
      const page = await pdf.getPage(p);
      const vp   = page.getViewport({ scale: 1.3 });
      const canvas = document.createElement('canvas');
      canvas.width  = vp.width;
      canvas.height = vp.height;
      canvas.className = 'pdf-page-canvas';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;

      const lbl = document.createElement('p');
      lbl.className = 'pdf-page-label';
      lbl.textContent = `Pagina ${p} di ${pdf.numPages}`;
      preview.appendChild(lbl);
      preview.appendChild(canvas);

      const prog = $('pdf-progress');
      if (prog) prog.style.width = Math.round((p / pagesToShow) * 100) + '%';
    }

    if (pdf.numPages > pagesToShow) {
      const note = document.createElement('p');
      note.style.cssText = 'text-align:center;font-size:12px;color:var(--text3);padding:8px 0';
      note.textContent = `… altre ${pdf.numPages - pagesToShow} pagine non mostrate in anteprima`;
      preview.appendChild(note);
    }

    $('run-pdf-extract').removeAttribute('disabled');
    setStatus('PDF caricato');
    toast(`"${file.name}" caricato — ${pdf.numPages} pagine`, 'success');
  } catch (e) {
    toast('Errore lettura PDF: ' + e.message, 'error');
    setStatus('Errore', 'error');
    console.error(e);
  }
}

$('run-pdf-extract').addEventListener('click', async () => {
  if (!APP.pdfBuf) { toast('Prima carica un PDF', 'warn'); return; }
  const btn = $('run-pdf-extract');
  btn.setAttribute('disabled', '');
  btn.textContent = 'Estrazione…';
  setStatus('Estrazione…', 'busy');

  try {
    APP.extracted = await extractItems(APP.pdfBuf);
    renderExtracted(APP.extracted);
    $('pdf-results').removeAttribute('hidden');
    toast(`${APP.extracted.length} articoli estratti`, APP.extracted.length ? 'success' : 'warn');
  } catch (e) {
    toast('Errore estrazione: ' + e.message, 'error');
    console.error(e);
  }

  btn.removeAttribute('disabled');
  btn.textContent = 'Estrai Dati';
  setStatus('Pronto');
});

async function extractItems(buf) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

  let codeRx;
  const codePatStr = $('code-pattern').value.trim() || '[A-Z0-9]{3,}-[A-Z0-9]{2,}';
  try { codeRx = new RegExp(codePatStr, 'gi'); }
  catch (_) { codeRx = /[A-Z0-9]{3,}-[A-Z0-9]{2,}/gi; toast('Pattern regex non valido, uso default', 'warn'); }

  const customPriceStr = $('price-pattern').value.trim();
  const decSep = $('decimal-sep').value;
  const doImages = $('extract-images').checked;

  const items = [];
  const seen  = new Set();

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');

    // Find codes on this page
    const codeMatches = [...pageText.matchAll(new RegExp(codePatStr, 'gi'))].map(m => m[0].toUpperCase());
    if (!codeMatches.length) continue;

    // Find prices on this page
    let priceRx;
    if (customPriceStr) {
      try { priceRx = new RegExp(customPriceStr, 'g'); } catch (_) { priceRx = null; }
    }
    if (!priceRx) {
      priceRx = decSep === 'comma'
        ? /\b(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\b/g
        : /\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\b/g;
    }

    const prices = [];
    for (const m of pageText.matchAll(new RegExp(priceRx.source, priceRx.flags))) {
      const p = parsePrice(m[1] || m[0]);
      if (p !== null && p >= 0.5 && p < 999999) prices.push(p);
    }

    // Extract page image for visual context
    let imgURL = null;
    if (doImages) {
      try {
        const vp = page.getViewport({ scale: 0.9 });
        const cv = document.createElement('canvas');
        cv.width = vp.width; cv.height = vp.height;
        await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
        imgURL = cv.toDataURL('image/jpeg', 0.65);
      } catch (_) {}
    }

    const uniqueOnPage = [...new Set(codeMatches)];
    uniqueOnPage.forEach((code, idx) => {
      if (seen.has(code)) return;
      seen.add(code);
      items.push({
        code,
        desc:   extractDesc(pageText, code),
        price:  prices[idx] ?? prices[0] ?? null,
        image:  imgURL,
        page:   p,
        source: APP.pdfName
      });
    });
  }
  return items;
}

function extractDesc(text, code) {
  const upper = text.toUpperCase();
  const idx = upper.indexOf(code.toUpperCase());
  if (idx === -1) return '';
  const snippet = text.slice(idx + code.length, idx + code.length + 100).trim();
  return snippet.replace(/^[\s\-:|]+/, '').split(/\n/)[0].trim().slice(0, 80);
}

function renderExtracted(items) {
  const grid = $('extracted-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><p>Nessun articolo trovato</p><p class="hint">Prova a modificare il pattern del codice articolo</p></div>';
    return;
  }
  grid.innerHTML = items.map((it, i) => articleCard(it, i, 'extracted')).join('');
}

function articleCard(it, i, ctx) {
  const imgHTML = it.image
    ? `<img class="card-img" src="${it.image}" alt="${esc(it.code)}" loading="lazy">`
    : `<div class="card-img-placeholder"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="3" y="3" width="22" height="22" rx="3" stroke="currentColor" stroke-width="1.3"/><path d="M8 18 L11 14 L15 17 L19 11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></div>`;
  const priceHTML = it.price !== null
    ? `<div class="card-price">€ ${it.price.toFixed(2).replace('.', ',')}</div>`
    : `<div class="card-price nd">Prezzo n/d</div>`;

  const actions = ctx === 'extracted'
    ? `<button class="btn-outline" onclick="editItem(${i})">Modifica</button>
       <button class="btn-primary" onclick="addItemToCatalog(${i})">+ Catalogo</button>`
    : `<button class="btn-ghost"   onclick="removeCatalogItem('${esc(it.code)}')">Rimuovi</button>
       <button class="btn-primary" onclick="addToQuote('${esc(it.code)}')">+ Prev.</button>`;

  return `
    <div class="article-card" id="card-${ctx}-${i}">
      ${imgHTML}
      <div class="card-body">
        <div class="card-code">${esc(it.code)}</div>
        <div class="card-desc">${esc(it.desc) || '—'}</div>
        ${priceHTML}
        <div class="card-actions">${actions}</div>
      </div>
    </div>`;
}

window.editItem = function(i) {
  const it = APP.extracted[i];
  const code  = prompt('Codice articolo:', it.code);
  if (code  !== null) it.code  = code.trim().toUpperCase();
  const desc  = prompt('Descrizione:', it.desc);
  if (desc  !== null) it.desc  = desc.trim();
  const price = prompt('Prezzo (es: 123,45):', it.price !== null ? it.price.toFixed(2) : '');
  if (price !== null) it.price = parsePrice(price);
  renderExtracted(APP.extracted);
};

window.addItemToCatalog = function(i) {
  addToCatalog(APP.extracted[i]);
  toast(`"${APP.extracted[i].code}" aggiunto al catalogo`, 'success');
};

$('send-to-catalog').addEventListener('click', () => {
  let added = 0;
  APP.extracted.forEach(it => { if (addToCatalog(it)) added++; });
  toast(`${added} articoli aggiunti al catalogo`, 'success');
  $$('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-view="catalog"]').classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $('view-catalog').classList.add('active');
  renderCatalog();
});

$('pdf-export-json').addEventListener('click', () => {
  if (!APP.extracted.length) { toast('Nessun dato estratto', 'warn'); return; }
  const exp = APP.extracted.map(({ image, ...rest }) => rest); // omit large base64 images
  download(JSON.stringify(exp, null, 2), 'articoli.json', 'application/json');
  toast('JSON esportato', 'success');
});

$('pdf-export-csv').addEventListener('click', () => {
  if (!APP.extracted.length) { toast('Nessun dato estratto', 'warn'); return; }
  const h = ['Codice','Descrizione','Prezzo','Pagina','Fonte'];
  const rows = APP.extracted.map(it => [it.code, it.desc, it.price ?? '', it.page, it.source]);
  download([h,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'),
    'articoli.csv', 'text/csv');
  toast('CSV esportato', 'success');
});

// ─── Catalog ──────────────────────────────────────────────────────────────
function addToCatalog(item) {
  if (APP.catalog.find(c => c.code === item.code)) return false;
  APP.catalog.push({ ...item });
  return true;
}

function renderCatalog(filter = '') {
  const grid = $('catalog-grid');
  const items = filter
    ? APP.catalog.filter(it =>
        it.code.toLowerCase().includes(filter) ||
        (it.desc || '').toLowerCase().includes(filter))
    : APP.catalog;

  if (!items.length) {
    grid.innerHTML = `<div class="empty-state">
      <svg width="44" height="44" viewBox="0 0 44 44" fill="none"><rect x="7" y="5" width="30" height="34" rx="3" stroke="#00d4aa" stroke-width="1.5" opacity="0.4"/><line x1="13" y1="15" x2="31" y2="15" stroke="#00d4aa" stroke-width="1.5" opacity="0.35"/><line x1="13" y1="21" x2="31" y2="21" stroke="#00d4aa" stroke-width="1.5" opacity="0.25"/></svg>
      <p>${filter ? `Nessun risultato per "${esc(filter)}"` : 'Catalogo vuoto'}</p>
      <p class="hint">${filter ? '' : 'Estrai articoli da un PDF oppure importa un JSON/CSV'}</p>
    </div>`;
    return;
  }
  // Use catalog index, not extracted index
  grid.innerHTML = items.map((it) => {
    const catIdx = APP.catalog.indexOf(it);
    return articleCard(it, catIdx, 'catalog');
  }).join('');
}

window.removeCatalogItem = function(code) {
  APP.catalog = APP.catalog.filter(it => it.code !== code);
  renderCatalog($('catalog-search').value.toLowerCase());
  updateQuoteBadge();
};

$('catalog-search').addEventListener('input', e => renderCatalog(e.target.value.toLowerCase()));

$('import-catalog').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,.csv';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const text = await f.text();
    try {
      let imported;
      if (f.name.toLowerCase().endsWith('.json')) {
        imported = JSON.parse(text);
      } else {
        imported = parseCSV(text).map(r => ({
          code:  r['Codice']  || r['code']  || '',
          desc:  r['Descrizione'] || r['description'] || r['desc'] || '',
          price: parsePrice(r['Prezzo'] || r['price']),
          image: null, source: f.name
        }));
      }
      let n = 0;
      imported.forEach(it => { if (addToCatalog(it)) n++; });
      renderCatalog();
      toast(`${n} articoli importati`, 'success');
    } catch (e) {
      toast('Errore importazione: ' + e.message, 'error');
    }
  };
  inp.click();
});

// ─── Quote drawer ─────────────────────────────────────────────────────────
$('toggle-quote').addEventListener('click', toggleDrawer);
$('close-quote').addEventListener('click', () => $('quote-drawer').setAttribute('hidden', ''));

function toggleDrawer() {
  const d = $('quote-drawer');
  d.hasAttribute('hidden') ? d.removeAttribute('hidden') : d.setAttribute('hidden', '');
  renderQuote();
}

window.addToQuote = function(code) {
  const it = APP.catalog.find(c => c.code === code);
  if (!it) return;
  const ex = APP.quote.find(q => q.code === code);
  if (ex) { ex.qty++; }
  else { APP.quote.push({ code: it.code, desc: it.desc || '', price: it.price || 0, qty: 1 }); }
  $('quote-drawer').removeAttribute('hidden');
  renderQuote();
  updateQuoteBadge();
  toast(`"${code}" aggiunto al preventivo`, 'success');
};

function renderQuote() {
  const wrap = $('quote-items');
  if (!APP.quote.length) {
    wrap.innerHTML = '<p class="drawer-empty">Aggiungi articoli dal catalogo</p>';
  } else {
    wrap.innerHTML = APP.quote.map((it, i) => `
      <div class="quote-item">
        <span class="qi-code">${esc(it.code)}</span>
        <span class="qi-desc">${esc(it.desc)}</span>
        <span class="qi-qty"><input type="number" min="1" step="1" value="${it.qty}" onchange="updateQty(${i},this.value)"></span>
        <span class="qi-price">€ ${(it.price * it.qty).toFixed(2).replace('.', ',')}</span>
        <button class="qi-del" onclick="delQuoteItem(${i})">×</button>
      </div>`).join('');
  }
  calcTotals();
}

window.updateQty = function(i, v) {
  APP.quote[i].qty = Math.max(1, parseInt(v) || 1);
  renderQuote(); updateQuoteBadge();
};

window.delQuoteItem = function(i) {
  APP.quote.splice(i, 1);
  renderQuote(); updateQuoteBadge();
};

function calcTotals() {
  const sub = APP.quote.reduce((s, it) => s + it.price * it.qty, 0);
  const iva = sub * 0.22;
  const tot = sub + iva;
  $('q-sub').textContent = '€ ' + sub.toFixed(2).replace('.', ',');
  $('q-iva').textContent = '€ ' + iva.toFixed(2).replace('.', ',');
  $('q-tot').textContent = '€ ' + tot.toFixed(2).replace('.', ',');
}

function updateQuoteBadge() {
  const n = APP.quote.reduce((s, it) => s + it.qty, 0);
  const badge = $('quote-badge');
  badge.textContent = n;
  n > 0 ? badge.classList.remove('hidden') : badge.classList.add('hidden');
}

$('export-quote-csv').addEventListener('click', () => {
  if (!APP.quote.length) { toast('Preventivo vuoto', 'warn'); return; }
  const sub = APP.quote.reduce((s, it) => s + it.price * it.qty, 0);
  const iva = sub * 0.22;
  const client = $('quote-client').value || 'Cliente';
  const ref    = $('quote-ref').value    || new Date().toLocaleDateString('it-IT');
  const rows = [
    ['Codice','Descrizione','Prezzo Unit.','Qta','Totale'],
    ...APP.quote.map(it => [it.code, it.desc, it.price.toFixed(2), it.qty, (it.price*it.qty).toFixed(2)]),
    ['','','','Imponibile', sub.toFixed(2)],
    ['','','','IVA 22%',    iva.toFixed(2)],
    ['','','','TOTALE',     (sub+iva).toFixed(2)]
  ];
  download(rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n'),
    `preventivo_${client}_${ref}.csv`, 'text/csv');
  toast('Preventivo esportato', 'success');
});

$('print-quote').addEventListener('click', () => window.print());

// ─── Utilities ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtSize(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function download(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function tick() { return new Promise(r => setTimeout(r, 30)); }

// FIX: renamed parameter 'state' → 'st' to avoid shadowing global APP
function setStatus(text, st = 'idle') {
  $('status-text').textContent = text;
  const dot = $('status-dot');
  dot.className = 'status-dot' + (st !== 'idle' ? ' ' + st : '');
}

let toastT;
function toast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), 3400);
}

// ─── Service Worker ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
