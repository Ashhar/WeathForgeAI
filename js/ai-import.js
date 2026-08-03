/* ============================================================
   WealthForge AI — AI-powered universal import
   Upload CAS PDF / broker statement / spreadsheet → LLM extracts
   holdings → match against masters → user reviews → import.

   V1 scope: CAS PDF (CAMS/KFintech) → mutual fund holdings.
   Pipeline extensible to other input types (broker PDFs, Excel,
   images) by adding format detectors and extraction prompts.

   MANDATORY review/confirm: nothing commits without explicit
   user approval of the preview table.

   Dependencies: pdfjs-dist (PDF text extraction), @anthropic-ai/sdk
   Env: VITE_ANTHROPIC_API_KEY
   ============================================================ */

const AIImport = (() => {
  const API_KEY = import.meta.env?.VITE_ANTHROPIC_API_KEY || '';
  const MODEL = 'claude-3-5-sonnet-20241022';
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

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

  const EXTRACTION_SYSTEM_PROMPT = `You are a financial data extraction assistant. Extract mutual fund holdings from CAS (Consolidated Account Statement) text.

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

  // ---- Call Anthropic API ----
  async function extractViaLLM(text) {
    if (!API_KEY) {
      throw new Error('VITE_ANTHROPIC_API_KEY not configured — set it in .env to enable AI import');
    }

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: API_KEY, dangerouslyAllowBrowser: true });

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Extract mutual fund holdings from this CAS excerpt:\n\n${text.slice(0, 50000)}`, // Cap at ~50k chars per chunk
        }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from LLM');
      }

      // Parse JSON from response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('LLM did not return valid JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate against schema (basic check)
      if (!parsed.holdings || !Array.isArray(parsed.holdings)) {
        throw new Error('LLM response missing holdings array');
      }

      return {
        data: parsed,
        model: MODEL,
        tokens: response.usage.input_tokens + response.usage.output_tokens,
      };
    } catch (err) {
      if (err.status === 401) {
        throw new Error('Invalid Anthropic API key — check VITE_ANTHROPIC_API_KEY in .env');
      }
      throw err;
    }
  }

  // ---- Match against mf_master ----
  async function matchHoldings(extractedHoldings) {
    const supa = globalThis.Supa?.client;
    if (!supa) {
      // Local mode: use built-in matching
      return extractedHoldings.map(h => ({
        ...h,
        matched_scheme: matchLocalScheme(h),
        confidence: h.scheme_code ? 'high' : 'medium',
      }));
    }

    // Cloud mode: match against mf_master
    const matched = [];
    for (const holding of extractedHoldings) {
      let match = null;
      let confidence = 'low';

      // Priority 1: ISIN
      if (holding.isin) {
        const { data } = await supa.from('mf_master')
          .select('scheme_code,name,amc,plan,option,isin,nav,nav_date')
          .eq('isin', holding.isin)
          .limit(1)
          .single();
        if (data) {
          match = data;
          confidence = 'high';
        }
      }

      // Priority 2: scheme code
      if (!match && holding.scheme_code) {
        const { data } = await supa.from('mf_master')
          .select('scheme_code,name,amc,plan,option,isin,nav,nav_date')
          .eq('scheme_code', holding.scheme_code)
          .limit(1)
          .single();
        if (data) {
          match = data;
          confidence = 'high';
        }
      }

      // Priority 3: fuzzy name match
      if (!match && holding.scheme_name) {
        const { data } = await supa.rpc('search_mf', {
          q: holding.scheme_name.slice(0, 50),
          max_results: 1,
        });
        if (data && data.length > 0) {
          match = data[0];
          confidence = 'medium';
        }
      }

      matched.push({
        ...holding,
        matched_scheme: match,
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

  // ---- Process file ----
  async function processFile(file) {
    // Validate file
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)} MB) — 10 MB max`);
    }

    if (file.type !== 'application/pdf') {
      throw new Error('Only PDF files supported in v1 — upload a CAS PDF');
    }

    // Read file
    const arrayBuffer = await file.arrayBuffer();

    // Extract text
    let extractedText;
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

    // Detect format
    const format = detectCASFormat(extractedText);
    if (!format) {
      throw new Error('Unrecognized format — expected CAMS or KFintech CAS statement');
    }

    // Chunk by folio
    const chunks = chunkCASByFolio(extractedText);

    // Extract from each chunk
    const allHoldings = [];
    const errors = [];
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const result = await extractViaLLM(chunks[i]);
        allHoldings.push(...result.data.holdings);
        totalTokens += result.tokens;
      } catch (err) {
        errors.push({ chunk: i + 1, error: err.message });
      }
    }

    if (allHoldings.length === 0 && errors.length > 0) {
      throw new Error(`Extraction failed: ${errors[0].error}`);
    }

    // Match against masters
    const matched = await matchHoldings(allHoldings);

    // Create import job record
    const jobData = {
      filename: file.name,
      file_type: 'cas_pdf',
      input_format: format,
      extracted_data: { holdings: allHoldings },
      extraction_model: MODEL,
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

      if (error) throw new Error(`Failed to save import job: ${error.message}`);
      return { ...jobData, id: data.id };
    }

    // Local mode: return job data with generated ID
    return { ...jobData, id: crypto.randomUUID() };
  }

  // ---- Review modal ----
  function openReviewModal(job, onConfirm) {
    const matched = job.matched_holdings || [];
    const lowConf = new Set(job.low_confidence_ids || []);

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Review AI Import" style="max-width:920px;width:95vw">
      <h3>📄 Review import — ${esc(job.filename)}</h3>
      <p class="small dim" style="margin-bottom:12px">
        Extracted ${matched.length} mutual fund holding${matched.length !== 1 ? 's' : ''} from ${esc(job.input_format || 'CAS')} statement.
        ${job.extraction_errors ? `<span style="color:var(--neg)">⚠️ ${job.extraction_errors.length} chunk(s) had errors.</span>` : ''}
        Review and edit before importing.
      </p>

      <div id="ai_import_preview" style="max-height:400px;overflow:auto;margin-bottom:12px"></div>

      <div class="hint" style="margin-bottom:12px">
        <b>Low-confidence matches</b> are flagged in yellow — verify scheme names before importing.
        Click a row to edit manually.
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
    const rows = matched.map((m, i) => {
      const isLowConf = lowConf.has(String(i));
      const rowClass = isLowConf ? 'style="background:var(--warn-bg,#fff3cd)"' : '';
      const schemeDisplay = m.matched_scheme
        ? `${esc(m.matched_scheme.name)} ${m.matched_scheme.plan ? `(${m.matched_scheme.plan})` : ''}`
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

    previewEl.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th></th>
          <th>Scheme</th>
          <th class="num">Units</th>
          <th class="num">NAV</th>
          <th class="num">Value</th>
          <th>Folio</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    `;

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

    const assetsToAdd = matched
      .filter(m => m.matched_scheme) // skip unmatched
      .map(m => {
        const scheme = m.matched_scheme;
        return {
          type: 'mf',
          label: scheme.name,
          acquiredOn: new Date().toISOString().slice(0, 10), // Use today as acquired date (CAS doesn't have first-buy date)
          currency: 'INR',
          data: {
            schemeCode: scheme.scheme_code,
            schemeName: scheme.name,
            plan: scheme.plan || 'Direct',
            option: scheme.option || 'Growth',
            units: m.units,
            avgNav: m.invested && m.units ? m.invested / m.units : scheme.nav || 100,
            totalInvested: m.invested || (m.units * (scheme.nav || 100)),
            lastNav: scheme.nav,
            folio: m.folio || undefined,
          },
          ownership: 'single',
          sharePct: 100,
          tags: ['imported', 'cas'],
          notes: `Imported from ${job.filename}`,
        };
      });

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
    Router.go('/holdings/mf');
  }

  // ---- Public API: open upload modal ----
  function openUploadModal() {
    if (!API_KEY) {
      UI.toast('AI import requires Anthropic API key — set VITE_ANTHROPIC_API_KEY in .env');
      return;
    }

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="AI-Powered Import" style="max-width:640px">
      <h3>🤖 AI-Powered Import (Beta)</h3>
      <p class="small dim" style="margin-bottom:12px">
        Upload a CAS (Consolidated Account Statement) PDF to automatically extract your mutual fund holdings.
        <b>Currently supports: CAMS and KFintech CAS statements.</b>
      </p>

      <div class="field" style="margin-bottom:12px">
        <label>CAS PDF (text-based only, max 10 MB)</label>
        <input type="file" id="ai_import_file" accept=".pdf,application/pdf" />
        <div class="hint">Password-protected PDFs: enter password after selecting file.</div>
      </div>

      <div id="ai_import_status" style="margin-bottom:12px;min-height:24px"></div>

      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="ai_import_process" disabled>Process</button>
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
      statusEl.innerHTML = '<div class="small">⏳ Extracting text from PDF...</div>';

      try {
        statusEl.innerHTML = '<div class="small">⏳ Analyzing with AI...</div>';
        const job = await processFile(selectedFile);

        statusEl.innerHTML = `<div class="small" style="color:var(--pos)">✅ Extracted ${job.matched_holdings?.length || 0} holdings</div>`;

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
