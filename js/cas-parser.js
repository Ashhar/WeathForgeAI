/* ============================================================
   WealthForge AI — CAS (Consolidated Account Statement) parser
   Parses CAMS/KFintech CAS PDFs into structured MF holdings.
   Uses pdfjs-dist (already a dependency) for text extraction.
   ============================================================ */

const CASParser = (() => {
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseDate(str) {
    if (!str) return null;
    // DD-Mon-YYYY (e.g., "01-Jan-2023")
    const m1 = str.match(/(\d{1,2})-(\w{3})-(\d{4})/);
    if (m1) {
      const month = MONTHS[m1[2].toLowerCase()];
      if (month != null) return new Date(+m1[3], month, +m1[1]).toISOString().slice(0, 10);
    }
    // DD/MM/YYYY
    const m2 = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1]).toISOString().slice(0, 10);
    return null;
  }

  function parseNumber(str) {
    if (!str) return null;
    const cleaned = str.replace(/[₹,\s]/g, '').replace(/\(([^)]+)\)/, '-$1');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }

  async function extractTextFromPDF(file, password) {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: password || undefined });
    const pdf = await loadingTask.promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(' ');
      pages.push(text);
    }
    return pages.join('\n');
  }

  function parseCASText(text) {
    const lines = text.split('\n');
    const folios = [];
    let currentFolio = null;
    let currentScheme = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Detect folio number
      const folioMatch = line.match(/Folio\s*(?:No)?[.:\s]*([A-Z0-9/\s-]+?)(?:\s+PAN|\s*$)/i);
      if (folioMatch) {
        currentFolio = { number: folioMatch[1].trim(), schemes: [] };
        folios.push(currentFolio);
        continue;
      }

      // Detect scheme line (contains AMC identifiers or fund category keywords)
      if (currentFolio && isSchemeHeader(line)) {
        currentScheme = { name: cleanSchemeName(line), transactions: [], closingBalance: null, closingNAV: null, closingValue: null };
        currentFolio.schemes.push(currentScheme);
        continue;
      }

      // Detect transaction line (starts with a date)
      if (currentScheme) {
        const txn = parseTransactionLine(line);
        if (txn) {
          currentScheme.transactions.push(txn);
          continue;
        }

        // Detect closing/valuation line
        const valMatch = line.match(/Closing\s*(?:Unit)?\s*Balance[:\s]*([\d,.]+)/i);
        if (valMatch) {
          currentScheme.closingBalance = parseNumber(valMatch[1]);
          continue;
        }
        const navMatch = line.match(/NAV\s*(?:on\s*[\w\s,-]+)?[:\s]*([\d,.]+)/i);
        if (navMatch) {
          currentScheme.closingNAV = parseNumber(navMatch[1]);
          continue;
        }
        const valuation = line.match(/Valuation\s*(?:on\s*[\w\s,-]+)?[:\s]*(?:INR\s*)?[₹]?\s*([\d,.]+)/i);
        if (valuation) {
          currentScheme.closingValue = parseNumber(valuation[1]);
          continue;
        }
      }
    }

    return folios;
  }

  function isSchemeHeader(line) {
    const schemePatterns = [
      /(?:fund|growth|dividend|direct|regular|plan|option|idcw|reinvest)/i,
      /(?:equity|debt|liquid|balanced|hybrid|index|flexi|multi|large|mid|small)/i,
    ];
    const nonScheme = [/Folio/i, /^\d{2}-\w{3}-\d{4}/, /Closing/i, /Valuation/i, /NAV on/i, /Total/i, /Statement/i];
    if (nonScheme.some(p => p.test(line))) return false;
    if (line.length < 15 || line.length > 200) return false;
    return schemePatterns.some(p => p.test(line));
  }

  function cleanSchemeName(line) {
    return line
      .replace(/\s*-\s*(?:ISIN|Advisor|Registrar)[:\s].*/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function parseTransactionLine(line) {
    // Pattern: DD-Mon-YYYY <description> <amount> <units> <nav> <balance>
    const dateMatch = line.match(/^(\d{1,2}-\w{3}-\d{4})/);
    if (!dateMatch) return null;

    const date = parseDate(dateMatch[1]);
    if (!date) return null;

    const rest = line.slice(dateMatch[0].length).trim();
    // Try to extract numbers from the end (balance, nav, units, amount)
    const numbers = [];
    const numPattern = /(-?[\d,]+\.\d{2,4})/g;
    let m;
    while ((m = numPattern.exec(rest)) !== null) numbers.push(m[1]);

    if (numbers.length < 2) return null;

    // Last number is balance, second-to-last is NAV, then units, then amount
    const balance = parseNumber(numbers[numbers.length - 1]);
    const nav = numbers.length >= 3 ? parseNumber(numbers[numbers.length - 2]) : null;
    const units = numbers.length >= 3 ? parseNumber(numbers[numbers.length - 3]) : parseNumber(numbers[numbers.length - 2]);
    const amount = numbers.length >= 4 ? parseNumber(numbers[numbers.length - 4]) : null;

    // Extract description (text between date and first number)
    const firstNumIdx = rest.indexOf(numbers[0]);
    const description = rest.slice(0, firstNumIdx).trim();

    return { date, description, amount, units, nav, balance };
  }

  function casToAssets(folios) {
    const assets = [];

    for (const folio of folios) {
      for (const scheme of folio.schemes) {
        const lastTxn = scheme.transactions[scheme.transactions.length - 1];
        const units = scheme.closingBalance || (lastTxn ? lastTxn.balance : null);
        if (!units || units <= 0) continue;

        // Calculate cost basis from purchase transactions
        const purchases = scheme.transactions.filter(t =>
          t.units > 0 && t.amount > 0 &&
          /purchase|sip|switch\s*in|systematic/i.test(t.description || '')
        );
        const totalCost = purchases.reduce((s, t) => s + (t.amount || 0), 0);
        const totalUnits = purchases.reduce((s, t) => s + (t.units || 0), 0);
        const avgNav = totalUnits > 0 ? totalCost / totalUnits : (scheme.closingNAV || 0);

        // Detect SIP
        const sipTxns = purchases.filter(t => /sip|systematic/i.test(t.description || ''));
        const sipAmount = sipTxns.length >= 2 ? Math.round(sipTxns[sipTxns.length - 1].amount || 0) : null;
        const firstPurchase = purchases.length > 0 ? purchases[0].date : null;

        assets.push({
          type: 'mf',
          label: scheme.name,
          data: {
            schemeName: scheme.name,
            units: units,
            avgNav: Math.round(avgNav * 100) / 100,
            currentNav: scheme.closingNAV || avgNav,
            sipAmount: sipAmount,
            startDate: firstPurchase,
            folio: folio.number,
          },
          _meta: {
            source: 'CAS Import',
            closingValue: scheme.closingValue,
            transactionCount: scheme.transactions.length,
          }
        });
      }
    }

    return assets;
  }

  // Main entry: file → parsed assets ready for review
  async function parseFile(file, password) {
    const text = await extractTextFromPDF(file, password);
    const folios = parseCASText(text);
    return casToAssets(folios);
  }

  // UI: CAS import modal
  function openCASModal() {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Import CAS" style="max-width:560px">
      <h3>Import CAS PDF</h3>
      <p class="dim small" style="margin-bottom:14px">Upload your Consolidated Account Statement from CAMS or KFintech. All mutual fund holdings will be extracted.</p>
      <div class="field" style="margin-bottom:12px">
        <label for="cas_file">CAS PDF file</label>
        <input type="file" id="cas_file" accept=".pdf"/>
      </div>
      <div class="field" id="cas_pw_field" style="margin-bottom:14px;display:none">
        <label for="cas_pw">PDF Password</label>
        <input type="password" id="cas_pw" placeholder="Usually PAN + DOB (e.g., ABCDE1234F01011990)"/>
        <div class="hint">CAMS/KFintech PDFs are usually password-protected with your PAN followed by date of birth.</div>
      </div>
      <div id="cas_status" style="margin-bottom:14px"></div>
      <div id="cas_preview" style="margin-bottom:14px;display:none"></div>
      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="cas_parse" disabled>Parse PDF</button>
        <button class="btn primary" id="cas_import" style="display:none">Import All</button>
      </div>
    </div>`;
    document.body.appendChild(back);

    const fileInput = back.querySelector('#cas_file');
    const pwField = back.querySelector('#cas_pw_field');
    const parseBtn = back.querySelector('#cas_parse');
    const importBtn = back.querySelector('#cas_import');
    const status = back.querySelector('#cas_status');
    const preview = back.querySelector('#cas_preview');
    let parsedAssets = [];

    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());

    fileInput.addEventListener('change', () => {
      parseBtn.disabled = !fileInput.files.length;
      pwField.style.display = 'block';
    });

    parseBtn.addEventListener('click', async () => {
      parseBtn.disabled = true;
      parseBtn.textContent = 'Parsing...';
      status.innerHTML = '<span class="dim">Extracting text from PDF...</span>';

      try {
        const password = back.querySelector('#cas_pw').value || null;
        parsedAssets = await parseFile(fileInput.files[0], password);

        if (parsedAssets.length === 0) {
          status.innerHTML = '<span style="color:var(--neg)">No mutual fund holdings found. Make sure this is a CAS PDF.</span>';
          parseBtn.disabled = false;
          parseBtn.textContent = 'Parse PDF';
          return;
        }

        status.innerHTML = `<span style="color:var(--pos)">Found ${parsedAssets.length} mutual fund holding${parsedAssets.length > 1 ? 's' : ''}:</span>`;
        preview.style.display = 'block';
        preview.innerHTML = `<table class="cas-preview-table">
          <thead><tr><th>Scheme</th><th>Units</th><th>Avg NAV</th></tr></thead>
          <tbody>${parsedAssets.map(a => `<tr>
            <td>${a.label}</td>
            <td>${a.data.units.toFixed(3)}</td>
            <td>${Fin.fmtINR(a.data.avgNav)}</td>
          </tr>`).join('')}</tbody>
        </table>`;
        parseBtn.style.display = 'none';
        importBtn.style.display = '';
      } catch (err) {
        if (err.message && err.message.includes('password')) {
          status.innerHTML = '<span style="color:var(--neg)">PDF is password-protected. Please enter the password above.</span>';
          pwField.style.display = 'block';
        } else {
          status.innerHTML = `<span style="color:var(--neg)">Error: ${err.message || 'Could not parse PDF'}</span>`;
        }
        parseBtn.disabled = false;
        parseBtn.textContent = 'Parse PDF';
      }
    });

    importBtn.addEventListener('click', () => {
      if (Store.isReadOnly()) { UI.toast('Demo is read-only'); return; }
      let imported = 0;
      for (const asset of parsedAssets) {
        Store.add(asset);
        imported++;
      }
      back.remove();
      UI.toast(`Imported ${imported} mutual fund holding${imported > 1 ? 's' : ''}`);
      Router.go('/holdings/mf');
    });
  }

  return { parseFile, parseCASText, casToAssets, openCASModal };
})();

if (typeof globalThis !== 'undefined') globalThis.CASParser = CASParser;
