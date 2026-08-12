/* ============================================================
   WealthForge AI — AI-powered universal import
   Upload any portfolio statement (CSV, XLS, XLSX, PDF) → LLM
   extracts holdings → match against masters → user reviews →
   import. Supports ALL asset types.

   Dependencies: pdfjs-dist (PDF), xlsx (Excel), @google/generative-ai
   Env: VITE_GEMINI_API_KEY
   ============================================================ */

const AIImport = (() => {
  const API_KEY = import.meta.env?.VITE_GEMINI_API_KEY || '';
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  let availableModels = null;
  let selectedModel = null;
  const MODEL_FALLBACKS = ['gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-exp'];
  let fallbackIndex = -1;

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const TYPE_LABELS = {
    equity: 'Stocks', mf: 'Mutual Funds', crypto: 'Crypto',
    fd: 'Fixed Deposits', gold: 'Gold / Silver', epf: 'EPF',
    ppf: 'PPF', nps: 'NPS', smallsavings: 'Small Savings', esop: 'ESOPs',
  };

  // ---- Discover available models dynamically ----
  async function discoverModel() {
    if (selectedModel) return selectedModel;
    if (!API_KEY) throw new Error('VITE_GEMINI_API_KEY not configured');

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`,
        { method: 'GET' }
      );
      if (!response.ok) throw new Error(`Model discovery failed: ${response.status}`);

      const data = await response.json();
      availableModels = data.models || [];
      const suitableModels = availableModels.filter(m =>
        m.supportedGenerationMethods?.includes('generateContent')
      );
      if (suitableModels.length === 0) throw new Error('No suitable models found');

      const prefs = [/gemini.*flash.*latest/i, /gemini.*flash/i, /gemini.*pro.*latest/i, /gemini.*pro/i, /gemini/i];
      for (const pattern of prefs) {
        const found = suitableModels.find(m => pattern.test(m.name));
        if (found) { selectedModel = found.name.replace('models/', ''); return selectedModel; }
      }
      selectedModel = suitableModels[0].name.replace('models/', '');
      return selectedModel;
    } catch (err) {
      console.error('[AI Import] Model discovery failed:', err);
      selectedModel = MODEL_FALLBACKS[0];
      fallbackIndex = 0;
      return selectedModel;
    }
  }

  function switchToNextModel() {
    fallbackIndex++;
    if (fallbackIndex < MODEL_FALLBACKS.length) {
      selectedModel = MODEL_FALLBACKS[fallbackIndex];
      return selectedModel;
    }
    return null;
  }

  // ---- File text extraction ----
  async function extractTextFromPDF(arrayBuffer) {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const textPages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      textPages.push(textContent.items.map(item => item.str).join(' '));
    }
    return textPages.join('\n\n--- PAGE BREAK ---\n\n');
  }

  async function extractTextFromExcel(arrayBuffer) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    const sheets = [];
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      if (csv.trim()) sheets.push(`--- Sheet: ${name} ---\n${csv}`);
    }
    return sheets.join('\n\n');
  }

  // ---- CAS detection ----
  function detectCASFormat(text) {
    const upper = text.toUpperCase();
    if (upper.includes('CAMS') || upper.includes('COMPUTER AGE MANAGEMENT')) return 'CAMS';
    if (upper.includes('KFINTECH') || upper.includes('KARVY')) return 'KFintech';
    return null;
  }

  function chunkCASByFolio(text) {
    const lines = text.split('\n');
    const chunks = [];
    let currentChunk = [];
    for (const line of lines) {
      if (/folio\s*no[:\s]/i.test(line) && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [line];
      } else {
        currentChunk.push(line);
      }
    }
    if (currentChunk.length > 0) chunks.push(currentChunk.join('\n'));
    return chunks.length > 1 ? chunks : [text];
  }

  // ---- Key attributes reference per asset type ----
  // These are the field names the AI should look for / extract from uploaded files.
  const KEY_ATTRIBUTES = {
    equity: {
      required: ['symbol', 'quantity', 'date'],
      optional: ['avg_price', 'total_invested', 'current_price', 'current_value', 'isin', 'label'],
      description: 'Stock ticker (NSE/BSE symbol), number of shares, buy date. Either avg_price or total_invested needed for cost basis.',
    },
    mf: {
      required: ['scheme_name OR scheme_code', 'units', 'date'],
      optional: ['avg_nav', 'current_nav', 'total_invested', 'current_value', 'plan', 'option', 'folio', 'isin'],
      description: 'Mutual fund scheme (AMFI code or full name), units held, investment date. Plan: Direct/Regular. Option: Growth/IDCW.',
    },
    crypto: {
      required: ['coin', 'quantity', 'date'],
      optional: ['avg_price', 'total_invested', 'currency', 'wallet', 'label'],
      description: 'Coin symbol (BTC/ETH/SOL etc.), quantity, buy date. Price in USD unless currency=INR.',
    },
    fd: {
      required: ['principal', 'rate', 'start_date', 'tenure_years OR maturity_date'],
      optional: ['bank', 'compounding', 'interest_type', 'label'],
      description: 'Deposit amount, interest rate % p.a., booking date, and either tenure in years or maturity date. Compounding: quarterly/monthly/half-yearly/annual/simple.',
    },
    gold: {
      required: ['date'],
      optional: ['metal', 'form', 'grams', 'purity', 'buy_rate', 'units', 'buy_price', 'total_paid', 'name', 'label'],
      description: 'Purchase date. For physical/digital: grams + purity (24K/22K/18K). For ETF/SGB: units + buy_price. Metal: gold/silver. Form: physical/digital/sgb/etf.',
    },
    epf: {
      required: ['balance', 'as_of_date', 'start_date'],
      optional: ['emp_contribution', 'er_contribution', 'rate', 'current_age', 'retirement_age', 'uan'],
      description: 'EPF statement balance, statement date, account start date. Monthly employee/employer contributions for projection.',
    },
    ppf: {
      required: ['balance', 'as_of_date', 'open_date', 'annual_contribution'],
      optional: ['rate', 'extension_years', 'label'],
      description: 'PPF balance, balance date, account opening date, annual contribution (max ₹1.5L).',
    },
    nps: {
      required: ['corpus', 'as_of_date', 'monthly_contribution', 'start_date'],
      optional: ['alloc_e', 'alloc_c', 'alloc_g', 'tier', 'pran'],
      description: 'NPS corpus value, statement date, monthly contribution, start date. Allocation: equity(E) + corporate(C) + govt(G) must = 100%.',
    },
    smallsavings: {
      required: ['scheme', 'rate', 'tenure_years', 'start_date'],
      optional: ['principal', 'monthly_amount', 'annual_contribution', 'balance', 'label'],
      description: 'Scheme type: rd/ssy/kvp/nsc/pomis/potd. Rate and tenure. RD needs monthly_amount; SSY needs annual_contribution; others need principal.',
    },
    esop: {
      required: ['company', 'total_units', 'vest_start'],
      optional: ['grant_type', 'cliff_months', 'duration_months', 'frequency', 'ticker', 'strike', 'share_price', 'currency', 'private', 'label'],
      description: 'Company name, total granted units, vesting start date. Grant type: RSU/ISO/NSO. Ticker for listed companies or share_price for private.',
    },
  };

  // ---- Universal extraction prompt ----
  function buildExtractionPrompt(hintType) {
    const typeHint = hintType ? `\nThe user expects these to be "${hintType}" (${TYPE_LABELS[hintType] || hintType}) assets. Prioritize mapping to this type, but if the data clearly belongs to a different type, use the correct one.\n` : '';

    return `You are a financial portfolio import assistant. Analyze this document and extract holdings into structured JSON.

Output ONLY valid JSON matching this schema:
{
  "asset_type": "equity|mf|crypto|fd|gold|epf|ppf|nps|smallsavings|esop",
  "holdings": [
    {
      // EQUITY fields:
      "symbol": "stock ticker (NSE/BSE)",
      "quantity": number,
      "avg_price": number or null,
      "current_price": number or null,
      "total_invested": number or null,
      "current_value": number or null,
      "isin": "string or null",

      // MUTUAL FUND fields:
      "scheme_name": "full scheme name",
      "scheme_code": "AMFI 5-6 digit code or null",
      "units": number,
      "avg_nav": number or null,
      "current_nav": number or null,
      "plan": "Direct or Regular or null",
      "option": "Growth or IDCW or null",
      "folio": "string or null",

      // CRYPTO fields:
      "coin": "BTC/ETH/SOL etc.",
      "wallet": "exchange/wallet name or null",
      "currency": "USD or INR",

      // FD fields:
      "principal": number,
      "rate": number (% p.a.),
      "tenure_years": number or null,
      "maturity_date": "YYYY-MM-DD or null",
      "bank": "institution name or null",
      "compounding": "quarterly/monthly/half-yearly/annual/simple or null",
      "interest_type": "cumulative or payout or null",

      // GOLD fields:
      "metal": "gold or silver",
      "form": "physical/digital/sgb/etf",
      "grams": number or null,
      "purity": "24K/22K/18K or null",
      "buy_rate": number (rate per gram) or null,
      "buy_price": number (price per unit for ETF/SGB) or null,
      "total_paid": number or null,

      // EPF fields:
      "balance": number,
      "as_of_date": "YYYY-MM-DD",
      "emp_contribution": number or null,
      "er_contribution": number or null,
      "current_age": number or null,
      "retirement_age": number or null,
      "uan": "string or null",

      // PPF fields:
      "annual_contribution": number,
      "open_date": "YYYY-MM-DD",

      // NPS fields:
      "corpus": number,
      "monthly_contribution": number,
      "alloc_e": number (equity %),
      "alloc_c": number (corporate debt %),
      "alloc_g": number (govt securities %),
      "tier": "I or II",
      "pran": "string or null",

      // SMALL SAVINGS fields:
      "scheme": "rd/ssy/kvp/nsc/pomis/potd",
      "monthly_amount": number (for RD),

      // ESOP fields:
      "company": "string",
      "grant_type": "RSU/ISO/NSO",
      "total_units": number,
      "vest_start": "YYYY-MM-DD",
      "cliff_months": number or null,
      "duration_months": number or null,
      "frequency": "monthly/quarterly/annual or null",
      "ticker": "listed stock symbol or null",
      "strike": number (for options) or null,
      "share_price": number (for private cos) or null,
      "private": boolean,

      // COMMON fields (all types):
      "date": "YYYY-MM-DD (acquisition/start date)",
      "start_date": "YYYY-MM-DD (for EPF/PPF/NPS/FD)",
      "label": "optional user nickname"
    }
  ]
}
${typeHint}
Rules:
1. Identify the asset type from the document content
2. Map columns/fields flexibly (handle any naming convention from any broker/platform)
3. Extract ALL data rows (skip totals/summaries/headers)
4. Normalize ALL dates to YYYY-MM-DD format
5. Use null for missing/unknown fields — do NOT invent data
6. For mutual funds: extract scheme name AND code if visible; plan must be "Direct" or "Regular"; option must be "Growth" or "IDCW"
7. For stocks: use NSE/BSE ticker symbols (e.g., RELIANCE not "Reliance Industries")
8. For FDs: rate is percentage (e.g., 7.25 not 0.0725)
9. For NPS: alloc_e + alloc_c + alloc_g must sum to 100
10. Skip summary/total rows (Total, Grand Total, Net Total, etc.)
11. Map "current value"/"market value" → current_value; "invested"/"cost" → total_invested
12. Output MUST be valid JSON only, no explanatory text

Common platform formats:
- TickerTape MF: "Fund Name", "Plan Type", "Option Type", "NAV ₹", "Units", "Invested Amt ₹"
- Zerodha: "Symbol/Instrument", "Quantity", "Average Cost", "LTP", "Current Value"
- Groww: "Scheme Name", "Invested Amount", "Current Value", "Units"
- Kuvera: "Scheme", "Units", "Current NAV", "Amount Invested"
- CAS PDF: folio-based, scheme name + units + NAV + cost
- Bank FD statements: principal, rate, tenure, maturity date
- EPF passbook: balance, employer/employee contributions
- NPS SOT: corpus, allocation percentages
- Broker equity: symbol, qty, avg price, LTP`;
  }

  // ---- Call Gemini API ----
  async function callGemini(prompt) {
    if (!API_KEY) throw new Error('VITE_GEMINI_API_KEY not configured — set it in .env to enable AI import');
    let modelName = await discoverModel();
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(API_KEY);

    while (true) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI did not return valid JSON');
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.asset_type || !parsed.holdings || !Array.isArray(parsed.holdings)) {
          throw new Error('AI response missing required fields (asset_type or holdings)');
        }
        const tokens = Math.ceil(prompt.length / 4) + Math.ceil(responseText.length / 4);
        return { data: parsed, model: modelName, tokens };
      } catch (err) {
        if (err.message?.includes('API key') || err.message?.includes('401')) {
          throw new Error('Invalid Gemini API key — check VITE_GEMINI_API_KEY in .env');
        }
        if (err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('rate')) {
          const next = switchToNextModel();
          if (next) { modelName = next; continue; }
        }
        throw new Error(`AI extraction error (${modelName}): ${err.message}`);
      }
    }
  }

  // ---- Match holdings against masters (MF + Equity) ----
  async function matchHoldings(holdings, assetType) {
    const supa = globalThis.Supa?.client;
    const matched = [];

    for (const holding of holdings) {
      let matchedScheme = null;
      let matchedStock = null;
      let confidence = 'high';

      if (assetType === 'mf') {
        if (!supa) {
          if (holding.scheme_code) {
            const s = Market.getScheme(holding.scheme_code);
            if (s) matchedScheme = { scheme_code: holding.scheme_code, name: s.name, nav: s.nav, plan: s.plan, option: s.option };
          }
          confidence = matchedScheme ? 'high' : 'low';
        } else {
          // ISIN match
          if (holding.isin) {
            const { data } = await supa.from('mf_master')
              .select('scheme_code,name,amc,plan,option,isin,nav,nav_date')
              .eq('isin', holding.isin).limit(1).single();
            if (data) { matchedScheme = data; confidence = 'high'; }
          }
          // Scheme code match
          if (!matchedScheme && holding.scheme_code) {
            const { data } = await supa.from('mf_master')
              .select('scheme_code,name,amc,plan,option,isin,nav,nav_date')
              .eq('scheme_code', holding.scheme_code).limit(1).single();
            if (data) { matchedScheme = data; confidence = 'high'; }
          }
          // Fuzzy name match with plan/option filtering
          if (!matchedScheme && holding.scheme_name) {
            const { data } = await supa.rpc('search_mf', { q: holding.scheme_name.slice(0, 50), max_results: 10 });
            if (data && data.length > 0) {
              const plan = (holding.plan || '').toLowerCase();
              const option = (holding.option || '').toLowerCase();
              let best = data[0];
              if (plan || option) {
                const filtered = data.filter(s => {
                  const nameL = (s.name || '').toLowerCase();
                  const planMatch = !plan || (s.plan || '').toLowerCase().includes(plan) || nameL.includes(plan);
                  const optionMatch = !option || (s.option || '').toLowerCase().includes(option) || nameL.includes(option);
                  return planMatch && optionMatch;
                });
                if (filtered.length > 0) best = filtered[0];
              }
              matchedScheme = best;
              confidence = (plan || option) ? 'high' : 'medium';
            }
          }
          if (!matchedScheme) confidence = 'low';
        }
      } else if (assetType === 'equity') {
        const sym = (holding.symbol || '').toUpperCase();
        if (!sym) { confidence = 'low'; }
        else if (!supa) {
          const s = Market.getStock(sym);
          if (s) matchedStock = { symbol: s.symbol, name: s.name, price: s.price, exchange: s.exchange, isin: s.isin };
          else confidence = 'low';
        } else {
          const { data } = await supa.from('equity_master')
            .select('exchange,symbol,name,isin').eq('symbol', sym).limit(1);
          if (data && data.length > 0) {
            const r = data[0];
            matchedStock = { symbol: r.symbol, name: r.name, isin: r.isin, exchange: r.exchange, price: Market.getStock(r.symbol)?.price || null };
            confidence = 'high';
          } else { confidence = 'low'; }
        }
      } else if (assetType === 'crypto') {
        const coinId = (holding.coin || '').toUpperCase();
        const c = Market.getCoin(coinId);
        if (!c) confidence = 'low';
      }
      // Other types don't need master matching — data is self-contained

      matched.push({ ...holding, matched_scheme: matchedScheme, matched_stock: matchedStock, confidence });
    }
    return matched;
  }

  // ---- Process file ----
  async function processFile(file, hintType) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)} MB) — 10 MB max`);
    }

    const name = file.name.toLowerCase();
    const isCSV = file.type === 'text/csv' || name.endsWith('.csv');
    const isPDF = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isExcel = name.endsWith('.xls') || name.endsWith('.xlsx') || file.type.includes('spreadsheet') || file.type.includes('excel');

    if (!isCSV && !isPDF && !isExcel) {
      throw new Error('Unsupported file type — upload CSV, XLS, XLSX, or PDF');
    }

    let extractedText;
    let fileType;

    if (isCSV) {
      extractedText = await file.text();
      if (!extractedText || extractedText.trim().length < 20) throw new Error('File appears empty');
      fileType = 'csv';
    } else if (isExcel) {
      const arrayBuffer = await file.arrayBuffer();
      extractedText = await extractTextFromExcel(arrayBuffer);
      if (!extractedText || extractedText.trim().length < 20) throw new Error('Spreadsheet appears empty');
      fileType = 'excel';
    } else {
      const arrayBuffer = await file.arrayBuffer();
      extractedText = await extractTextFromPDF(arrayBuffer);
      if (!extractedText || extractedText.trim().length < 100) {
        throw new Error('PDF appears empty or scanned — text-based PDFs only (OCR not yet supported)');
      }
      fileType = 'pdf';
    }

    // For CAS PDFs, use chunked extraction
    const isCAS = fileType === 'pdf' && detectCASFormat(extractedText);
    let allHoldings = [];
    let assetType = hintType || 'mf';
    const errors = [];
    let totalTokens = 0;
    let usedModel = null;

    if (isCAS) {
      const chunks = chunkCASByFolio(extractedText);
      for (let i = 0; i < chunks.length; i++) {
        try {
          const prompt = `${buildExtractionPrompt('mf')}\n\nExtract mutual fund holdings from this CAS excerpt:\n\n${chunks[i].slice(0, 50000)}`;
          const result = await callGemini(prompt);
          allHoldings.push(...result.data.holdings);
          totalTokens += result.tokens;
          if (!usedModel) usedModel = result.model;
        } catch (err) { errors.push({ chunk: i + 1, error: err.message }); }
      }
      assetType = 'mf';
      if (allHoldings.length === 0 && errors.length > 0) {
        throw new Error(`Extraction failed: ${errors[0].error}`);
      }
    } else {
      const prompt = `${buildExtractionPrompt(hintType)}\n\nDocument content:\n\n${extractedText.slice(0, 100000)}`;
      const result = await callGemini(prompt);
      allHoldings = result.data.holdings || [];
      assetType = result.data.asset_type || hintType || 'mf';
      totalTokens = result.tokens;
      usedModel = result.model;
    }

    const matched = await matchHoldings(allHoldings, assetType);

    const jobData = {
      filename: file.name,
      file_type: fileType,
      input_format: isCAS || null,
      asset_type: assetType,
      extracted_data: { holdings: allHoldings },
      extraction_model: usedModel,
      extraction_tokens: totalTokens,
      extraction_errors: errors.length > 0 ? errors : null,
      matched_holdings: matched,
      low_confidence_ids: matched.filter(m => m.confidence === 'low').map((_, i) => String(i)),
      status: 'pending',
    };

    if (globalThis.Supa?.client) {
      const { data, error } = await globalThis.Supa.client
        .from('import_jobs').insert([jobData]).select().single();
      if (!error && data) return { ...jobData, id: data.id };
    }
    return { ...jobData, id: crypto.randomUUID() };
  }

  // ---- Review modal ----
  function openReviewModal(job, onConfirm) {
    const matched = job.matched_holdings || [];
    const lowConf = new Set(job.low_confidence_ids || []);
    const assetType = job.asset_type || 'mf';
    const typeLabel = TYPE_LABELS[assetType] || assetType;

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Review AI Import" style="max-width:920px;width:95vw">
      <h3>📄 Review import — ${esc(job.filename)}</h3>
      <p class="small dim" style="margin-bottom:12px">
        Extracted ${matched.length} ${typeLabel.toLowerCase()} holding${matched.length !== 1 ? 's' : ''}.
        ${job.extraction_errors ? `<span style="color:var(--neg)">⚠️ ${job.extraction_errors.length} chunk(s) had errors.</span>` : ''}
        Review and edit before importing.
      </p>
      <div id="ai_import_preview" style="max-height:400px;overflow:auto;margin-bottom:12px"></div>
      <div class="hint" style="margin-bottom:12px">
        <b>Low-confidence matches</b> are flagged in yellow — verify before importing.
      </div>
      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="ai_import_confirm">Import ${matched.length} holding${matched.length !== 1 ? 's' : ''}</button>
      </div>
    </div>`;

    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());

    const previewEl = back.querySelector('#ai_import_preview');
    previewEl.innerHTML = buildPreviewTable(matched, assetType, lowConf);

    back.querySelector('#ai_import_confirm').addEventListener('click', async () => {
      back.remove();
      if (onConfirm) await onConfirm(job, matched);
    });
  }

  function buildPreviewTable(matched, assetType, lowConf) {
    const rowClass = (i) => lowConf.has(String(i)) ? 'style="background:var(--warn-bg,#fff3cd)"' : '';
    const icon = (i) => lowConf.has(String(i)) ? '⚠️' : '✅';
    let headers, rowFn;

    switch (assetType) {
      case 'equity':
        headers = '<th></th><th>Stock</th><th class="num">Qty</th><th class="num">Avg Price</th><th class="num">Value</th>';
        rowFn = (m, i) => {
          const name = m.matched_stock ? `${esc(m.matched_stock.symbol)} — ${esc(m.matched_stock.name)}` : `<span style="color:var(--neg)">❌ ${esc(m.symbol || '?')}</span>`;
          const val = m.total_invested || ((m.quantity || 0) * (m.avg_price || 0));
          return `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${name}</td><td class="num">${m.quantity || '—'}</td><td class="num">${m.avg_price ? `₹${m.avg_price.toFixed(2)}` : '—'}</td><td class="num">${val ? Fin.fmtINR(val, { compact: true }) : '—'}</td></tr>`;
        };
        break;
      case 'mf':
        headers = '<th></th><th>Scheme</th><th class="num">Units</th><th class="num">NAV</th><th class="num">Value</th><th>Folio</th>';
        rowFn = (m, i) => {
          const name = m.matched_scheme ? `${esc(m.matched_scheme.name)} ${m.plan ? `(${m.plan})` : ''}` : `<span style="color:var(--neg)">❌ ${esc(m.scheme_name || '?')}</span>`;
          const nav = m.matched_scheme?.nav || m.current_nav;
          const val = nav && m.units ? m.units * nav : m.current_value;
          return `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${name}</td><td class="num">${m.units?.toFixed(3) || '—'}</td><td class="num">${nav ? `₹${nav.toFixed(2)}` : '—'}</td><td class="num">${val ? Fin.fmtINR(val, { compact: true }) : '—'}</td><td class="small dim">${m.folio || '—'}</td></tr>`;
        };
        break;
      case 'crypto':
        headers = '<th></th><th>Coin</th><th class="num">Qty</th><th class="num">Avg Price</th><th class="num">Invested</th>';
        rowFn = (m, i) => {
          const c = Market.getCoin((m.coin || '').toUpperCase());
          const name = c ? `${esc(m.coin)} — ${esc(c.name)}` : `<span style="color:var(--neg)">❌ ${esc(m.coin || '?')}</span>`;
          return `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${name}</td><td class="num">${m.quantity || '—'}</td><td class="num">${m.avg_price ? `$${m.avg_price.toFixed(2)}` : '—'}</td><td class="num">${m.total_invested ? `$${m.total_invested.toFixed(0)}` : '—'}</td></tr>`;
        };
        break;
      case 'fd':
        headers = '<th></th><th>Bank / Label</th><th class="num">Principal</th><th class="num">Rate</th><th>Tenure</th><th>Start</th>';
        rowFn = (m, i) => `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc(m.bank || m.label || 'FD')}</td><td class="num">${m.principal ? Fin.fmtINR(m.principal, { compact: true }) : '—'}</td><td class="num">${m.rate ? m.rate + '%' : '—'}</td><td>${m.tenure_years ? m.tenure_years + 'y' : '—'}</td><td class="small dim">${m.start_date || m.date || '—'}</td></tr>`;
        break;
      case 'gold':
        headers = '<th></th><th>Form</th><th class="num">Grams/Units</th><th>Purity</th><th class="num">Paid</th><th>Date</th>';
        rowFn = (m, i) => {
          const qty = m.grams ? `${m.grams}g` : (m.units ? `${m.units} units` : '—');
          return `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc((m.metal || 'gold') + ' · ' + (m.form || 'physical'))}</td><td class="num">${qty}</td><td>${m.purity || '—'}</td><td class="num">${m.total_paid ? Fin.fmtINR(m.total_paid, { compact: true }) : '—'}</td><td class="small dim">${m.date || '—'}</td></tr>`;
        };
        break;
      case 'epf':
        headers = '<th></th><th>Account</th><th class="num">Balance</th><th>As of</th><th class="num">Emp ₹/m</th><th>Start</th>';
        rowFn = (m, i) => `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc(m.uan || m.label || 'EPF')}</td><td class="num">${m.balance ? Fin.fmtINR(m.balance, { compact: true }) : '—'}</td><td class="small dim">${m.as_of_date || '—'}</td><td class="num">${m.emp_contribution || '—'}</td><td class="small dim">${m.start_date || m.date || '—'}</td></tr>`;
        break;
      case 'ppf':
        headers = '<th></th><th>Account</th><th class="num">Balance</th><th>As of</th><th class="num">Annual</th><th>Opened</th>';
        rowFn = (m, i) => `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc(m.label || 'PPF')}</td><td class="num">${m.balance ? Fin.fmtINR(m.balance, { compact: true }) : '—'}</td><td class="small dim">${m.as_of_date || '—'}</td><td class="num">${m.annual_contribution ? Fin.fmtINR(m.annual_contribution, { compact: true }) : '—'}</td><td class="small dim">${m.open_date || m.date || '—'}</td></tr>`;
        break;
      case 'nps':
        headers = '<th></th><th>Account</th><th class="num">Corpus</th><th>As of</th><th class="num">Monthly</th><th>Alloc</th>';
        rowFn = (m, i) => `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc(m.pran || m.label || 'NPS')}</td><td class="num">${m.corpus ? Fin.fmtINR(m.corpus, { compact: true }) : '—'}</td><td class="small dim">${m.as_of_date || '—'}</td><td class="num">${m.monthly_contribution ? Fin.fmtINR(m.monthly_contribution, { compact: true }) : '—'}</td><td class="small dim">E${m.alloc_e || '?'}/C${m.alloc_c || '?'}/G${m.alloc_g || '?'}</td></tr>`;
        break;
      case 'smallsavings':
        headers = '<th></th><th>Scheme</th><th class="num">Amount</th><th class="num">Rate</th><th>Tenure</th><th>Start</th>';
        rowFn = (m, i) => {
          const amt = m.principal || m.monthly_amount || m.annual_contribution || 0;
          return `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc((m.scheme || '?').toUpperCase())}</td><td class="num">${amt ? Fin.fmtINR(amt, { compact: true }) : '—'}</td><td class="num">${m.rate ? m.rate + '%' : '—'}</td><td>${m.tenure_years ? m.tenure_years + 'y' : '—'}</td><td class="small dim">${m.start_date || m.date || '—'}</td></tr>`;
        };
        break;
      case 'esop':
        headers = '<th></th><th>Company</th><th>Type</th><th class="num">Units</th><th>Vest Start</th><th>Duration</th>';
        rowFn = (m, i) => `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc(m.company || '?')}</td><td>${m.grant_type || 'RSU'}</td><td class="num">${m.total_units || '—'}</td><td class="small dim">${m.vest_start || m.date || '—'}</td><td>${m.duration_months ? m.duration_months + 'mo' : '—'}</td></tr>`;
        break;
      default:
        headers = '<th></th><th>Item</th><th class="num">Value</th><th>Date</th>';
        rowFn = (m, i) => `<tr ${rowClass(i)}><td>${icon(i)}</td><td class="asset-name small">${esc(m.label || m.scheme_name || m.symbol || '—')}</td><td class="num">${m.current_value ? Fin.fmtINR(m.current_value, { compact: true }) : '—'}</td><td class="small dim">${m.date || '—'}</td></tr>`;
    }

    const rows = matched.map((m, i) => rowFn(m, i)).join('');
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  // ---- Commit holdings to Store ----
  async function commitHoldings(job, matched) {
    if (Store.isReadOnly()) {
      UI.toast('Demo data is read-only — sign up to import your portfolio');
      return;
    }

    const assetType = job.asset_type || 'mf';
    const assetsToAdd = matched.map(m => buildAsset(m, assetType, job.filename)).filter(Boolean);

    const assetIds = [];
    for (const asset of assetsToAdd) {
      const added = Store.add(asset);
      assetIds.push(added.id);
    }

    if (globalThis.Supa?.client && job.id) {
      await globalThis.Supa.client.from('import_jobs').update({
        status: 'committed', reviewed_at: new Date().toISOString(),
        committed_at: new Date().toISOString(), committed_asset_ids: assetIds,
      }).eq('id', job.id);
    }

    const skipped = matched.length - assetsToAdd.length;
    UI.toast(`${assetsToAdd.length} holdings imported${skipped > 0 ? `, ${skipped} skipped (incomplete data)` : ''}`);
    Router.go(`/holdings/${assetType === 'smallsavings' ? 'smallsavings' : assetType}`);
  }

  function buildAsset(m, assetType, filename) {
    const today = new Date().toISOString().slice(0, 10);
    const base = { ownership: 'single', sharePct: 100, tags: ['imported', 'ai'], notes: `Imported from ${filename}` };

    switch (assetType) {
      case 'equity': {
        const stock = m.matched_stock;
        if (!stock) return null;
        const avgPrice = m.avg_price || (m.total_invested && m.quantity ? m.total_invested / m.quantity : stock.price || 100);
        return { ...base, type: 'equity', label: m.label || stock.symbol,
          acquiredOn: m.date || today, currency: 'INR',
          data: { symbol: stock.symbol, quantity: m.quantity || 0, avgPrice,
            totalInvested: m.total_invested || ((m.quantity || 0) * avgPrice),
            lastPrice: m.current_price || stock.price || avgPrice, isin: stock.isin || undefined } };
      }
      case 'mf': {
        const scheme = m.matched_scheme;
        if (!scheme) return null;
        const navFromFile = m.current_nav || m.nav;
        const lastNav = navFromFile || scheme.nav || 100;
        const avgNav = m.avg_nav || (m.total_invested && m.units ? m.total_invested / m.units : lastNav);
        return { ...base, type: 'mf', label: scheme.name,
          acquiredOn: m.date || today, currency: 'INR',
          data: { schemeCode: scheme.scheme_code, schemeName: scheme.name,
            plan: m.plan || scheme.plan || 'Direct', option: m.option || scheme.option || 'Growth',
            units: m.units || 0, avgNav, totalInvested: m.total_invested || m.invested || ((m.units || 0) * avgNav),
            lastNav, folio: m.folio || undefined } };
      }
      case 'crypto': {
        const coinId = (m.coin || '').toUpperCase();
        const c = Market.getCoin(coinId);
        if (!c) return null;
        return { ...base, type: 'crypto', label: m.label || coinId,
          acquiredOn: m.date || today, currency: 'USD',
          data: { coinId, quantity: m.quantity || 0, avgPrice: m.avg_price || 0,
            totalInvested: m.total_invested || ((m.quantity || 0) * (m.avg_price || 0)),
            investCurrency: (m.currency || 'USD').toUpperCase(), wallet: m.wallet || undefined, stable: !!c.stable } };
      }
      case 'fd': {
        const principal = m.principal;
        if (!principal || !m.rate) return null;
        const start = m.start_date || m.date || today;
        const tenure = m.tenure_years || (m.maturity_date ? Fin.fdTenureYears(start, m.maturity_date) : null);
        if (!tenure) return null;
        const comp = (m.compounding || 'quarterly').toLowerCase();
        return { ...base, type: 'fd', label: m.label || `${m.bank || 'FD'} · ${m.rate}%`,
          acquiredOn: start, currency: 'INR',
          data: { principal, rate: m.rate, startDate: start, tenureYears: tenure,
            compounding: ['quarterly', 'monthly', 'half-yearly', 'annual', 'simple'].includes(comp) ? comp : 'quarterly',
            interestType: /^payout|non/i.test(m.interest_type || '') ? 'payout' : 'cumulative',
            bank: m.bank || undefined, institutionType: 'bank', payoutFreq: 'quarterly',
            autoRenew: 'none', status: 'active', taxSaver: false, seniorRate: false, tds: true } };
      }
      case 'gold': {
        const metal = /^sil/i.test(m.metal || '') ? 'silver' : 'gold';
        const form = /^(physical|digital|sgb|etf)$/i.test(m.form || '') ? m.form.toLowerCase() : 'physical';
        const date = m.date || today;
        const data = { metal, form };
        if (form === 'etf' || form === 'sgb') {
          data.units = m.units || 0;
          data.buyPrice = m.buy_price || undefined;
          if (form === 'sgb') { data.sgbIssue = m.name || ''; data.sgbRate = 2.5; } else data.etfName = m.name || '';
          if (!data.units) return null;
        } else {
          data.grams = m.grams || 0;
          data.purity = /^(24K|22K|18K)$/i.test(m.purity || '') ? m.purity.toUpperCase() : (form === 'physical' ? '22K' : '24K');
          data.buyRate = m.buy_rate || undefined;
          if (!data.grams) return null;
        }
        data.totalPaid = m.total_paid || undefined;
        return { ...base, type: 'gold', label: m.label || `${metal === 'silver' ? 'Silver' : 'Gold'} (${form})`,
          acquiredOn: date, currency: 'INR', data };
      }
      case 'epf': {
        if (!m.balance) return null;
        const start = m.start_date || m.date || today;
        return { ...base, type: 'epf', label: m.label || 'EPF / PF',
          acquiredOn: start, currency: 'INR',
          data: { balance: m.balance, asOfDate: m.as_of_date || today,
            empContribution: m.emp_contribution || 0, erContribution: m.er_contribution || 0,
            rate: m.rate || 8.25, currentAge: m.current_age || 30, retirementAge: m.retirement_age || 60,
            uan: m.uan || undefined } };
      }
      case 'ppf': {
        if (!m.balance) return null;
        const open = m.open_date || m.date || today;
        return { ...base, type: 'ppf', label: m.label || 'PPF',
          acquiredOn: open, currency: 'INR',
          data: { balance: m.balance, asOfDate: m.as_of_date || today,
            annualContribution: m.annual_contribution || 0, rate: m.rate || 7.1,
            openDate: open, extensionYears: 0 } };
      }
      case 'nps': {
        if (!m.corpus) return null;
        const start = m.start_date || m.date || today;
        const e = m.alloc_e != null ? m.alloc_e : 50;
        const c = m.alloc_c != null ? m.alloc_c : 30;
        const g = m.alloc_g != null ? m.alloc_g : 20;
        return { ...base, type: 'nps', label: m.label || `NPS Tier ${m.tier || 'I'}`,
          acquiredOn: start, currency: 'INR',
          data: { corpus: m.corpus, asOfDate: m.as_of_date || today,
            monthlyContribution: m.monthly_contribution || 0,
            tier: /^ii$/i.test(m.tier || '') ? 'II' : 'I',
            allocE: e, allocC: c, allocG: g, pran: m.pran || undefined } };
      }
      case 'smallsavings': {
        const st = (m.scheme || '').toLowerCase();
        if (!['rd', 'ssy', 'kvp', 'nsc', 'pomis', 'potd'].includes(st)) return null;
        if (!m.rate || !m.tenure_years) return null;
        const start = m.start_date || m.date || today;
        const data = { subType: st, rate: m.rate, tenureYears: m.tenure_years, startDate: start };
        if (st === 'rd') { data.monthlyAmount = m.monthly_amount; if (!data.monthlyAmount) return null; }
        else if (st === 'ssy') { data.balance = m.balance || 0; data.annualContribution = m.annual_contribution; data.asOfDate = start; if (data.annualContribution == null) return null; }
        else { data.principal = m.principal; if (!data.principal) return null; }
        const labels = { rd: 'Recurring deposit', ssy: 'Sukanya Samriddhi', kvp: 'KVP', nsc: 'NSC', pomis: 'PO MIS', potd: 'PO TD' };
        return { ...base, type: 'smallsavings', label: m.label || labels[st] || 'Small savings',
          acquiredOn: start, currency: 'INR', data };
      }
      case 'esop': {
        if (!m.company || !m.total_units) return null;
        const vestStart = m.vest_start || m.date || today;
        const ticker = (m.ticker || '').toUpperCase();
        const grantType = /^iso$/i.test(m.grant_type || '') ? 'ISO' : /^nso$/i.test(m.grant_type || '') ? 'NSO' : 'RSU';
        return { ...base, type: 'esop', label: m.label || `${m.company} ${grantType}`,
          acquiredOn: vestStart, currency: (m.currency || 'USD').toUpperCase() === 'INR' ? 'INR' : 'USD',
          data: { company: m.company, ticker: ticker || undefined, grantType, totalUnits: m.total_units,
            vestStart, cliffMonths: m.cliff_months || 0,
            freq: /^(monthly|annual)$/i.test(m.frequency || '') ? m.frequency.toLowerCase() : 'quarterly',
            durationMonths: m.duration_months || 48,
            strike: m.strike || undefined, sharePrice: m.share_price || undefined,
            currency: (m.currency || 'USD').toUpperCase() === 'INR' ? 'INR' : 'USD',
            isPrivate: !!m.private, assumedGrowth: 15 } };
      }
      default: return null;
    }
  }

  // ---- Public API: open upload modal ----
  function openUploadModal(hintType) {
    if (!API_KEY) {
      UI.toast('AI import requires Gemini API key — set VITE_GEMINI_API_KEY in .env');
      return;
    }

    const typeLabel = hintType ? TYPE_LABELS[hintType] || hintType : 'any asset type';
    const attrHint = hintType && KEY_ATTRIBUTES[hintType]
      ? `<div class="hint" style="margin-top:8px"><b>Key columns for ${TYPE_LABELS[hintType]}:</b> <code>${KEY_ATTRIBUTES[hintType].required.join(', ')}</code><br><b>Optional:</b> <code>${KEY_ATTRIBUTES[hintType].optional.join(', ')}</code></div>`
      : '';

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="AI-Powered Import" style="max-width:640px">
      <h3>🤖 AI-Powered Import${hintType ? ' — ' + (TYPE_LABELS[hintType] || '') : ''}</h3>
      <p class="small dim" style="margin-bottom:12px">
        Upload a statement or export from <b>any broker or platform</b> — AI will extract your ${typeLabel} holdings automatically.
      </p>

      <div class="field" style="margin-bottom:12px">
        <label>Upload file (CSV, XLS, XLSX, or PDF — max 10 MB)</label>
        <input type="file" id="ai_import_file" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
        <div class="hint">
          <b>Excel/CSV:</b> Zerodha, Groww, Kuvera, TickerTape, or any broker/bank export<br>
          <b>PDF:</b> CAS statements, passbooks, account summaries (text-based)
        </div>
        ${attrHint}
      </div>

      <div id="ai_import_status" style="margin-bottom:12px;min-height:24px"></div>

      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="ai_import_process" disabled>Process with AI</button>
      </div>
    </div>`;

    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());

    const fileInput = back.querySelector('#ai_import_file');
    const statusEl = back.querySelector('#ai_import_status');
    const processBtn = back.querySelector('#ai_import_process');
    let selectedFile = null;

    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files?.[0];
      processBtn.disabled = !selectedFile;
    });

    processBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      processBtn.disabled = true;
      fileInput.disabled = true;

      const fname = selectedFile.name.toLowerCase();
      const isExcel = fname.endsWith('.xls') || fname.endsWith('.xlsx');
      const isPDF = fname.endsWith('.pdf');
      statusEl.innerHTML = `<div class="small">⏳ ${isExcel ? 'Reading spreadsheet' : isPDF ? 'Extracting text from PDF' : 'Reading file'} and analyzing with AI...</div>`;

      try {
        const job = await processFile(selectedFile, hintType);
        const label = TYPE_LABELS[job.asset_type] || job.asset_type;
        statusEl.innerHTML = `<div class="small" style="color:var(--pos)">✅ Extracted ${job.matched_holdings?.length || 0} ${label.toLowerCase()} holding(s)</div>`;
        setTimeout(() => { back.remove(); openReviewModal(job, commitHoldings); }, 500);
      } catch (err) {
        statusEl.innerHTML = `<div class="small" style="color:var(--neg)">❌ ${esc(err.message)}</div>`;
        processBtn.disabled = false;
        fileInput.disabled = false;
      }
    });
  }

  return { openUploadModal, processFile, commitHoldings, KEY_ATTRIBUTES };
})();

if (typeof globalThis !== 'undefined') globalThis.AIImport = AIImport;
