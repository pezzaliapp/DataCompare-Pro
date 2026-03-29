/* ── DataCompare Pro — app.js ── */
'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  files: [],          // {id, name, type, size, data: parsed rows, raw: ArrayBuffer}
  issues: [],         // all detected issues
  filteredIssues: [], // after filter pill
  activeFilter: 'all',
  catalog: [],        // {code, desc, price, image, source}
  quote: [],          // {code, desc, price, qty}
  pdfFile: null,
  extractedItems: []
};

// ── PDF.js setup ───────────────────────────────────────────────────────────
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Navigation ─────────────────────────────────────────────────────────────
$$('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.nav-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    $$('.view').forEach(v => v.classList.remove('active'));
    $(`view-${view}`).classList.add('active');
  });
});

// ── Drag & Drop (Compare) ──────────────────────────────────────────────────
const dropZone = $('drop-zone');
const fileInput = $('file-input');

dropZone.addEventListener('click', () => fileInput.click());
$('browse-btn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });

['dragover', 'dragenter'].forEach(ev => {
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('over'); });
});
['dragleave', 'drop'].forEach(ev => {
  dropZone.addEventListener(ev, () => dropZone.classList.remove('over'));
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  handleFiles([...e.dataTransfer.files]);
});

fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

async function handleFiles(files) {
  const allowed = files.filter(f =>
    /\.(xlsx|xls|csv|pdf)$/i.test(f.name)
  );
  if (!allowed.length) { toast('Formato non supportato', 'error'); return; }

  for (const f of allowed) {
    if (state.files.find(x => x.name === f.name)) continue;
    const id = Date.now() + Math.random();
    const item = { id, name: f.name, type: getType(f.name), size: f.size, data: null, raw: null };
    state.files.push(item);
    renderFileList();
    updateActionBar();
    setFileStatus(id, 'loading');
    try {
      await parseFile(f, item);
      setFileStatus(id, 'ready');
    } catch(err) {
      setFileStatus(id, 'error');
      console.error(err);
    }
  }
  fileInput.value = '';
}

function getType(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'pdf') return 'pdf';
  return 'xlsx';
}

async function parseFile(file, item) {
  const buf = await file.arrayBuffer();
  item.raw = buf;
  const type = item.type;

  if (type === 'csv') {
    const text = new TextDecoder('utf-8').decode(buf);
    item.data = parseCSV(text);
  } else if (type === 'xlsx' || type === 'xls') {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    item.data = XLSX.utils.sheet_to_json(ws, { defval: '' });
  } else if (type === 'pdf') {
    item.data = await extractPDFText(buf);
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line, sep);
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] || '').replace(/^"|"$/g, '').trim());
    return row;
  });
}

function splitCSVLine(line, sep) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === sep && !inQ) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

async function extractPDFText(buf) {
  if (typeof pdfjsLib === 'undefined') return [];
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const rows = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ');
    rows.push({ page: i, text });
  }
  return rows;
}

// ── File list rendering ────────────────────────────────────────────────────
function renderFileList() {
  const list = $('file-list');
  list.classList.toggle('hidden', !state.files.length);
  list.innerHTML = state.files.map(f => `
    <div class="file-item" id="fi-${f.id}">
      <span class="file-type-badge badge-${f.type}">${f.type}</span>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${formatSize(f.size)}</span>
      <span class="file-status loading" id="fs-${f.id}">Caricamento…</span>
      <button class="file-remove" onclick="removeFile(${f.id})" title="Rimuovi">×</button>
    </div>
  `).join('');
}

function setFileStatus(id, status) {
  const el = $(`fs-${id}`);
  if (!el) return;
  el.className = `file-status ${status}`;
  el.textContent = status === 'loading' ? 'Caricamento…' : status === 'ready' ? 'Pronto' : 'Errore';
}

window.removeFile = function(id) {
  state.files = state.files.filter(f => f.id !== id);
  renderFileList();
  updateActionBar();
};

$('clear-files').addEventListener('click', () => {
  state.files = [];
  renderFileList();
  updateActionBar();
  $('results-section').classList.add('hidden');
});

function updateActionBar() {
  const bar = $('action-bar');
  bar.style.display = state.files.length ? 'flex' : 'none';
}

// ── Analysis engine ────────────────────────────────────────────────────────
$('run-compare').addEventListener('click', runAnalysis);

async function runAnalysis() {
  const btn = $('run-compare');
  btn.disabled = true;
  btn.textContent = 'Analisi in corso…';
  setStatus('Analisi', 'busy');

  const opts = {
    duplicates: $('opt-duplicates').checked,
    price: $('opt-price').checked,
    desc: $('opt-desc').checked,
    missing: $('opt-missing').checked
  };

  await sleep(100); // allow repaint

  try {
    state.issues = analyze(state.files, opts);
    state.filteredIssues = [...state.issues];
    state.activeFilter = 'all';
    renderResults();
    $('results-section').classList.remove('hidden');
    $('results-section').scrollIntoView({ behavior: 'smooth' });
    toast(`Analisi completata: ${state.issues.length} problemi rilevati`, state.issues.length ? 'warn' : 'success');
  } catch(e) {
    toast('Errore durante l\'analisi: ' + e.message, 'error');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Avvia Analisi';
  setStatus('Pronto');
}

function analyze(files, opts) {
  const issues = [];

  // Collect all structured files (non-PDF)
  const structured = files.filter(f => f.type !== 'pdf' && f.data?.length);

  // Detect code column and price column for each file
  const filesWithMeta = structured.map(f => ({
    ...f,
    codeCol: detectColumn(f.data, ['codice', 'code', 'cod', 'articolo', 'art', 'sku', 'id', 'ref', 'part']),
    descCol: detectColumn(f.data, ['descrizione', 'desc', 'description', 'nome', 'name', 'prodotto']),
    priceCol: detectColumn(f.data, ['prezzo', 'price', 'listino', 'list', 'pvp', 'pricelist', 'costo', 'cost'])
  }));

  // Build per-code maps
  const codeMap = {}; // code => [{value, file, row, desc, price}]

  for (const f of filesWithMeta) {
    if (!f.codeCol) continue;
    f.data.forEach((row, ri) => {
      const code = String(row[f.codeCol] || '').trim().toUpperCase();
      if (!code) return;
      if (!codeMap[code]) codeMap[code] = [];
      codeMap[code].push({
        code,
        file: f.name,
        row: ri + 2,
        desc: f.descCol ? String(row[f.descCol] || '').trim() : '',
        price: f.priceCol ? parsePrice(row[f.priceCol]) : null,
        rawRow: row
      });
    });
  }

  // 1. Duplicati nella stessa fonte
  if (opts.duplicates) {
    const seenPerFile = {};
    Object.entries(codeMap).forEach(([code, entries]) => {
      entries.forEach(e => {
        const key = `${e.file}|${code}`;
        if (seenPerFile[key]) {
          issues.push({
            type: 'duplicate',
            severity: 'critical',
            code,
            description: `Codice duplicato in "${e.file}"`,
            detail: `Riga ${seenPerFile[key].row} e riga ${e.row}`,
            sources: [e.file]
          });
        } else {
          seenPerFile[key] = e;
        }
      });
    });
  }

  // 2. Stesso codice, prezzi diversi tra file
  if (opts.price) {
    Object.entries(codeMap).forEach(([code, entries]) => {
      const withPrice = entries.filter(e => e.price !== null && !isNaN(e.price));
      if (withPrice.length < 2) return;
      const prices = [...new Set(withPrice.map(e => e.price))];
      if (prices.length > 1) {
        const detail = withPrice.map(e => `${e.file}: €${e.price.toFixed(2)}`).join(' vs ');
        issues.push({
          type: 'price',
          severity: 'warn',
          code,
          description: `Prezzi difformi per codice "${code}"`,
          detail,
          sources: [...new Set(withPrice.map(e => e.file))]
        });
      }
    });
  }

  // 3. Stesso codice, descrizioni diverse tra file
  if (opts.desc) {
    Object.entries(codeMap).forEach(([code, entries]) => {
      const withDesc = entries.filter(e => e.desc);
      if (withDesc.length < 2) return;
      const descs = [...new Set(withDesc.map(e => e.desc.toLowerCase()))];
      if (descs.length > 1) {
        const detail = withDesc.map(e => `"${e.desc}" (${e.file})`).join(' ≠ ');
        issues.push({
          type: 'desc',
          severity: 'info',
          code,
          description: `Descrizioni diverse per codice "${code}"`,
          detail,
          sources: [...new Set(withDesc.map(e => e.file))]
        });
      }
    });
  }

  // 4. Codici presenti in un file ma non in un altro
  if (opts.missing && filesWithMeta.length >= 2) {
    const perFileSet = {};
    filesWithMeta.forEach(f => {
      if (!f.codeCol) return;
      perFileSet[f.name] = new Set(f.data.map(r => String(r[f.codeCol] || '').trim().toUpperCase()).filter(Boolean));
    });
    const fileNames = Object.keys(perFileSet);
    for (let i = 0; i < fileNames.length; i++) {
      for (let j = i + 1; j < fileNames.length; j++) {
        const a = perFileSet[fileNames[i]];
        const b = perFileSet[fileNames[j]];
        a.forEach(code => {
          if (!b.has(code)) {
            issues.push({
              type: 'missing',
              severity: 'info',
              code,
              description: `Codice presente solo in "${fileNames[i]}"`,
              detail: `Assente in "${fileNames[j]}"`,
              sources: [fileNames[i]]
            });
          }
        });
      }
    }
  }

  // PDF vs PDF: textual analysis
  const pdfs = files.filter(f => f.type === 'pdf' && f.data?.length);
  if (pdfs.length >= 2) {
    const codeRx = /\b([A-Z]{2,5}[-\/][A-Z0-9]{2,8})\b/g;
    const pdfCodes = {};
    pdfs.forEach(f => {
      const codes = new Set();
      f.data.forEach(page => {
        const m = page.text.match(codeRx) || [];
        m.forEach(c => codes.add(c));
      });
      pdfCodes[f.name] = codes;
    });
    const pdfNames = Object.keys(pdfCodes);
    for (let i = 0; i < pdfNames.length; i++) {
      for (let j = i + 1; j < pdfNames.length; j++) {
        pdfCodes[pdfNames[i]].forEach(code => {
          if (!pdfCodes[pdfNames[j]].has(code)) {
            issues.push({
              type: 'missing',
              severity: 'info',
              code,
              description: `[PDF] Codice presente solo in "${pdfNames[i]}"`,
              detail: `Assente in "${pdfNames[j]}"`,
              sources: [pdfNames[i]]
            });
          }
        });
      }
    }
  }

  return issues;
}

function detectColumn(rows, candidates) {
  if (!rows || !rows.length) return null;
  const keys = Object.keys(rows[0]);
  for (const c of candidates) {
    const match = keys.find(k => k.toLowerCase().replace(/[\s_]/g, '').includes(c));
    if (match) return match;
  }
  return null;
}

function parsePrice(val) {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).replace(/[€$£\s]/g, '').replace('.', '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ── Results rendering ──────────────────────────────────────────────────────
function renderResults() {
  // Stats
  const counts = {
    duplicate: state.issues.filter(i => i.type === 'duplicate').length,
    price: state.issues.filter(i => i.type === 'price').length,
    desc: state.issues.filter(i => i.type === 'desc').length,
    missing: state.issues.filter(i => i.type === 'missing').length
  };

  $('stats-row').innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Totale Anomalie</div>
      <div class="stat-value ${state.issues.length > 0 ? 'danger' : 'success'}">${state.issues.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Duplicati Codice</div>
      <div class="stat-value danger">${counts.duplicate}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Prezzi Difformi</div>
      <div class="stat-value warn">${counts.price}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Descrizioni Conflittuali</div>
      <div class="stat-value info">${counts.desc}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Codici Mancanti</div>
      <div class="stat-value">${counts.missing}</div>
    </div>
  `;

  // Filter pills
  $('issues-filters').innerHTML = `
    <button class="filter-pill all active" data-type="all">Tutti (${state.issues.length})</button>
    <button class="filter-pill duplicate" data-type="duplicate">Duplicati (${counts.duplicate})</button>
    <button class="filter-pill price" data-type="price">Prezzi (${counts.price})</button>
    <button class="filter-pill desc" data-type="desc">Descrizioni (${counts.desc})</button>
    <button class="filter-pill missing" data-type="missing">Mancanti (${counts.missing})</button>
  `;

  $$('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $$('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const t = pill.dataset.type;
      state.activeFilter = t;
      state.filteredIssues = t === 'all' ? [...state.issues] : state.issues.filter(i => i.type === t);
      renderIssuesTable();
    });
  });

  renderIssuesTable();
}

function renderIssuesTable() {
  const wrap = $('issues-table-wrap');
  if (!state.filteredIssues.length) {
    wrap.innerHTML = '<div class="empty-state"><p>Nessuna anomalia in questa categoria</p></div>';
    return;
  }

  const sevLabel = { critical: 'Critico', warn: 'Attenzione', info: 'Info' };
  const sevClass = { critical: 'sev-critical', warn: 'sev-warn', info: 'sev-info' };
  const typeLabel = { duplicate: 'Duplicato', price: 'Prezzo', desc: 'Descrizione', missing: 'Mancante' };

  wrap.innerHTML = `
    <div class="issues-table-wrap">
      <table class="issues-table">
        <thead>
          <tr>
            <th>Gravità</th>
            <th>Tipo</th>
            <th>Codice</th>
            <th>Problema</th>
            <th>Dettaglio</th>
            <th>Fonti</th>
          </tr>
        </thead>
        <tbody>
          ${state.filteredIssues.map(issue => `
            <tr>
              <td><span class="severity-badge ${sevClass[issue.severity]}">${sevLabel[issue.severity]}</span></td>
              <td>${typeLabel[issue.type] || issue.type}</td>
              <td>${esc(issue.code)}</td>
              <td style="font-family:var(--font);font-size:13px;max-width:220px">${esc(issue.description)}</td>
              <td style="max-width:280px;color:var(--text2)">${esc(issue.detail)}</td>
              <td>${(issue.sources || []).map(s => `<span class="source-tag">${esc(s.split('/').pop())}</span>`).join('')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ── CSV / Report export ────────────────────────────────────────────────────
$('export-csv-btn').addEventListener('click', () => {
  if (!state.issues.length) return;
  const headers = ['Gravità','Tipo','Codice','Problema','Dettaglio','Fonti'];
  const rows = state.filteredIssues.map(i => [
    i.severity, i.type, i.code, i.description, i.detail, (i.sources||[]).join('; ')
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadText(csv, 'anomalie_datacompare.csv', 'text/csv');
  toast('CSV esportato', 'success');
});

$('export-pdf-btn').addEventListener('click', () => {
  toast('Stampa in corso…');
  window.print();
});

// ── PDF Extraction ─────────────────────────────────────────────────────────
const pdfDropZone = $('pdf-drop-zone');
const pdfFileInput = $('pdf-file-input');

pdfDropZone.addEventListener('click', () => pdfFileInput.click());
['dragover','dragenter'].forEach(ev => {
  pdfDropZone.addEventListener(ev, e => { e.preventDefault(); pdfDropZone.classList.add('over'); });
});
['dragleave','drop'].forEach(ev => {
  pdfDropZone.addEventListener(ev, () => pdfDropZone.classList.remove('over'));
});
pdfDropZone.addEventListener('drop', e => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.pdf$/i.test(f.name)) loadPDFForExtraction(f);
});
pdfFileInput.addEventListener('change', () => {
  if (pdfFileInput.files[0]) loadPDFForExtraction(pdfFileInput.files[0]);
  pdfFileInput.value = '';
});

async function loadPDFForExtraction(file) {
  $('pdf-file-info').classList.remove('hidden');
  $('pdf-file-info').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="file-type-badge badge-pdf">PDF</span>
      <span style="font-size:13px;">${esc(file.name)}</span>
      <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${formatSize(file.size)}</span>
    </div>
    <div class="progress-bar-wrap" style="margin-top:8px"><div class="progress-bar-fill" id="pdf-prog" style="width:0%"></div></div>
  `;

  const buf = await file.arrayBuffer();
  state.pdfFile = { name: file.name, buf };

  setStatus('Caricamento PDF…', 'busy');

  if (typeof pdfjsLib === 'undefined') {
    toast('pdf.js non disponibile', 'error');
    return;
  }

  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const preview = $('pdf-preview');
  preview.innerHTML = '';

  for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
    const page = await pdf.getPage(i);
    const scale = 1.2;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.className = 'pdf-page-canvas';
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    preview.appendChild(canvas);

    const prog = $('pdf-prog');
    if (prog) prog.style.width = `${(i / pdf.numPages * 100).toFixed(0)}%`;
  }

  if (pdf.numPages > 5) {
    const note = document.createElement('p');
    note.style.cssText = 'font-size:12px;color:var(--text3);text-align:center;padding:8px';
    note.textContent = `Anteprima delle prime 5 pagine su ${pdf.numPages} totali`;
    preview.appendChild(note);
  }

  $('run-pdf-extract').disabled = false;
  setStatus('PDF caricato', 'idle');
}

$('run-pdf-extract').addEventListener('click', async () => {
  if (!state.pdfFile) return;
  const btn = $('run-pdf-extract');
  btn.disabled = true;
  btn.textContent = 'Estrazione…';
  setStatus('Estrazione in corso…', 'busy');

  try {
    const items = await extractFromPDF(state.pdfFile.buf);
    state.extractedItems = items;
    renderExtractedItems(items);
    $('pdf-results').classList.remove('hidden');
    toast(`${items.length} articoli estratti`, 'success');
  } catch(e) {
    toast('Errore estrazione: ' + e.message, 'error');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Estrai Dati';
  setStatus('Pronto');
});

async function extractFromPDF(buf) {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const codePatternStr = $('code-pattern').value.trim() || '[A-Z0-9]{3,}-[A-Z0-9]{2,}';
  const pricePatternStr = $('price-pattern').value.trim();
  const decimalSep = $('decimal-sep').value;

  let codeRx, priceRx;
  try { codeRx = new RegExp(codePatternStr, 'gi'); } catch(e) { codeRx = /[A-Z0-9]{3,}-[A-Z0-9]{2,}/gi; }

  if (pricePatternStr) {
    try { priceRx = new RegExp(pricePatternStr, 'gi'); } catch(e) { priceRx = null; }
  } else {
    priceRx = decimalSep === 'comma'
      ? /(?:€\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g
      : /(?:€\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
  }

  const items = [];
  const extractImages = $('extract-images').checked;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Group text items into lines by y-position
    const textItems = content.items.map(it => ({
      text: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width
    }));

    const pageText = textItems.map(t => t.str).join(' ');

    // Find codes
    const foundCodes = [...pageText.matchAll(new RegExp(codePatternStr, 'gi'))].map(m => m[0].toUpperCase());

    if (foundCodes.length === 0) continue;

    // Find prices on same page
    const foundPrices = [];
    const priceRxCopy = new RegExp(priceRx.source, priceRx.flags);
    let pm;
    while ((pm = priceRxCopy.exec(pageText)) !== null) {
      let raw = pm[1] || pm[0];
      raw = raw.replace(/[€\s]/g, '');
      if (decimalSep === 'comma') {
        raw = raw.replace(/\./g, '').replace(',', '.');
      } else {
        raw = raw.replace(/,/g, '');
      }
      const n = parseFloat(raw);
      if (!isNaN(n) && n > 0.1 && n < 999999) foundPrices.push(n);
    }

    // Try to extract images from page
    let imgDataURL = null;
    if (extractImages) {
      try {
        const ops = await page.getOperatorList();
        const scale = 0.8;
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        imgDataURL = canvas.toDataURL('image/jpeg', 0.7);
      } catch(e) { /* no image */ }
    }

    // Match codes to prices (simple: one price per code, by order)
    const uniqueCodes = [...new Set(foundCodes)];
    uniqueCodes.forEach((code, idx) => {
      if (items.find(i => i.code === code)) return; // deduplicate
      items.push({
        code,
        desc: extractDescription(pageText, code, codePatternStr),
        price: foundPrices[idx] || foundPrices[0] || null,
        image: imgDataURL,
        page: pageNum,
        source: state.pdfFile?.name || 'PDF'
      });
    });
  }

  return items;
}

function extractDescription(text, code, pattern) {
  // Take text after the code, up to next code or price
  const idx = text.toUpperCase().indexOf(code.toUpperCase());
  if (idx === -1) return '';
  const after = text.slice(idx + code.length, idx + code.length + 120).trim();
  // Remove leading separators
  const cleaned = after.replace(/^[\s\-|:]+/, '').split(/\n|[\|]{2}|(?=\b[A-Z]{3,}-)/)[0].trim();
  return cleaned.slice(0, 80);
}

function renderExtractedItems(items) {
  const grid = $('extracted-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><p>Nessun articolo trovato con i pattern specificati</p><p class="sub">Prova a modificare il pattern del codice articolo</p></div>';
    return;
  }

  grid.innerHTML = items.map((item, i) => `
    <div class="extracted-card">
      ${item.image
        ? `<img class="extracted-img" src="${item.image}" alt="${esc(item.code)}" loading="lazy">`
        : `<div class="extracted-img-placeholder"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="24" height="24" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 20 L14 15 L18 18 L22 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>`
      }
      <div class="extracted-body">
        <div class="extracted-code">${esc(item.code)}</div>
        <div class="extracted-desc">${esc(item.desc) || '—'}</div>
        ${item.price !== null ? `<div class="extracted-price">€ ${item.price.toFixed(2).replace('.',',')}</div>` : '<div class="extracted-price" style="color:var(--text3)">Prezzo n/d</div>'}
        <div class="extracted-actions">
          <button class="btn-outline" onclick="editExtracted(${i})">Modifica</button>
          <button class="btn-primary" onclick="addToCatalogItem(${i})">+ Catalogo</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.editExtracted = function(i) {
  const item = state.extractedItems[i];
  const newCode = prompt('Codice articolo:', item.code);
  if (newCode !== null) { item.code = newCode.trim().toUpperCase(); }
  const newDesc = prompt('Descrizione:', item.desc);
  if (newDesc !== null) { item.desc = newDesc.trim(); }
  const newPrice = prompt('Prezzo:', item.price !== null ? item.price.toFixed(2) : '');
  if (newPrice !== null) { item.price = parseFloat(newPrice.replace(',','.')) || null; }
  renderExtractedItems(state.extractedItems);
};

window.addToCatalogItem = function(i) {
  const item = state.extractedItems[i];
  addToCatalog(item);
};

$('send-to-catalog').addEventListener('click', () => {
  state.extractedItems.forEach(addToCatalog);
  toast(`${state.extractedItems.length} articoli aggiunti al catalogo`, 'success');
  // Switch to catalog
  $$('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('[data-view="catalog"]').classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $('view-catalog').classList.add('active');
  renderCatalog();
});

// Export extracted
$('pdf-export-json').addEventListener('click', () => {
  const json = JSON.stringify(state.extractedItems, null, 2);
  downloadText(json, 'articoli_estratti.json', 'application/json');
  toast('JSON esportato', 'success');
});

$('pdf-export-csv').addEventListener('click', () => {
  if (!state.extractedItems.length) return;
  const headers = ['Codice','Descrizione','Prezzo','Pagina','Fonte'];
  const rows = state.extractedItems.map(i => [i.code, i.desc, i.price ?? '', i.page, i.source]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadText(csv, 'articoli_estratti.csv', 'text/csv');
  toast('CSV esportato', 'success');
});

// ── Catalog ────────────────────────────────────────────────────────────────
function addToCatalog(item) {
  if (state.catalog.find(c => c.code === item.code)) return; // no dupes
  state.catalog.push({ ...item });
  renderCatalog();
}

function renderCatalog(filter = '') {
  const grid = $('catalog-grid');
  const items = filter
    ? state.catalog.filter(i =>
        i.code.toLowerCase().includes(filter) ||
        (i.desc || '').toLowerCase().includes(filter)
      )
    : state.catalog;

  if (!items.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="8" y="6" width="32" height="36" rx="3" stroke="#00d4aa" stroke-width="1.5" opacity="0.5"/><line x1="15" y1="16" x2="33" y2="16" stroke="#00d4aa" stroke-width="1.5" opacity="0.4"/><line x1="15" y1="22" x2="33" y2="22" stroke="#00d4aa" stroke-width="1.5" opacity="0.3"/><line x1="15" y1="28" x2="25" y2="28" stroke="#00d4aa" stroke-width="1.5" opacity="0.2"/></svg>
        <p>${filter ? 'Nessun risultato per "' + esc(filter) + '"' : 'Catalogo vuoto'}</p>
        <p class="sub">${filter ? '' : 'Estrai articoli da un PDF o importa un file JSON'}</p>
      </div>`;
    return;
  }

  grid.innerHTML = items.map((item, i) => `
    <div class="extracted-card">
      ${item.image
        ? `<img class="extracted-img" src="${item.image}" alt="${esc(item.code)}" loading="lazy">`
        : `<div class="extracted-img-placeholder">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="24" height="24" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M10 20 L14 15 L18 18 L22 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
           </div>`
      }
      <div class="extracted-body">
        <div class="extracted-code">${esc(item.code)}</div>
        <div class="extracted-desc">${esc(item.desc) || '—'}</div>
        ${item.price !== null && item.price !== undefined
          ? `<div class="extracted-price">€ ${Number(item.price).toFixed(2).replace('.',',')}</div>`
          : '<div class="extracted-price" style="color:var(--text3)">Prezzo n/d</div>'
        }
        <div class="extracted-actions">
          <button class="btn-ghost" onclick="removeCatalogItem('${esc(item.code)}')">Elimina</button>
          <button class="btn-primary" onclick="addToQuote('${esc(item.code)}')">+ Prev.</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.removeCatalogItem = function(code) {
  state.catalog = state.catalog.filter(i => i.code !== code);
  renderCatalog($('catalog-search').value.toLowerCase());
};

$('catalog-search').addEventListener('input', e => {
  renderCatalog(e.target.value.toLowerCase());
});

$('import-catalog').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.csv';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      if (f.name.endsWith('.json')) {
        const items = JSON.parse(text);
        items.forEach(addToCatalog);
      } else {
        const rows = parseCSV(text);
        rows.forEach(r => addToCatalog({
          code: r['Codice'] || r['code'] || '',
          desc: r['Descrizione'] || r['description'] || '',
          price: parsePrice(r['Prezzo'] || r['price']),
          image: null,
          source: f.name
        }));
      }
      renderCatalog();
      toast('Catalogo importato', 'success');
    } catch(e) {
      toast('Errore importazione: ' + e.message, 'error');
    }
  };
  input.click();
});

// ── Quote ──────────────────────────────────────────────────────────────────
$('create-quote').addEventListener('click', () => {
  $('quote-panel').classList.toggle('hidden');
  renderQuote();
});

$('close-quote').addEventListener('click', () => {
  $('quote-panel').classList.add('hidden');
});

window.addToQuote = function(code) {
  const item = state.catalog.find(i => i.code === code);
  if (!item) return;
  const existing = state.quote.find(q => q.code === code);
  if (existing) { existing.qty++; }
  else { state.quote.push({ code: item.code, desc: item.desc, price: item.price || 0, qty: 1 }); }
  $('quote-panel').classList.remove('hidden');
  renderQuote();
  toast(`"${code}" aggiunto al preventivo`, 'success');
};

function renderQuote() {
  const items = $('quote-items');
  if (!state.quote.length) {
    items.innerHTML = '<p style="font-size:13px;color:var(--text3);text-align:center;padding:20px">Nessun articolo nel preventivo</p>';
    updateTotals();
    return;
  }

  items.innerHTML = state.quote.map((item, i) => `
    <div class="quote-item">
      <span class="qi-code">${esc(item.code)}</span>
      <span class="qi-desc">${esc(item.desc) || '—'}</span>
      <span class="qi-qty">
        <input type="number" min="1" value="${item.qty}" onchange="updateQty(${i}, this.value)" style="width:50px">
      </span>
      <span class="qi-price">€${(item.price * item.qty).toFixed(2).replace('.',',')}</span>
      <button class="qi-remove" onclick="removeQuoteItem(${i})">×</button>
    </div>
  `).join('');
  updateTotals();
}

window.updateQty = function(i, val) {
  state.quote[i].qty = Math.max(1, parseInt(val) || 1);
  renderQuote();
};

window.removeQuoteItem = function(i) {
  state.quote.splice(i, 1);
  renderQuote();
};

function updateTotals() {
  const sub = state.quote.reduce((s, i) => s + (i.price * i.qty), 0);
  const iva = sub * 0.22;
  const tot = sub + iva;
  $('q-subtotal').textContent = '€' + sub.toFixed(2).replace('.',',');
  $('q-iva').textContent = '€' + iva.toFixed(2).replace('.',',');
  $('q-total').textContent = '€' + tot.toFixed(2).replace('.',',');
}

$('print-quote').addEventListener('click', () => window.print());

$('export-quote').addEventListener('click', () => {
  const sub = state.quote.reduce((s, i) => s + i.price * i.qty, 0);
  const iva = sub * 0.22;
  const rows = [
    ['Codice','Descrizione','Prezzo Unitario','Quantità','Totale'],
    ...state.quote.map(i => [i.code, i.desc, i.price.toFixed(2), i.qty, (i.price*i.qty).toFixed(2)]),
    ['','','','Subtotale', sub.toFixed(2)],
    ['','','','IVA 22%', iva.toFixed(2)],
    ['','','','TOTALE', (sub+iva).toFixed(2)]
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const client = $('quote-client').value || 'Cliente';
  const ref = $('quote-ref').value || new Date().toLocaleDateString('it-IT');
  downloadText(csv, `preventivo_${client}_${ref}.csv`, 'text/csv');
  toast('Preventivo esportato', 'success');
});

// ── Utilities ──────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1048576).toFixed(1) + ' MB';
}

function downloadText(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setStatus(text, state = 'idle') {
  $('status-text').textContent = text;
  const dot = document.querySelector('.status-dot');
  dot.className = 'status-dot' + (state !== 'idle' ? ` ${state}` : '');
}

let toastTimer;
function toast(msg, type = 'info') {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast ${type}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Service Worker ─────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Init
setStatus('Pronto');
