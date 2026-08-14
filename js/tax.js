/* ============================================================
   WealthForge AI — capital gains & tax computation
   Indian tax rules (FY 2024-25+), per-lot STCG/LTCG, tax-loss
   harvesting, 80C/80CCD utilization, report & plan views.
   ============================================================ */

const Tax = (() => {

  // ---------- helpers ----------
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function monthsBetween(from, to) {
    return Math.floor((new Date(to) - new Date(from)) / (30.44 * 24 * 3600 * 1000));
  }

  // ---------- TAX_RULES constant ----------
  const TAX_RULES = {
    equity: {
      longTermThreshold: 12, // months
      stcgRate: 0.20,
      ltcgRate: 0.125,
      exemption: 125000,
      grandfatherDate: '2018-01-31',
    },
    mf_equity: {
      longTermThreshold: 12,
      stcgRate: 0.20,
      ltcgRate: 0.125,
      exemption: 125000,
      grandfatherDate: '2018-01-31',
    },
    mf_debt: {
      longTermThreshold: null, // no LTCG benefit since Budget 2023
      stcgRate: null, // taxed at slab
      ltcgRate: null, // taxed at slab
      exemption: 0,
      slabTaxed: true,
    },
    crypto: {
      longTermThreshold: null, // flat tax regardless of holding period
      flatRate: 0.30,
      noSetoff: true,
      tdsRate: 0.01,
    },
    gold: {
      longTermThreshold: 24,
      stcgRate: null, // at slab
      ltcgRate: 0.125,
      exemption: 0,
    },
    realestate: {
      longTermThreshold: 24,
      stcgRate: null, // at slab
      ltcgRate: 0.125,
      exemption: 0,
    },
  };

  // ---------- getAssetTaxCategory ----------
  function getAssetTaxCategory(asset) {
    if (!asset) return null;
    const type = asset.type;
    const data = asset.data || {};

    switch (type) {
      case 'equity':
      case 'esop':
        return 'equity';
      case 'mf': {
        // Check if it's a debt/liquid fund
        const scheme = typeof Market !== 'undefined' ? Market.getScheme(data.schemeCode) : null;
        if (scheme && (scheme.category === 'debt' || scheme.category === 'liquid')) {
          return 'mf_debt';
        }
        // Default to equity-oriented MF
        return 'mf_equity';
      }
      case 'crypto':
        return 'crypto';
      case 'gold':
        return 'gold';
      case 'realestate':
        return 'realestate';
      default:
        return null; // other types don't have specific capital gains rules here
    }
  }

  // ---------- calculateCapitalGains ----------
  function calculateCapitalGains(asset, sellDate) {
    sellDate = sellDate || new Date().toISOString().slice(0, 10);
    const category = getAssetTaxCategory(asset);
    if (!category) return null;

    const rules = TAX_RULES[category];
    const data = asset.data || {};
    const val = Store.valuation(asset);
    const currentPrice = _getCurrentPricePerUnit(asset, val);

    // Get lots
    const lots = _extractLots(asset, data);
    if (!lots.length) return null;

    let totalSTCG = 0;
    let totalLTCG = 0;
    const lotResults = [];

    for (const lot of lots) {
      const holdingMonths = monthsBetween(lot.date, sellDate);
      const sellValue = lot.qty * currentPrice;
      let costBasis = lot.qty * lot.price;
      let gain = sellValue - costBasis;
      let isLongTerm = false;

      if (category === 'crypto') {
        // Crypto: flat 30% regardless of holding period
        lotResults.push({
          date: lot.date,
          qty: lot.qty,
          costBasis,
          sellValue,
          gain,
          holdingMonths,
          isLongTerm: false,
          taxCategory: 'flat',
        });
        totalSTCG += gain; // treated as flat-rate income
        continue;
      }

      if (rules.slabTaxed) {
        // Debt MFs: all gains taxed at slab
        lotResults.push({
          date: lot.date,
          qty: lot.qty,
          costBasis,
          sellValue,
          gain,
          holdingMonths,
          isLongTerm: false,
          taxCategory: 'slab',
        });
        totalSTCG += gain;
        continue;
      }

      // Determine long-term vs short-term
      if (rules.longTermThreshold && holdingMonths >= rules.longTermThreshold) {
        isLongTerm = true;

        // Apply grandfathering for equity purchased before 2018-01-31
        if (rules.grandfatherDate && lot.date <= rules.grandfatherDate) {
          // Grandfathered cost = max(actual cost, FMV on grandfather date)
          // For simplicity, use actual cost as lower bound and assume
          // FMV on grandfather date is the higher of cost and a reference
          // In practice, the user should provide the Jan 31 2018 price
          const grandfatherPrice = lot.grandfatherFMV || lot.price;
          costBasis = lot.qty * Math.max(lot.price, grandfatherPrice);
          // But cost cannot exceed sell price (no artificial loss)
          costBasis = Math.min(costBasis, sellValue);
          gain = sellValue - costBasis;
        }

        totalLTCG += gain;
      } else {
        totalSTCG += gain;
      }

      lotResults.push({
        date: lot.date,
        qty: lot.qty,
        costBasis,
        sellValue,
        gain,
        holdingMonths,
        isLongTerm,
        taxCategory: isLongTerm ? 'ltcg' : 'stcg',
      });
    }

    // Tax computation
    const ltcgExemption = Math.min(Math.max(totalLTCG, 0), rules.exemption || 0);
    const ltcgTaxable = Math.max(0, totalLTCG - ltcgExemption);

    let stcgTax = 0;
    let ltcgTax = 0;

    if (category === 'crypto') {
      // Flat 30% on all gains
      const totalGain = totalSTCG + totalLTCG;
      stcgTax = Math.max(0, totalGain) * rules.flatRate;
      ltcgTax = 0;
    } else if (rules.slabTaxed) {
      // Taxed at slab — we can't compute exact tax without knowing slab
      // Use 30% as indicative (highest bracket)
      stcgTax = Math.max(0, totalSTCG) * 0.30;
      ltcgTax = 0;
    } else {
      if (rules.stcgRate) {
        stcgTax = Math.max(0, totalSTCG) * rules.stcgRate;
      } else {
        // At slab rate — use 30% as indicative
        stcgTax = Math.max(0, totalSTCG) * 0.30;
      }
      if (rules.ltcgRate) {
        ltcgTax = ltcgTaxable * rules.ltcgRate;
      }
    }

    return {
      lots: lotResults,
      totalSTCG,
      totalLTCG,
      ltcgExemption,
      ltcgTaxable,
      stcgTax,
      ltcgTax,
      totalTax: stcgTax + ltcgTax,
    };
  }

  // Extract lots from asset data
  function _extractLots(asset, data) {
    const type = asset.type;

    if (type === 'equity' || type === 'esop') {
      if (data.lots && data.lots.length) {
        return data.lots.map(l => ({
          date: l.date || l.purchaseDate,
          qty: l.qty || l.quantity,
          price: l.price || l.avgPrice || l.costPerUnit,
          grandfatherFMV: l.grandfatherFMV || null,
        }));
      }
      // Single lot fallback
      if (data.quantity && (data.avgPrice || data.avgCost)) {
        return [{
          date: data.purchaseDate || asset.acquiredOn,
          qty: data.quantity,
          price: data.avgCost || data.avgPrice,
          grandfatherFMV: data.grandfatherFMV || null,
        }];
      }
      return [];
    }

    if (type === 'mf') {
      if (data.lots && data.lots.length) {
        return data.lots.map(l => ({
          date: l.date || l.purchaseDate,
          qty: l.units || l.qty,
          price: l.nav || l.price,
          grandfatherFMV: l.grandfatherFMV || null,
        }));
      }
      // Single lot from units/avgNav
      if (data.units && data.avgNav) {
        return [{
          date: data.startDate || asset.acquiredOn,
          qty: data.units,
          price: data.avgNav,
          grandfatherFMV: data.grandfatherFMV || null,
        }];
      }
      return [];
    }

    if (type === 'crypto') {
      if (data.lots && data.lots.length) {
        return data.lots.map(l => ({
          date: l.date || l.purchaseDate,
          qty: l.qty || l.quantity,
          price: l.price || l.costPerUnit,
        }));
      }
      if (data.quantity && (data.avgPrice || data.avgCost)) {
        return [{
          date: data.purchaseDate || asset.acquiredOn,
          qty: data.quantity,
          price: data.avgCost || data.avgPrice,
        }];
      }
      return [];
    }

    if (type === 'gold') {
      if (data.lots && data.lots.length) {
        return data.lots.map(l => ({
          date: l.date,
          qty: l.grams || l.units || l.qty,
          price: l.rate || l.price,
        }));
      }
      const qty = data.grams || data.units || 0;
      const price = data.buyRate || data.buyPrice || 0;
      if (qty && price) {
        return [{
          date: data.purchaseDate || asset.acquiredOn,
          qty,
          price,
        }];
      }
      return [];
    }

    if (type === 'realestate') {
      // Real estate typically has a single purchase
      const cost = data.purchasePrice || data.totalCost || 0;
      if (cost) {
        return [{
          date: data.purchaseDate || asset.acquiredOn,
          qty: 1,
          price: cost,
        }];
      }
      return [];
    }

    return [];
  }

  // Get current price per unit for an asset
  function _getCurrentPricePerUnit(asset, val) {
    const data = asset.data || {};
    const type = asset.type;

    if (type === 'equity' || type === 'esop') {
      const qty = data.quantity || 1;
      return (val.currentValue || 0) / qty;
    }
    if (type === 'mf') {
      const units = data.units || 1;
      return (val.currentValue || 0) / units;
    }
    if (type === 'crypto') {
      const qty = data.quantity || 1;
      return (val.currentValue || 0) / qty;
    }
    if (type === 'gold') {
      const qty = data.grams || data.units || 1;
      return (val.currentValue || 0) / qty;
    }
    if (type === 'realestate') {
      return val.currentValue || 0; // single unit
    }
    return val.currentValue || 0;
  }

  // ---------- taxLossHarvestingOpportunities ----------
  function taxLossHarvestingOpportunities(assets) {
    assets = assets || Store.all();
    const opportunities = [];

    for (const asset of assets) {
      const category = getAssetTaxCategory(asset);
      if (!category) continue;
      // Skip crypto (no set-off allowed)
      if (category === 'crypto') continue;

      const rules = TAX_RULES[category];
      const data = asset.data || {};
      const val = Store.valuation(asset);
      const currentPrice = _getCurrentPricePerUnit(asset, val);
      const lots = _extractLots(asset, data);

      for (const lot of lots) {
        const costBasis = lot.qty * lot.price;
        const currentValue = lot.qty * currentPrice;
        const unrealizedLoss = costBasis - currentValue;

        if (unrealizedLoss > 5000) {
          const holdingMonths = monthsBetween(lot.date, new Date().toISOString().slice(0, 10));
          const isLongTerm = rules.longTermThreshold ? holdingMonths >= rules.longTermThreshold : false;
          const taxRate = isLongTerm ? (rules.ltcgRate || 0.30) : (rules.stcgRate || 0.30);
          const potentialSaving = unrealizedLoss * taxRate;

          opportunities.push({
            assetId: asset.id,
            assetLabel: asset.label,
            assetType: asset.type,
            lotDate: lot.date,
            qty: lot.qty,
            costBasis,
            currentValue,
            unrealizedLoss,
            holdingMonths,
            isLongTerm,
            potentialSaving,
          });
        }
      }
    }

    // Sort by potential saving descending
    opportunities.sort((a, b) => b.potentialSaving - a.potentialSaving);
    return opportunities;
  }

  // ---------- get80CUtilization ----------
  function get80CUtilization(assets, liabilities) {
    assets = assets || Store.all();
    liabilities = liabilities || Store.liabilities();

    const limit = 150000;
    const breakdown = { ppf: 0, epf: 0, elss: 0, homeLoan: 0 };

    for (const a of assets) {
      const data = a.data || {};

      if (a.type === 'ppf') {
        // PPF annual contribution
        breakdown.ppf += (data.annualContribution || 0);
      }

      if (a.type === 'epf') {
        // EPF employee contribution (monthly x 12)
        breakdown.epf += (data.empContribution || 0) * 12;
      }

      if (a.type === 'mf') {
        // ELSS mutual funds
        const schemeName = (data.schemeName || '').toLowerCase();
        if (schemeName.includes('elss') || schemeName.includes('tax saver') || schemeName.includes('tax-saver')) {
          // Use SIP amount x 12 or total invested in current FY
          if (data.sipAmount) {
            breakdown.elss += data.sipAmount * 12;
          } else if (data.totalInvested) {
            // Approximate current FY investment
            breakdown.elss += Math.min(data.totalInvested, 150000);
          }
        }
      }

      if (a.type === 'fd' && data.taxSaver) {
        // Tax-saver FD principal
        breakdown.homeLoan += (data.principal || 0); // reuses homeLoan bucket for simplicity... no, let's add a separate key
      }
    }

    // Home loan principal component
    for (const l of liabilities) {
      if (l.type === 'homeloan' && l.emi) {
        const r = (l.rate || 0) / 100;
        const split = typeof Fin !== 'undefined' ? Fin.emiSplit(l.principal, r, l.emi) : null;
        if (split) {
          // Annual principal repayment (approximate: principal portion of EMI x 12)
          breakdown.homeLoan += (split.principal || 0) * 12;
        }
      }
    }

    const utilized = Math.min(limit,
      breakdown.ppf + breakdown.epf + breakdown.elss + breakdown.homeLoan);

    return {
      limit,
      utilized,
      remaining: Math.max(0, limit - utilized),
      breakdown,
    };
  }

  // ---------- get80CCDUtilization ----------
  function get80CCDUtilization(assets) {
    assets = assets || Store.all();
    const limit = 50000;
    let utilized = 0;

    for (const a of assets) {
      if (a.type === 'nps') {
        const data = a.data || {};
        // Monthly contribution x 12 for annual figure
        utilized += (data.monthlyContribution || 0) * 12;
      }
    }

    utilized = Math.min(limit, utilized);

    return {
      limit,
      utilized,
      remaining: Math.max(0, limit - utilized),
    };
  }

  // ---------- renderTaxReport ----------
  function renderTaxReport() {
    const assets = Store.all();
    let totalSTCG = 0;
    let totalLTCG = 0;
    let totalTaxLiability = 0;
    const holdings = [];

    for (const asset of assets) {
      const result = calculateCapitalGains(asset);
      if (!result) continue;
      totalSTCG += result.totalSTCG;
      totalLTCG += result.totalLTCG;
      totalTaxLiability += result.totalTax;
      holdings.push({ asset, result });
    }

    const harvestOps = taxLossHarvestingOpportunities(assets);
    const sec80c = get80CUtilization(assets, Store.liabilities());

    let html = '';

    // Summary cards
    html += `<div class="tax-summary-cards">`;
    html += `<div class="tax-card">
      <div class="tax-card-label">Short-term Capital Gains</div>
      <div class="tax-card-value ${totalSTCG >= 0 ? 'positive' : 'negative'}">${Fin.fmtINR(totalSTCG, { compact: true })}</div>
    </div>`;
    html += `<div class="tax-card">
      <div class="tax-card-label">Long-term Capital Gains</div>
      <div class="tax-card-value ${totalLTCG >= 0 ? 'positive' : 'negative'}">${Fin.fmtINR(totalLTCG, { compact: true })}</div>
    </div>`;
    html += `<div class="tax-card">
      <div class="tax-card-label">Estimated Tax Liability</div>
      <div class="tax-card-value negative">${Fin.fmtINR(totalTaxLiability, { compact: true })}</div>
    </div>`;
    html += `</div>`;

    // Per-holding breakdown table
    html += `<div class="tax-section">
      <h3>Per-Holding Breakdown</h3>
      <table class="tax-table">
        <thead>
          <tr>
            <th>Holding</th>
            <th>Type</th>
            <th>STCG</th>
            <th>LTCG</th>
            <th>Tax</th>
          </tr>
        </thead>
        <tbody>`;

    for (const { asset, result } of holdings) {
      html += `<tr>
        <td>${esc(asset.label)}</td>
        <td>${esc(asset.type)}</td>
        <td class="${result.totalSTCG >= 0 ? 'positive' : 'negative'}">${Fin.fmtINR(result.totalSTCG, { compact: true })}</td>
        <td class="${result.totalLTCG >= 0 ? 'positive' : 'negative'}">${Fin.fmtINR(result.totalLTCG, { compact: true })}</td>
        <td>${Fin.fmtINR(result.totalTax, { compact: true })}</td>
      </tr>`;
    }

    html += `</tbody></table></div>`;

    // Tax-loss harvesting opportunities
    html += `<div class="tax-section">
      <h3>Tax-Loss Harvesting Opportunities</h3>`;

    if (harvestOps.length === 0) {
      html += `<p class="tax-empty">No significant unrealized losses to harvest at this time.</p>`;
    } else {
      html += `<table class="tax-table">
        <thead>
          <tr>
            <th>Holding</th>
            <th>Purchase Date</th>
            <th>Unrealized Loss</th>
            <th>Potential Tax Saving</th>
          </tr>
        </thead>
        <tbody>`;

      for (const op of harvestOps.slice(0, 10)) {
        html += `<tr>
          <td>${esc(op.assetLabel)}</td>
          <td>${Fin.fmtDate(op.lotDate)}</td>
          <td class="negative">${Fin.fmtINR(op.unrealizedLoss, { compact: true })}</td>
          <td class="positive">${Fin.fmtINR(op.potentialSaving, { compact: true })}</td>
        </tr>`;
      }

      html += `</tbody></table>`;
    }
    html += `</div>`;

    // 80C utilization bar
    html += `<div class="tax-section">
      <h3>Section 80C Utilization</h3>
      <div class="tax-80c-bar">
        <div class="tax-80c-progress" style="width: ${Math.min(100, (sec80c.utilized / sec80c.limit) * 100)}%"></div>
      </div>
      <div class="tax-80c-meta">
        <span>Utilized: ${Fin.fmtINR(sec80c.utilized, { compact: true })}</span>
        <span>Remaining: ${Fin.fmtINR(sec80c.remaining, { compact: true })}</span>
        <span>Limit: ${Fin.fmtINR(sec80c.limit, { compact: true })}</span>
      </div>
      <div class="tax-80c-breakdown">`;

    if (sec80c.breakdown.ppf > 0) html += `<div class="tax-80c-item"><span>PPF</span><span>${Fin.fmtINR(sec80c.breakdown.ppf, { compact: true })}</span></div>`;
    if (sec80c.breakdown.epf > 0) html += `<div class="tax-80c-item"><span>EPF</span><span>${Fin.fmtINR(sec80c.breakdown.epf, { compact: true })}</span></div>`;
    if (sec80c.breakdown.elss > 0) html += `<div class="tax-80c-item"><span>ELSS</span><span>${Fin.fmtINR(sec80c.breakdown.elss, { compact: true })}</span></div>`;
    if (sec80c.breakdown.homeLoan > 0) html += `<div class="tax-80c-item"><span>Home Loan Principal</span><span>${Fin.fmtINR(sec80c.breakdown.homeLoan, { compact: true })}</span></div>`;

    html += `</div></div>`;

    return html;
  }

  // ---------- renderTaxPlan ----------
  function renderTaxPlan() {
    const assets = Store.all();
    const liabilities = Store.liabilities();
    const sec80c = get80CUtilization(assets, liabilities);
    const sec80ccd = get80CCDUtilization(assets);

    let html = '';

    // Income bracket & regime selection form
    html += `<div class="tax-plan-form">
      <h3>Tax Planning Inputs</h3>
      <div class="tax-form-row">
        <label for="tax-income-bracket">Annual Income Bracket</label>
        <select id="tax-income-bracket">
          <option value="0">Up to 3L (No tax)</option>
          <option value="5">3L - 7L (5%)</option>
          <option value="10">7L - 10L (10%)</option>
          <option value="15">10L - 12L (15%)</option>
          <option value="20">12L - 15L (20%)</option>
          <option value="30" selected>Above 15L (30%)</option>
        </select>
      </div>
      <div class="tax-form-row">
        <label for="tax-regime">Tax Regime</label>
        <select id="tax-regime">
          <option value="new" selected>New Regime (default from FY 2023-24)</option>
          <option value="old">Old Regime (with deductions)</option>
        </select>
      </div>
    </div>`;

    // 80C utilization
    html += `<div class="tax-section">
      <h3>Section 80C (Old Regime)</h3>
      <div class="tax-80c-bar">
        <div class="tax-80c-progress" style="width: ${Math.min(100, (sec80c.utilized / sec80c.limit) * 100)}%"></div>
      </div>
      <div class="tax-80c-meta">
        <span>Utilized: ${Fin.fmtINR(sec80c.utilized, { compact: true })} / ${Fin.fmtINR(sec80c.limit, { compact: true })}</span>
        <span>Gap: ${Fin.fmtINR(sec80c.remaining, { compact: true })}</span>
      </div>
      <div class="tax-80c-breakdown">`;

    if (sec80c.breakdown.ppf > 0) html += `<div class="tax-80c-item"><span>PPF</span><span>${Fin.fmtINR(sec80c.breakdown.ppf, { compact: true })}</span></div>`;
    if (sec80c.breakdown.epf > 0) html += `<div class="tax-80c-item"><span>EPF (employee)</span><span>${Fin.fmtINR(sec80c.breakdown.epf, { compact: true })}</span></div>`;
    if (sec80c.breakdown.elss > 0) html += `<div class="tax-80c-item"><span>ELSS MFs</span><span>${Fin.fmtINR(sec80c.breakdown.elss, { compact: true })}</span></div>`;
    if (sec80c.breakdown.homeLoan > 0) html += `<div class="tax-80c-item"><span>Home Loan Principal</span><span>${Fin.fmtINR(sec80c.breakdown.homeLoan, { compact: true })}</span></div>`;

    html += `</div></div>`;

    // 80CCD(1B) utilization
    html += `<div class="tax-section">
      <h3>Section 80CCD(1B) — NPS</h3>
      <div class="tax-80c-bar">
        <div class="tax-80c-progress" style="width: ${Math.min(100, (sec80ccd.utilized / sec80ccd.limit) * 100)}%"></div>
      </div>
      <div class="tax-80c-meta">
        <span>Utilized: ${Fin.fmtINR(sec80ccd.utilized, { compact: true })} / ${Fin.fmtINR(sec80ccd.limit, { compact: true })}</span>
        <span>Gap: ${Fin.fmtINR(sec80ccd.remaining, { compact: true })}</span>
      </div>
    </div>`;

    // Tax optimization suggestions
    html += `<div class="tax-section">
      <h3>Tax Optimization Suggestions</h3>
      <ul class="tax-suggestions">`;

    const suggestions = _generateSuggestions(sec80c, sec80ccd, assets, liabilities);
    for (const s of suggestions) {
      html += `<li class="tax-suggestion tax-suggestion-${esc(s.priority)}">
        <span class="tax-suggestion-icon">${esc(s.icon)}</span>
        <div>
          <strong>${esc(s.title)}</strong>
          <p>${esc(s.body)}</p>
        </div>
      </li>`;
    }

    if (suggestions.length === 0) {
      html += `<li class="tax-suggestion"><p>Your tax planning looks well-optimized. No immediate suggestions.</p></li>`;
    }

    html += `</ul></div>`;

    // AI advice button
    html += `<div class="tax-section tax-ai-section">
      <h3>AI Tax Advice</h3>
      <p>Get personalized tax optimization recommendations based on your complete portfolio.</p>
      <button class="btn btn-primary" id="tax-ai-advice-btn">Get AI Tax Advice</button>
      <div id="tax-ai-advice-result" class="tax-ai-result"></div>
    </div>`;

    return html;
  }

  // Generate rule-based tax suggestions
  function _generateSuggestions(sec80c, sec80ccd, assets, liabilities) {
    const suggestions = [];

    // 80C gap
    if (sec80c.remaining > 0) {
      suggestions.push({
        icon: '1',
        priority: 'high',
        title: `${Fin.fmtINR(sec80c.remaining, { compact: true })} of 80C limit unused`,
        body: `Consider investing in ELSS, PPF, or a tax-saver FD to fully utilize your Section 80C deduction under the old regime.`,
      });
    }

    // 80CCD gap
    if (sec80ccd.remaining > 0) {
      const npsAssets = assets.filter(a => a.type === 'nps');
      if (npsAssets.length === 0) {
        suggestions.push({
          icon: '2',
          priority: 'medium',
          title: `Open an NPS account for additional ${Fin.fmtINR(sec80ccd.limit, { compact: true })} deduction`,
          body: `Section 80CCD(1B) allows an additional deduction of up to 50K for NPS contributions, over and above the 80C limit.`,
        });
      } else {
        suggestions.push({
          icon: '2',
          priority: 'medium',
          title: `${Fin.fmtINR(sec80ccd.remaining, { compact: true })} of 80CCD(1B) limit unused`,
          body: `Increase your NPS contribution to fully utilize the additional 50K deduction under old regime.`,
        });
      }
    }

    // LTCG exemption utilization — suggest booking profits if LTCG < 1.25L
    const equityAssets = assets.filter(a => {
      const cat = getAssetTaxCategory(a);
      return cat === 'equity' || cat === 'mf_equity';
    });
    let totalUnrealizedLTCG = 0;
    for (const a of equityAssets) {
      const result = calculateCapitalGains(a);
      if (result) totalUnrealizedLTCG += result.totalLTCG;
    }
    if (totalUnrealizedLTCG > 0 && totalUnrealizedLTCG < 125000) {
      suggestions.push({
        icon: '3',
        priority: 'low',
        title: 'Consider booking tax-free LTCG profits',
        body: `You have unrealized LTCG of ${Fin.fmtINR(totalUnrealizedLTCG, { compact: true })} in equity/MF. Since LTCG up to 1.25L is tax-free, you could sell and rebuy to reset your cost basis.`,
      });
    }

    // High-interest debt warning
    const highRateLoans = liabilities.filter(l => l.rate > 12 && l.type !== 'creditcard');
    if (highRateLoans.length > 0) {
      suggestions.push({
        icon: '4',
        priority: 'high',
        title: 'Prepay high-interest loans before investing',
        body: `You have ${highRateLoans.length} loan(s) at >12% interest. Prepaying these gives a guaranteed post-tax return higher than most investments.`,
      });
    }

    // Tax-loss harvesting reminder
    const harvestOps = taxLossHarvestingOpportunities(assets);
    if (harvestOps.length > 0) {
      const totalSaving = harvestOps.reduce((s, op) => s + op.potentialSaving, 0);
      suggestions.push({
        icon: '5',
        priority: 'medium',
        title: `Tax-loss harvesting: save up to ${Fin.fmtINR(totalSaving, { compact: true })}`,
        body: `You have ${harvestOps.length} lot(s) with unrealized losses that could be sold to offset capital gains.`,
      });
    }

    // Crypto TDS reminder
    const cryptoAssets = assets.filter(a => a.type === 'crypto');
    if (cryptoAssets.length > 0) {
      suggestions.push({
        icon: '6',
        priority: 'info',
        title: 'Remember 1% TDS on crypto transfers',
        body: `All crypto transfers above 10K (or 50K for specified persons) attract 1% TDS. Ensure you claim TDS credit when filing returns.`,
      });
    }

    return suggestions;
  }

  // ---------- public API ----------
  return {
    TAX_RULES,
    getAssetTaxCategory,
    calculateCapitalGains,
    taxLossHarvestingOpportunities,
    get80CUtilization,
    get80CCDUtilization,
    renderTaxReport,
    renderTaxPlan,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Tax = Tax;
