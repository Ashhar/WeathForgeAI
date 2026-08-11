/* ============================================================
   WealthForge AI — AI-powered universal import
   Upload CAS PDF / broker statement / spreadsheet → LLM extracts
   holdings → match against masters → user reviews → import.

   V1 scope: CAS PDF (CAMS/KFintech) → mutual fund holdings.
   Pipeline extensible to other input types (broker PDFs, Excel,
   images) by adding format detectors and extraction prompts.

   MANDATORY review/confirm: nothing commits without explicit
   user approval of the preview table.

   Dependencies: pdfjs-dist (PDF text extraction), @google/generative-ai
   Env: VITE_GEMINI_API_KEY
   ============================================================ */

const AIImport = (() => {
  const API_KEY = import.meta.env?.VITE_GEMINI_API_KEY || '';
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  // Cache for discovered models
  let availableModels = null;
  let selectedModel = null;

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // ---- Discover available models dynamically ----
  async function discoverModel() {
    if (selectedModel) return selectedModel; // Use cached model

    if (!API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY not configured');
    }

    try {
      // Call the list models API
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        throw new Error(`Model discovery failed: ${response.status}`);
      }

      const data = await response.json();
      availableModels = data.models || [];

      // Prioritize models that support generateContent
      const suitableModels = availableModels.filter(m =>
        m.supportedGenerationMethods?.includes('generateContent')
      );

      if (suitableModels.length === 0) {
        throw new Error('No suitable models found for generateContent');
      }

      // Prefer latest flash models, then pro, then any available
      const modelPreferences = [
        /gemini.*flash.*latest/i,
        /gemini.*flash/i,
        /gemini.*pro.*latest/i,
        /gemini.*pro/i,
        /gemini/i,
      ];

      for (const pattern of modelPreferences) {
        const found = suitableModels.find(m => pattern.test(m.name));
        if (found) {
          // Extract model name (remove "models/" prefix)
          selectedModel = found.name.replace('models/', '');
          console.log('[AI Import] Using model:', selectedModel);
          return selectedModel;
        }
      }

      // Fallback to first available model
      selectedModel = suitableModels[0].name.replace('models/', '');
      console.log('[AI Import] Using fallback model:', selectedModel);
      return selectedModel;

    } catch (err) {
      console.error('[AI Import] Model discovery failed:', err);
      // Fallback to hardcoded models as last resort
      const fallbacks = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-pro'];
      console.warn('[AI Import] Using fallback model list:', fallbacks);
      selectedModel = fallbacks[0];
      return selectedModel;
    }
  }

  // ---- PDF text extraction via pdfjs-dist ----
  async function extractTextFromPDF(arrayBuffer) {
    // Dynamic import for pdfjs-dist (client-side PDF parsing)
    const pdfjsLib = await import('pdfjs-dist');

    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const textPages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      textPages.push(pageText);
    }

    return textPages.join('\n\n--- PAGE BREAK ---\n\n');
  }

  // ---- Format detection ----
  function detectCASFormat(text) {
    const upper = text.toUpperCase();
    if (upper.includes('CAMS') || upper.includes('COMPUTER AGE MANAGEMENT')) return 'CAMS';
    if (upper.includes('KFINTECH') || upper.includes('KARVY')) return 'KFintech';
    return null;
  }

  // ---- Chunk CAS by folio ----
  // CAS statements segment by AMC/folio — split into chunks before LLM call
  function chunkCASByFolio(text) {
    // Simple heuristic: split on "Folio No:" or similar markers
    // This is a minimal implementation; real CAS parsing is complex
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

    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }

    // If no folio markers found, return the entire text as one chunk
    return chunks.length > 1 ? chunks : [text];
  }

  // ---- LLM extraction schema ----
  const EXTRACTION_SCHEMA = {
    type: 'object',
    properties: {
      holdings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            scheme_name: { type: 'string', description: 'Full scheme name from the statement' },
            scheme_code: { type: ['string', 'null'], description: 'AMFI scheme code if present' },
            isin: { type: ['string', 'null'], description: 'ISIN if present' },
            folio: { type: ['string', 'null'], description: 'Folio number' },
            units: { type: 'number', description: 'Current units held' },
            nav: { type: ['number', 'null'], description: 'Latest NAV per unit' },
            nav_date: { type: ['string', 'null'], description: 'NAV date in YYYY-MM-DD format' },
            value: { type: ['number', 'null'], description: 'Current value' },
            invested: { type: ['number', 'null'], description: 'Amount invested or cost' },
          },
          required: ['scheme_name', 'units'],
        },
      },
    },
    required: ['holdings'],
  };

  const EXTRACTION_USER_PROMPT = `You are a financial data extraction assistant. Extract mutual fund holdings from CAS (Consolidated Account Statement) text.

Output ONLY valid JSON matching this schema:
${JSON.stringify(EXTRACTION_SCHEMA, null, 2)}

Rules:
- Extract ALL mutual fund schemes from the text
- Preserve exact scheme names from the statement
- Extract AMFI scheme code if visible (usually 6 digits)
- Extract ISIN if visible (12-character alphanumeric)
- Units must be a number
- NAV, value, invested are optional but extract if present
- Convert dates to YYYY-MM-DD format
- If multiple transactions per scheme, report the CURRENT holdings (closing balance)
- Do NOT invent data — use null for missing fields
- Output MUST be valid JSON only, no explanatory text`;

  // ---- Call Gemini API ----
  async function extractViaLLM(text) {
    if (!API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY not configured — set it in .env to enable AI import');
    }

    // Discover the best available model
    const modelName = await discoverModel();

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(API_KEY);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      });

      const prompt = `${EXTRACTION_USER_PROMPT}\n\nExtract mutual fund holdings from this CAS excerpt:\n\n${text.slice(0, 50000)}`; // Cap at ~50k chars per chunk

      const result = await model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();

      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('LLM did not return valid JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate against schema (basic check)
      if (!parsed.holdings || !Array.isArray(parsed.holdings)) {
        throw new Error('LLM response missing holdings array');
      }

      // Estimate tokens (Gemini doesn't provide exact counts in the basic API)
      const estimatedTokens = Math.ceil(prompt.length / 4) + Math.ceil(responseText.length / 4);

      return {
        data: parsed,
        model: modelName,
        tokens: estimatedTokens,
      };
    } catch (err) {
      if (err.message?.includes('API key') || err.message?.includes('401')) {
        throw new Error('Invalid Gemini API key — check VITE_GEMINI_API_KEY in .env');
      }
      throw new Error(`Gemini API error with model ${modelName}: ${err.message}`);
    }
  }

  // ---- Match against mf_master and equity_master ----
  async function matchHoldings(extractedHoldings) {
    const supa = globalThis.Supa?.client;

    const matched = [];
    for (const holding of extractedHoldings) {
      let matchedScheme = null;
      let matchedStock = null;
      let confidence = 'low';

      // Determine if this is equity or MF based on fields
      const isMF = holding.scheme_name || holding.scheme_code || holding.units != null;
      const isEquity = holding.symbol || holding.quantity != null;

      if (isMF) {
        // Match mutual fund
        if (!supa) {
          // Local mode
          matchedScheme = matchLocalScheme(holding);
          confidence = holding.scheme_code ? 'high' : 'medium';
        } else {
          // Cloud mode: match against mf_master
          // Priority 1: ISIN
          if (holding.isin) {
            const { data } = await supa.from('mf_master')
              .select('scheme_code,name,amc,plan,option,isin,nav,nav_date')
              .eq('isin', holding.isin)
              .limit(1)
              .single();
            if (data) {
              matchedScheme = data;
              confidence = 'high';
            }
          }

          // Priority 2: scheme code
          if (!matchedScheme && holding.scheme_code) {
            const { data } = await supa.from('mf_master')
              .select('scheme_code,name,amc,plan,option,isin,nav,nav_date')
              .eq('scheme_code', holding.scheme_code)
              .limit(1)
              .single();
            if (data) {
              matchedScheme = data;
              confidence = 'high';
            }
          }

          // Priority 3: fuzzy name match with plan/option filtering
          if (!matchedScheme && holding.scheme_name) {
            const searchQuery = holding.scheme_name.slice(0, 50);
            const { data } = await supa.rpc('search_mf', {
              q: searchQuery,
              max_results: 10,
            });
            if (data && data.length > 0) {
              // Filter by plan and option if available from CSV
              const plan = (holding.plan || '').toLowerCase();
              const option = (holding.option || '').toLowerCase();
              let best = data[0];

              if (plan || option) {
                const filtered = data.filter(s => {
                  const sPlan = (s.plan || s.name || '').toLowerCase();
                  const sOption = (s.option || s.name || '').toLowerCase();
                  const nameL = (s.name || '').toLowerCase();
                  const planMatch = !plan || sPlan.includes(plan) || nameL.includes(plan);
                  const optionMatch = !option || sOption.includes(option) || nameL.includes(option);
                  return planMatch && optionMatch;
                });
                if (filtered.length > 0) best = filtered[0];
              }

              matchedScheme = best;
              confidence = (plan || option) ? 'high' : 'medium';
            }
          }
        }
      } else if (isEquity) {
        // Match equity
        if (!supa) {
          // Local mode
          matchedStock = matchLocalStock(holding);
          confidence = matchedStock ? 'high' : 'low';
        } else {
          // Cloud mode: match against equity_master
          if (holding.symbol) {
            const { data } = await supa.from('equity_master')
              .select('exchange,symbol,name,isin')
              .eq('symbol', holding.symbol.toUpperCase())
              .limit(1);
            if (data && data.length > 0) {
              const stock = data[0];
              matchedStock = {
                symbol: stock.symbol,
                name: stock.name,
                isin: stock.isin,
                exchange: stock.exchange,
                price: Market.getStock(stock.symbol)?.price || null,
              };
              confidence = 'high';
            }
          }
        }
      }

      matched.push({
        ...holding,
        matched_scheme: matchedScheme,
        matched_stock: matchedStock,
        confidence,
      });
    }

    return matched;
  }

  function matchLocalScheme(holding) {
    // Fallback matching using built-in Market schemes
    if (holding.scheme_code) {
      const scheme = Market.getScheme(holding.scheme_code);
      if (scheme) return { scheme_code: holding.scheme_code, name: scheme.name, nav: scheme.nav };
    }
    return null;
  }

  function matchLocalStock(holding) {
    // Fallback matching using built-in Market stocks
    if (holding.symbol) {
      const stock = Market.getStock(holding.symbol.toUpperCase());
      if (stock) return { symbol: stock.symbol, name: stock.name, price: stock.price, exchange: stock.exchange };
    }
    return null;
  }

  // ---- CSV universal import schema ----
  const CSV_EXTRACTION_SCHEMA = {
    type: 'object',
    properties: {
      asset_type: {
        type: 'string',
        enum: ['equity', 'mf', 'crypto', 'fd', 'gold', 'other'],
        description: 'Type of assets in this CSV (equity=stocks, mf=mutual funds, etc.)',
      },
      holdings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // Equity fields
            symbol: { type: ['string', 'null'], description: 'Stock ticker/symbol (for equity)' },
            quantity: { type: ['number', 'null'], description: 'Number of shares/units' },
            avg_price: { type: ['number', 'null'], description: 'Average buy price per unit' },
            current_price: { type: ['number', 'null'], description: 'Current/last traded price (LTP)' },
            total_invested: { type: ['number', 'null'], description: 'Total amount invested' },
            current_value: { type: ['number', 'null'], description: 'Current market value of the holding' },

            // MF fields
            scheme_name: { type: ['string', 'null'], description: 'Full mutual fund scheme name' },
            scheme_code: { type: ['string', 'null'], description: 'AMFI scheme code' },
            units: { type: ['number', 'null'], description: 'MF units held' },
            avg_nav: { type: ['number', 'null'], description: 'Average NAV' },
            current_nav: { type: ['number', 'null'], description: 'Current/latest NAV per unit' },
            current_value: { type: ['number', 'null'], description: 'Current market value of the holding' },
            plan: { type: ['string', 'null'], description: 'Direct or Regular' },
            option: { type: ['string', 'null'], description: 'Growth or IDCW' },
            folio: { type: ['string', 'null'], description: 'Folio number' },

            // Common fields
            date: { type: ['string', 'null'], description: 'Acquisition/investment date (YYYY-MM-DD)' },
            label: { type: ['string', 'null'], description: 'User label/nickname' },
          },
          required: ['date'],
        },
      },
    },
    required: ['asset_type', 'holdings'],
  };

  const CSV_EXTRACTION_PROMPT = `You are a financial portfolio import assistant. Analyze this CSV export and extract holdings into structured JSON.

Output ONLY valid JSON matching this schema:
${JSON.stringify(CSV_EXTRACTION_SCHEMA, null, 2)}

Your task:
1. Identify the asset type (equity, mf, crypto, fd, gold, other)
2. Map CSV columns to the schema fields (be flexible with column names)
3. Extract ALL data rows (skip totals/summaries)
4. Normalize dates to YYYY-MM-DD format
5. Use null for missing fields

Common CSV formats:
- TickerTape: "Fund Name", "Plan Type", "Option Type", "NAV ₹", "Units", "Invested Amt ₹", "Current Value ₹"
- Zerodha: "Symbol", "Quantity", "Average Cost", "LTP"
- Groww: "Scheme Name", "Invested Amount", "Current Value", "Units"
- Generic broker: any variation of stock/fund name, qty/units, price/NAV, amount, date

Rules:
- For mutual funds: extract scheme name (map "Fund Name" → scheme_name)
- For mutual funds: map "NAV"/"NAV ₹"/current NAV → current_nav
- For mutual funds: map "Plan Type" → plan (must be exactly "Direct" or "Regular")
- For mutual funds: map "Option Type" → option (must be exactly "Growth" or "IDCW")
- For stocks: extract symbol/ticker (map "Symbol"/"Stock"/"Scrip" → symbol)
- Map quantity/shares/units → quantity or units (depending on type)
- Map avg price/cost/NAV → avg_price or avg_nav
- Map LTP/current price/last price → current_price
- Map current value/market value → current_value
- Map invested amount/total cost → total_invested
- Convert all dates to YYYY-MM-DD (from DD-MM-YYYY, DD/MM/YYYY, or any format)
- Skip summary rows (Total, Grand Total, etc.)
- Do NOT invent data — use null for missing fields

Output MUST be valid JSON only, no explanatory text.`;

  // ---- Extract holdings from CSV via LLM ----
  async function extractFromCSV(text) {
    if (!API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY not configured — set it in .env to enable AI import');
    }

    // Discover the best available model
    const modelName = await discoverModel();

    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(API_KEY);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        },
      });

      const prompt = `${CSV_EXTRACTION_PROMPT}\n\nCSV content:\n\n${text.slice(0, 100000)}`; // Cap at 100k chars

      const result = await model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();

      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('AI did not return valid JSON — try a different CSV format');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate against schema
      if (!parsed.asset_type || !parsed.holdings || !Array.isArray(parsed.holdings)) {
        throw new Error('AI response missing required fields (asset_type or holdings)');
      }

      const estimatedTokens = Math.ceil(prompt.length / 4) + Math.ceil(responseText.length / 4);

      return {
        data: parsed,
        model: modelName,
        tokens: estimatedTokens,
      };
    } catch (err) {
      if (err.message?.includes('API key') || err.message?.includes('401')) {
        throw new Error('Invalid Gemini API key — check VITE_GEMINI_API_KEY in .env');
      }
      throw new Error(`Gemini API error with model ${modelName}: ${err.message}`);
    }
  }

  // ---- Process file ----
  async function processFile(file) {
    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)} MB) — 10 MB max`);
    }

    const isCSV = file.type === 'text/csv' || file.name.endsWith('.csv');
    const isPDF = file.type === 'application/pdf';

    if (!isCSV && !isPDF) {
      throw new Error('Only PDF and CSV files supported — upload a CAS PDF or portfolio CSV');
    }

    let extractedText;
    let fileType = isCSV ? 'csv' : 'cas_pdf';
    let format = null;

    if (isCSV) {
      // Read CSV as text
      extractedText = await file.text();
      if (!extractedText || extractedText.trim().length < 50) {
        throw new Error('CSV appears empty');
      }
      format = 'universal_csv';
    } else {
      // Read PDF
      const arrayBuffer = await file.arrayBuffer();

      // Extract text
      try {
        extractedText = await extractTextFromPDF(arrayBuffer);
      } catch (err) {
        if (extractedText === '' || !extractedText) {
          throw new Error('PDF appears to be scanned/image-only — text-based PDFs only (OCR not yet supported)');
        }
        throw new Error(`PDF extraction failed: ${err.message}`);
      }

      if (!extractedText || extractedText.trim().length < 100) {
        throw new Error('PDF appears empty or scanned — text-based PDFs only (OCR not yet supported)');
      }

      // Detect CAS format
      format = detectCASFormat(extractedText);
      if (!format) {
        throw new Error('Unrecognized PDF format — expected CAMS or KFintech CAS statement');
      }
    }

    // Extract holdings via AI
    let allHoldings = [];
    let assetType = 'mf'; // default for CAS PDFs
    const errors = [];
    let totalTokens = 0;
    let usedModel = null;

    if (isCSV) {
      // Universal CSV extraction
      try {
        const result = await extractFromCSV(extractedText);
        allHoldings = result.data.holdings || [];
        assetType = result.data.asset_type || 'mf';
        totalTokens = result.tokens;
        usedModel = result.model;
      } catch (err) {
        errors.push({ chunk: 0, error: err.message });
        throw new Error(`CSV extraction failed: ${err.message}`);
      }
    } else {
      // PDF CAS extraction (existing logic)
      const chunks = chunkCASByFolio(extractedText);

      for (let i = 0; i < chunks.length; i++) {
        try {
          const result = await extractViaLLM(chunks[i]);
          allHoldings.push(...result.data.holdings);
          totalTokens += result.tokens;
          if (!usedModel) usedModel = result.model;
        } catch (err) {
          errors.push({ chunk: i + 1, error: err.message });
        }
      }

      if (allHoldings.length === 0 && errors.length > 0) {
        throw new Error(`Extraction failed: ${errors[0].error}`);
      }
    }

    // Match against masters
    const matched = await matchHoldings(allHoldings);

    // Create import job record
    const jobData = {
      filename: file.name,
      file_type: fileType,
      input_format: format,
      asset_type: assetType,
      extracted_data: { holdings: allHoldings },
      extraction_model: usedModel,
      extraction_tokens: totalTokens,
      extraction_errors: errors.length > 0 ? errors : null,
      matched_holdings: matched,
      low_confidence_ids: matched.filter(m => m.confidence === 'low').map((_, i) => String(i)),
      status: 'pending',
    };

    // Save to database if in cloud mode
    if (globalThis.Supa?.client) {
      const { data, error } = await globalThis.Supa.client
        .from('import_jobs')
        .insert([jobData])
        .select()
        .single();

      if (error) {
        console.warn('[AI Import] Could not save import job:', error.message);
        return { ...jobData, id: crypto.randomUUID() };
      }
      return { ...jobData, id: data.id };
    }

    // Local mode: return job data with generated ID
    return { ...jobData, id: crypto.randomUUID() };
  }

  // ---- Review modal ----
  function openReviewModal(job, onConfirm) {
    const matched = job.matched_holdings || [];
    const lowConf = new Set(job.low_confidence_ids || []);
    const assetType = job.asset_type || 'mf';
    const assetLabel = assetType === 'equity' ? 'stock' : 'mutual fund';

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Review AI Import" style="max-width:920px;width:95vw">
      <h3>📄 Review import — ${esc(job.filename)}</h3>
      <p class="small dim" style="margin-bottom:12px">
        Extracted ${matched.length} ${assetLabel} holding${matched.length !== 1 ? 's' : ''} from ${esc(job.input_format || job.file_type)}.
        ${job.extraction_errors ? `<span style="color:var(--neg)">⚠️ ${job.extraction_errors.length} chunk(s) had errors.</span>` : ''}
        Review and edit before importing.
      </p>

      <div id="ai_import_preview" style="max-height:400px;overflow:auto;margin-bottom:12px"></div>

      <div class="hint" style="margin-bottom:12px">
        <b>Low-confidence matches</b> are flagged in yellow — verify names before importing.
        AI-powered universal import supports TickerTape, Zerodha, Groww, Kuvera, and other broker exports.
      </div>

      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="ai_import_confirm">Import ${matched.length} holding${matched.length !== 1 ? 's' : ''}</button>
      </div>
    </div>`;

    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());

    // Render preview table
    const previewEl = back.querySelector('#ai_import_preview');
    let rows, tableHtml;

    if (assetType === 'equity') {
      // Equity table
      rows = matched.map((m, i) => {
        const isLowConf = lowConf.has(String(i));
        const rowClass = isLowConf ? 'style="background:var(--warn-bg,#fff3cd)"' : '';
        const stockDisplay = m.matched_stock
          ? `${esc(m.matched_stock.symbol)} — ${esc(m.matched_stock.name)}`
          : `<span style="color:var(--neg)">❌ ${esc(m.symbol || 'Unknown')} — no match</span>`;

        return `<tr ${rowClass} data-idx="${i}">
          <td class="small">${isLowConf ? '⚠️' : '✅'}</td>
          <td class="asset-name small">${stockDisplay}</td>
          <td class="num">${m.quantity?.toFixed(0) || '—'}</td>
          <td class="num">${m.avg_price ? `₹${m.avg_price.toFixed(2)}` : '—'}</td>
          <td class="num">${m.matched_stock?.price ? `₹${m.matched_stock.price.toFixed(2)}` : '—'}</td>
          <td class="num">${m.matched_stock && m.quantity ? Fin.fmtINR((m.quantity || 0) * (m.matched_stock.price || 0), { compact: true }) : '—'}</td>
        </tr>`;
      }).join('');

      tableHtml = `<div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th></th>
          <th>Stock</th>
          <th class="num">Qty</th>
          <th class="num">Avg Price</th>
          <th class="num">LTP</th>
          <th class="num">Value</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    } else {
      // Mutual fund table
      rows = matched.map((m, i) => {
        const isLowConf = lowConf.has(String(i));
        const rowClass = isLowConf ? 'style="background:var(--warn-bg,#fff3cd)"' : '';
        const schemeDisplay = m.matched_scheme
          ? `${esc(m.matched_scheme.name)} ${m.plan || m.matched_scheme.plan ? `(${m.plan || m.matched_scheme.plan})` : ''}`
          : `<span style="color:var(--neg)">❌ ${esc(m.scheme_name)} — no match</span>`;

        return `<tr ${rowClass} data-idx="${i}">
          <td class="small">${isLowConf ? '⚠️' : '✅'}</td>
          <td class="asset-name small">${schemeDisplay}</td>
          <td class="num">${m.units?.toFixed(3) || '—'}</td>
          <td class="num">${m.matched_scheme?.nav ? `₹${m.matched_scheme.nav.toFixed(2)}` : '—'}</td>
          <td class="num">${m.matched_scheme ? Fin.fmtINR((m.units || 0) * (m.matched_scheme.nav || 0), { compact: true }) : '—'}</td>
          <td class="small dim">${m.folio || '—'}</td>
        </tr>`;
      }).join('');

      tableHtml = `<div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th></th>
          <th>Scheme</th>
          <th class="num">Units</th>
          <th class="num">NAV</th>
          <th class="num">Value</th>
          <th>Folio</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
    }

    previewEl.innerHTML = tableHtml;

    // Confirm handler
    back.querySelector('#ai_import_confirm').addEventListener('click', async () => {
      back.remove();
      if (onConfirm) await onConfirm(job, matched);
    });
  }

  // ---- Commit holdings ----
  async function commitHoldings(job, matched) {
    if (Store.isReadOnly()) {
      UI.toast('Demo data is read-only — sign up to import your portfolio');
      return;
    }

    const assetType = job.asset_type || 'mf';
    const assetsToAdd = matched
      .filter(m => m.matched_scheme || m.matched_stock) // skip unmatched
      .map(m => {
        if (assetType === 'mf') {
          // Mutual fund import
          const scheme = m.matched_scheme;
          const navFromCSV = m.current_nav || m.nav;
          const lastNav = navFromCSV || scheme.nav || 100;
          const avgNav = m.avg_nav || (m.total_invested && m.units ? m.total_invested / m.units : (m.invested && m.units ? m.invested / m.units : lastNav));
          return {
            type: 'mf',
            label: scheme.name,
            acquiredOn: m.date || new Date().toISOString().slice(0, 10),
            currency: 'INR',
            data: {
              schemeCode: scheme.scheme_code,
              schemeName: scheme.name,
              plan: m.plan || scheme.plan || 'Direct',
              option: m.option || scheme.option || 'Growth',
              units: m.units,
              avgNav: avgNav,
              totalInvested: m.total_invested || m.invested || (m.units * avgNav),
              lastNav: lastNav,
              folio: m.folio || undefined,
            },
            ownership: 'single',
            sharePct: 100,
            tags: ['imported', 'ai'],
            notes: `Imported from ${job.filename}`,
          };
        } else if (assetType === 'equity') {
          // Equity/stock import
          const stock = m.matched_stock;
          return {
            type: 'equity',
            label: m.label || stock.symbol,
            acquiredOn: m.date || new Date().toISOString().slice(0, 10),
            currency: 'INR',
            data: {
              symbol: stock.symbol,
              quantity: m.quantity,
              avgPrice: m.avg_price || (m.total_invested && m.quantity ? m.total_invested / m.quantity : stock.price || 100),
              totalInvested: m.total_invested || (m.quantity * (m.avg_price || stock.price || 100)),
              lastPrice: m.current_price || stock.price || m.avg_price || 100,
              isin: stock.isin || undefined,
            },
            ownership: 'single',
            sharePct: 100,
            tags: ['imported', 'ai'],
            notes: `Imported from ${job.filename}`,
          };
        }
        return null;
      })
      .filter(Boolean);

    // Add to store
    const assetIds = [];
    for (const asset of assetsToAdd) {
      const added = Store.add(asset);
      assetIds.push(added.id);
    }

    // Update job status
    if (globalThis.Supa?.client && job.id) {
      await globalThis.Supa.client
        .from('import_jobs')
        .update({
          status: 'committed',
          reviewed_at: new Date().toISOString(),
          committed_at: new Date().toISOString(),
          committed_asset_ids: assetIds,
        })
        .eq('id', job.id);
    }

    const skipped = matched.length - assetsToAdd.length;
    UI.toast(`${assetsToAdd.length} holdings imported${skipped > 0 ? `, ${skipped} skipped (no match)` : ''}`);

    // Navigate to appropriate holdings page
    const targetPage = assetType === 'equity' ? '/holdings/equity' : '/holdings/mf';
    Router.go(targetPage);
  }

  // ---- Public API: open upload modal ----
  function openUploadModal() {
    if (!API_KEY) {
      UI.toast('AI import requires Gemini API key — set VITE_GEMINI_API_KEY in .env');
      return;
    }

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="AI-Powered Import" style="max-width:640px">
      <h3>🤖 AI-Powered Universal Import</h3>
      <p class="small dim" style="margin-bottom:12px">
        Upload a portfolio export from <b>any broker or platform</b> and AI will automatically extract your holdings.
        Works with TickerTape, Zerodha, Groww, Kuvera, CAS statements, and more!
      </p>

      <div class="field" style="margin-bottom:12px">
        <label>Upload CSV or PDF (max 10 MB)</label>
        <input type="file" id="ai_import_file" accept=".csv,.pdf,text/csv,application/pdf" />
        <div class="hint">
          <b>CSV:</b> TickerTape, Zerodha, Groww, Kuvera, or any broker export<br>
          <b>PDF:</b> CAMS/KFintech CAS statements (text-based only)
        </div>
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

      const isCSV = selectedFile.name.endsWith('.csv') || selectedFile.type === 'text/csv';
      const statusMsg = isCSV ? '⏳ Reading CSV and analyzing with AI...' : '⏳ Extracting text from PDF...';
      statusEl.innerHTML = `<div class="small">${statusMsg}</div>`;

      try {
        if (!isCSV) {
          statusEl.innerHTML = '<div class="small">⏳ Analyzing with AI...</div>';
        }

        const job = await processFile(selectedFile);
        const assetLabel = job.asset_type === 'equity' ? 'stocks' : 'mutual funds';

        statusEl.innerHTML = `<div class="small" style="color:var(--pos)">✅ Extracted ${job.matched_holdings?.length || 0} ${assetLabel}</div>`;

        setTimeout(() => {
          back.remove();
          openReviewModal(job, commitHoldings);
        }, 500);
      } catch (err) {
        statusEl.innerHTML = `<div class="small" style="color:var(--neg)">❌ ${esc(err.message)}</div>`;
        processBtn.disabled = false;
        fileInput.disabled = false;
      }
    });
  }

  return { openUploadModal, processFile, commitHoldings };
})();

if (typeof globalThis !== 'undefined') globalThis.AIImport = AIImport;
