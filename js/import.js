/* ============================================================
   WealthForge AI — bulk CSV import (per asset type)
   Backs the "Import statement / CSV" band on every add-asset
   form. Pure parsing/mapping functions (Node-testable) plus the
   preview/confirm modal. Imported assets flow through the same
   Store.add → cloud upsert path as the manual form.

   UX: partial import — valid rows import, invalid rows are
   reported per row (number + reason) in the preview and in the
   post-import summary. Nothing commits until the user clicks
   Import in the preview.
   ============================================================ */

const Importer = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  // ---------- CSV primitives ----------
  // RFC-ish CSV: quoted fields, embedded commas/quotes, CR/LF endings.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    const push = () => { row.push(field); field = ''; };
    const endRow = () => { push(); if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim())); row = []; };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') push();
      else if (ch === '\n') endRow();
      else if (ch !== '\r') field += ch;
    }
    if (field !== '' || row.length) endRow();
    return rows;
  }

  // Accepts ISO (2023-01-05), Indian numeric (05-01-2023, 05/01/2023),
  // and month-name (05-Jan-2023, 5 Jan 2023) forms → ISO, or null.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function normalizeDate(s) {
    if (!s) return null;
    s = String(s).trim();
    let y, m, d, mm;
    if ((mm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
    else if ((mm = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) { d = +mm[1]; m = +mm[2]; y = +mm[3]; } // DD-MM-YYYY (Indian)
    else if ((mm = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]+(\d{4})$/))) {
      d = +mm[1]; m = MONTHS[mm[2].slice(0, 3).toLowerCase()]; y = +mm[3];
      if (!m) return null;
    } else return null;
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // "₹2,450.50" / "2 450.50" / "2450.5" → 2450.5; null when not a number
  function parseNumber(s) {
    if (s == null) return null;
    const cleaned = String(s).replace(/[₹$\s,]/g, '');
    if (cleaned === '') return null;
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  }

  function parseBool(s) {
    return /^(true|yes|y|1)$/i.test(String(s || '').trim());
  }

  const normKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // ---------- per-type schemas ----------
  // col: { key, label, req?, aliases? } — kind/validation live in mapRow.
  // mapRow(o, err) returns the asset's { acquiredOn, label?, data } or null
  // after calling err(message). All field names mirror Forms' collect().
  const col = (key, label, req, aliases) => ({ key, label, req: !!req, aliases: aliases || [] });

  const SCHEMAS = {
    equity: {
      doc: 'One share holding per row.',
      example: 'symbol,quantity,avg_price,date\nRELIANCE,10,2450.50,2023-01-05',
      columns: [
        col('symbol', 'Ticker symbol', true, ['ticker', 'scrip', 'stock']),
        col('quantity', 'Quantity', true, ['qty', 'shares']),
        col('avg_price', 'Average buy price ₹', false, ['price', 'avgprice', 'buy_price']),
        col('date', 'First-buy date', true, ['acquired', 'buy_date', 'purchase_date']),
        col('total_invested', 'Total invested ₹', false, ['invested', 'amount', 'cost']),
        col('isin', 'ISIN', false, []),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const symbol = (o.symbol || '').toUpperCase();
        if (!symbol) return err('missing symbol');
        const stk = Market.getStock(symbol);
        if (!stk) return err(`unknown symbol "${symbol}" — not in the NSE/BSE master`);
        const quantity = parseNumber(o.quantity);
        if (!quantity || quantity <= 0) return err('quantity must be a positive number');
        const date = normalizeDate(o.date);
        if (!date) return err(`invalid date "${o.date || ''}" — use YYYY-MM-DD or DD-MM-YYYY`);
        const avgPrice = parseNumber(o.avg_price), totalInvested = parseNumber(o.total_invested);
        if (avgPrice == null && totalInvested == null) return err('enter avg_price or total_invested');
        const finalAvg = avgPrice != null ? avgPrice : +(totalInvested / quantity).toFixed(4);
        return { acquiredOn: date, data: {
          symbol, quantity,
          avgPrice: finalAvg,
          totalInvested: totalInvested != null ? totalInvested : +(quantity * avgPrice).toFixed(2),
          lastPrice: stk.price != null ? undefined : finalAvg, // no LTP feed → freeze at cost
          isin: o.isin || (stk.isin || undefined),
        } };
      },
    },

    mf: {
      doc: 'One scheme holding per row. plan: Direct/Regular · option: Growth/IDCW.',
      example: 'scheme_code,units,avg_nav,date,plan\n120503,150.5,142.10,2022-06-01,Direct',
      columns: [
        col('scheme_code', 'AMFI scheme code', true, ['code', 'amfi_code', 'scheme']),
        col('units', 'Units held', false, []),
        col('avg_nav', 'Average cost NAV ₹', false, ['nav', 'avgnav', 'cost_nav']),
        col('date', 'First investment date', true, ['acquired', 'investment_date']),
        col('amount', 'Amount invested ₹', false, ['invested', 'total_invested']),
        col('plan', 'Direct / Regular', false, []),
        col('option', 'Growth / IDCW', false, []),
        col('folio', 'Folio number', false, []),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const code = String(o.scheme_code || '').trim();
        if (!code) return err('missing scheme_code');
        const sch = Market.getScheme(code);
        if (!sch) return err(`unknown scheme code "${code}" — not in the AMFI fund master`);
        const date = normalizeDate(o.date);
        if (!date) return err(`invalid date "${o.date || ''}"`);
        const units = parseNumber(o.units), amount = parseNumber(o.amount), avgNav = parseNumber(o.avg_nav);
        let u = units, invested = amount;
        if (u == null && amount != null && avgNav) u = amount / avgNav;
        if (invested == null && u != null && avgNav) invested = u * avgNav;
        if (u == null) return err('enter units, or amount + avg_nav');
        const plan = /^reg/i.test(o.plan || '') ? 'Regular' : (sch.plan || 'Direct') === 'Regular' && !o.plan ? 'Regular' : 'Direct';
        const option = /^idcw|div/i.test(o.option || '') ? 'IDCW' : (sch.option === 'IDCW' && !o.option ? 'IDCW' : 'Growth');
        return { acquiredOn: date, data: {
          schemeCode: code, plan, option,
          units: u, avgNav: avgNav || (invested && u ? invested / u : undefined), totalInvested: invested,
          schemeName: sch.name,
          lastNav: Market.schemeNav(code, plan) || avgNav || undefined,
          folio: o.folio || undefined,
        } };
      },
    },

    crypto: {
      doc: 'One coin holding per row. currency: USD/INR (purchase currency).',
      example: 'coin,quantity,avg_price,date,currency\nBTC,0.05,52000,2023-11-20,USD',
      columns: [
        col('coin', 'Coin / token', true, ['coin_id', 'ticker', 'symbol']),
        col('quantity', 'Quantity held', true, ['qty']),
        col('avg_price', 'Average buy price', false, ['price', 'buy_price']),
        col('date', 'First-buy date', true, ['acquired', 'buy_date']),
        col('total_invested', 'Total invested', false, ['invested', 'amount', 'cost']),
        col('currency', 'Purchase currency', false, ['ccy']),
        col('wallet', 'Exchange / wallet', false, ['exchange']),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const coinId = (o.coin || '').toUpperCase();
        if (!coinId) return err('missing coin');
        const c = Market.getCoin(coinId);
        if (!c) return err(`unknown coin "${coinId}" — not in the market feed`);
        const quantity = parseNumber(o.quantity);
        if (!quantity || quantity <= 0) return err('quantity must be a positive number');
        const date = normalizeDate(o.date);
        if (!date) return err(`invalid date "${o.date || ''}"`);
        const avgPrice = parseNumber(o.avg_price), totalInvested = parseNumber(o.total_invested);
        if (avgPrice == null && totalInvested == null) return err('enter avg_price or total_invested');
        return { acquiredOn: date, data: {
          coinId, quantity, avgPrice, totalInvested,
          investCurrency: /^inr$/i.test(o.currency || '') ? 'INR' : 'USD',
          wallet: o.wallet || undefined, stable: !!c.stable,
        } };
      },
    },

    fd: {
      doc: 'One deposit per row. compounding: quarterly/monthly/half-yearly/annual/simple.',
      example: 'principal,rate,start_date,tenure_years,bank\n200000,7.25,2023-04-01,5,HDFC Bank',
      columns: [
        col('principal', 'Principal ₹', true, ['amount', 'deposit']),
        col('rate', 'Interest rate % p.a.', true, ['interest_rate', 'interest']),
        col('start_date', 'Booking date', true, ['date', 'start', 'booking_date']),
        col('tenure_years', 'Tenure (years)', false, ['tenure', 'years']),
        col('maturity_date', 'Maturity date', false, ['maturity']),
        col('bank', 'Bank / institution', false, ['institution']),
        col('compounding', 'Compounding', false, []),
        col('interest_type', 'cumulative / payout', false, []),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const principal = parseNumber(o.principal);
        if (!principal || principal <= 0) return err('principal must be a positive number');
        const rate = parseNumber(o.rate);
        if (rate == null || rate <= 0) return err('rate must be a positive number');
        const start = normalizeDate(o.start_date);
        if (!start) return err(`invalid start_date "${o.start_date || ''}"`);
        let tenure = parseNumber(o.tenure_years);
        const maturity = o.maturity_date ? normalizeDate(o.maturity_date) : null;
        if (o.maturity_date && !maturity) return err(`invalid maturity_date "${o.maturity_date}"`);
        if (tenure == null && maturity) tenure = Fin.fdTenureYears(start, maturity);
        if (!tenure || tenure <= 0) return err('enter tenure_years or maturity_date');
        const comp = String(o.compounding || 'quarterly').toLowerCase();
        if (!['quarterly', 'monthly', 'half-yearly', 'annual', 'simple'].includes(comp)) return err(`unknown compounding "${o.compounding}"`);
        return { acquiredOn: start, data: {
          principal, rate, startDate: start, tenureYears: tenure,
          maturityDate: maturity || Fin.addYears(start, tenure).toISOString().slice(0, 10),
          compounding: comp,
          interestType: /^payout|non/i.test(o.interest_type || '') ? 'payout' : 'cumulative',
          bank: o.bank || undefined, institutionType: 'bank',
          payoutFreq: 'quarterly', autoRenew: 'none', status: 'active',
          taxSaver: false, seniorRate: false, tds: true,
        } };
      },
    },

    gold: {
      doc: 'One purchase per row. form: physical/digital/sgb/etf · metal: gold/silver · purity: 24K/22K/18K.',
      example: 'metal,form,grams,purity,buy_rate,date\ngold,physical,25,22K,5900,2021-10-12',
      columns: [
        col('metal', 'gold / silver', false, []),
        col('form', 'physical / digital / sgb / etf', false, []),
        col('grams', 'Weight (g) — physical/digital', false, ['weight']),
        col('purity', 'Purity (physical)', false, []),
        col('buy_rate', 'Rate at purchase ₹/g', false, ['rate']),
        col('units', 'Units — etf/sgb', false, []),
        col('buy_price', 'Buy price/unit — etf/sgb', false, ['price']),
        col('total_paid', 'Total paid ₹', false, ['total', 'amount', 'cost']),
        col('date', 'Purchase date', true, ['purchase_date', 'acquired']),
        col('name', 'ETF / SGB issue name', false, ['instrument', 'issue']),
        col('label', 'Label', false, ['nickname']),
      ],
      mapRow(o, err) {
        const metal = /^sil/i.test(o.metal || '') ? 'silver' : 'gold';
        const form = /^(physical|digital|sgb|etf)$/i.test(o.form || '') ? o.form.toLowerCase() : 'physical';
        const date = normalizeDate(o.date);
        if (!date) return err(`invalid date "${o.date || ''}"`);
        const isUnits = form === 'etf' || form === 'sgb';
        const data = { metal, form };
        if (isUnits) {
          data.units = parseNumber(o.units);
          if (!data.units || data.units <= 0) return err(`${form} rows need units`);
          data.buyPrice = parseNumber(o.buy_price) || undefined;
          const name = o.name || '';
          if (form === 'sgb') { data.sgbIssue = name; data.sgbRate = 2.5; } else data.etfName = name;
          const u = Market.GOLD_UNITS.find(g => (name && name.toLowerCase().includes(g.id.toLowerCase().slice(0, 4)) && g.kind === form) || (!name && g.kind === form));
          data.instrumentId = u ? u.id : undefined;
          if (!data.instrumentId) data.lastUnitPrice = data.buyPrice || 0;
        } else {
          data.grams = parseNumber(o.grams);
          if (!data.grams || data.grams <= 0) return err('physical/digital rows need grams');
          data.purity = /^(24K|22K|18K)$/i.test(o.purity || '') ? o.purity.toUpperCase() : (form === 'physical' ? '22K' : '24K');
          data.buyRate = parseNumber(o.buy_rate) || undefined;
        }
        data.totalPaid = parseNumber(o.total_paid) != null ? parseNumber(o.total_paid) : undefined;
        if (data.totalPaid == null && data.buyRate == null && data.buyPrice == null) return err('enter total_paid, buy_rate or buy_price');
        return { acquiredOn: date, data };
      },
    },

    epf: {
      doc: 'Usually one row — your EPF account from the latest statement.',
      example: 'balance,as_of_date,emp_contribution,er_contribution,start_date\n1250000,2026-03-31,6000,6000,2015-07-01',
      columns: [
        col('balance', 'Statement balance ₹', true, []),
        col('as_of_date', 'Statement date', true, ['as_of', 'statement_date']),
        col('emp_contribution', 'Employee ₹/month', false, ['employee']),
        col('er_contribution', 'Employer ₹/month', false, ['employer']),
        col('rate', 'Rate % p.a.', false, []),
        col('start_date', 'Account start date', true, ['date', 'start']),
        col('current_age', 'Current age', false, ['age']),
        col('retirement_age', 'Retirement age', false, []),
        col('uan', 'UAN', false, []),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const balance = parseNumber(o.balance);
        if (balance == null) return err('balance is required');
        const asOf = normalizeDate(o.as_of_date);
        if (!asOf) return err(`invalid as_of_date "${o.as_of_date || ''}"`);
        const start = normalizeDate(o.start_date);
        if (!start) return err(`invalid start_date "${o.start_date || ''}"`);
        return { acquiredOn: start, data: {
          balance, asOfDate: asOf,
          empContribution: parseNumber(o.emp_contribution) || 0,
          erContribution: parseNumber(o.er_contribution) || 0,
          rate: parseNumber(o.rate) != null ? parseNumber(o.rate) : 8.25,
          currentAge: parseNumber(o.current_age) || 30,
          retirementAge: parseNumber(o.retirement_age) || 60,
          uan: o.uan || undefined,
        } };
      },
    },

    ppf: {
      doc: 'Usually one row — your PPF account.',
      example: 'balance,as_of_date,annual_contribution,open_date\n480000,2026-03-31,150000,2018-04-10',
      columns: [
        col('balance', 'Current balance ₹', true, []),
        col('as_of_date', 'Balance as of', true, ['as_of', 'statement_date']),
        col('annual_contribution', 'Annual contribution ₹', true, ['annual', 'contribution']),
        col('rate', 'Rate % p.a.', false, []),
        col('open_date', 'Account open date', true, ['date', 'start_date']),
        col('extension_years', 'Extension years (0/5/10/15)', false, ['extension']),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const balance = parseNumber(o.balance);
        if (balance == null) return err('balance is required');
        const asOf = normalizeDate(o.as_of_date);
        if (!asOf) return err(`invalid as_of_date "${o.as_of_date || ''}"`);
        const annual = parseNumber(o.annual_contribution);
        if (annual == null) return err('annual_contribution is required (0 is fine)');
        if (annual > 150000) return err('annual_contribution above the ₹1.5L PPF cap');
        const open = normalizeDate(o.open_date);
        if (!open) return err(`invalid open_date "${o.open_date || ''}"`);
        return { acquiredOn: open, data: {
          balance, asOfDate: asOf, annualContribution: annual,
          rate: parseNumber(o.rate) != null ? parseNumber(o.rate) : 7.1,
          openDate: open, extensionYears: parseNumber(o.extension_years) || 0,
        } };
      },
    },

    nps: {
      doc: 'Usually one row — your NPS account. alloc_e + alloc_c + alloc_g must sum to 100.',
      example: 'corpus,as_of_date,monthly_contribution,alloc_e,alloc_c,alloc_g,start_date\n900000,2026-06-30,10000,50,30,20,2019-01-15',
      columns: [
        col('corpus', 'Current corpus ₹', true, ['balance']),
        col('as_of_date', 'Corpus as of', true, ['as_of', 'statement_date']),
        col('monthly_contribution', 'Monthly contribution ₹', true, ['monthly']),
        col('alloc_e', 'Equity %', false, ['e']),
        col('alloc_c', 'Corporate debt %', false, ['c']),
        col('alloc_g', 'Govt securities %', false, ['g']),
        col('start_date', 'Account start date', true, ['date', 'start']),
        col('tier', 'Tier I / II', false, []),
        col('pran', 'PRAN', false, []),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const corpus = parseNumber(o.corpus);
        if (corpus == null) return err('corpus is required');
        const asOf = normalizeDate(o.as_of_date);
        if (!asOf) return err(`invalid as_of_date "${o.as_of_date || ''}"`);
        const monthly = parseNumber(o.monthly_contribution);
        if (monthly == null) return err('monthly_contribution is required (0 is fine)');
        const e = parseNumber(o.alloc_e) != null ? parseNumber(o.alloc_e) : 50;
        const c = parseNumber(o.alloc_c) != null ? parseNumber(o.alloc_c) : 30;
        const g = parseNumber(o.alloc_g) != null ? parseNumber(o.alloc_g) : 20;
        if (e + c + g !== 100) return err(`allocation sums to ${e + c + g} — must be 100`);
        const start = normalizeDate(o.start_date);
        if (!start) return err(`invalid start_date "${o.start_date || ''}"`);
        return { acquiredOn: start, data: {
          corpus, asOfDate: asOf, monthlyContribution: monthly,
          tier: /^ii$/i.test(o.tier || '') ? 'II' : 'I',
          allocE: e, allocC: c, allocG: g, pran: o.pran || undefined,
        } };
      },
    },

    smallsavings: {
      doc: 'One account/certificate per row. scheme: rd/ssy/kvp/nsc/pomis/potd. RD needs monthly_amount, SSY needs annual_contribution, others need principal.',
      example: 'scheme,rate,tenure_years,start_date,principal\nnsc,7.7,5,2023-08-01,100000',
      columns: [
        col('scheme', 'rd / ssy / kvp / nsc / pomis / potd', true, ['sub_type', 'subtype', 'type']),
        col('rate', 'Rate % p.a.', true, ['interest_rate']),
        col('tenure_years', 'Tenure (years)', true, ['tenure', 'years']),
        col('start_date', 'Start date', true, ['date', 'start']),
        col('principal', 'Principal ₹ (kvp/nsc/pomis/potd)', false, ['amount']),
        col('monthly_amount', 'Monthly deposit ₹ (rd)', false, ['monthly']),
        col('annual_contribution', 'Annual contribution ₹ (ssy)', false, ['annual']),
        col('balance', 'Current balance ₹ (ssy)', false, []),
        col('label', 'Label', false, ['name', 'nickname']),
      ],
      mapRow(o, err) {
        const st = String(o.scheme || '').toLowerCase();
        if (!['rd', 'ssy', 'kvp', 'nsc', 'pomis', 'potd'].includes(st)) return err(`unknown scheme "${o.scheme || ''}" — use rd/ssy/kvp/nsc/pomis/potd`);
        const rate = parseNumber(o.rate);
        if (rate == null) return err('rate is required');
        const tenure = parseNumber(o.tenure_years);
        if (!tenure) return err('tenure_years is required');
        const start = normalizeDate(o.start_date);
        if (!start) return err(`invalid start_date "${o.start_date || ''}"`);
        const data = { subType: st, rate, tenureYears: tenure, startDate: start };
        if (st === 'rd') {
          data.monthlyAmount = parseNumber(o.monthly_amount);
          if (!data.monthlyAmount) return err('rd rows need monthly_amount');
        } else if (st === 'ssy') {
          data.balance = parseNumber(o.balance) || 0;
          data.annualContribution = parseNumber(o.annual_contribution);
          data.asOfDate = start;
          if (data.annualContribution == null) return err('ssy rows need annual_contribution');
          if (data.annualContribution > 150000) return err('annual_contribution above the ₹1.5L SSY cap');
        } else {
          data.principal = parseNumber(o.principal);
          if (!data.principal) return err(`${st} rows need principal`);
        }
        return { acquiredOn: start, data };
      },
    },

    esop: {
      doc: 'One grant per row. grant_type: RSU/ISO/NSO · frequency: monthly/quarterly/annual · private: yes/no.',
      example: 'company,grant_type,total_units,vest_start,cliff_months,duration_months,ticker\nMicrosoft,RSU,240,2024-01-15,12,48,MSFT',
      columns: [
        col('company', 'Company', true, []),
        col('grant_type', 'RSU / ISO / NSO', false, ['type']),
        col('total_units', 'Total units granted', true, ['units', 'quantity']),
        col('vest_start', 'Vest start date', true, ['date', 'start_date']),
        col('cliff_months', 'Cliff (months)', false, ['cliff']),
        col('duration_months', 'Vesting period (months)', false, ['duration']),
        col('frequency', 'Vesting frequency', false, ['freq']),
        col('ticker', 'Listed ticker', false, ['symbol']),
        col('strike', 'Strike price (options)', false, []),
        col('share_price', 'Share price (private)', false, ['price']),
        col('currency', 'USD / INR', false, ['ccy']),
        col('private', 'Private company (yes/no)', false, []),
        col('label', 'Label', false, ['nickname']),
      ],
      mapRow(o, err) {
        const company = o.company || '';
        if (!company) return err('company is required');
        const units = parseNumber(o.total_units);
        if (!units || units <= 0) return err('total_units must be a positive number');
        const vestStart = normalizeDate(o.vest_start);
        if (!vestStart) return err(`invalid vest_start "${o.vest_start || ''}"`);
        const duration = parseNumber(o.duration_months) || 48;
        const grantType = /^iso$/i.test(o.grant_type || '') ? 'ISO' : /^nso$/i.test(o.grant_type || '') ? 'NSO' : 'RSU';
        const ticker = (o.ticker || '').toUpperCase();
        const sharePrice = parseNumber(o.share_price);
        const strike = parseNumber(o.strike);
        if (ticker && !Market.getStock(ticker)) return err(`unknown ticker "${ticker}" — leave blank for private companies`);
        if (!ticker && sharePrice == null) return err('enter share_price, or a listed ticker');
        if ((grantType === 'ISO' || grantType === 'NSO') && strike == null) return err('options need a strike price');
        return { acquiredOn: vestStart, label: `${company} ${grantType}`, data: {
          company, ticker: ticker || undefined, grantType, totalUnits: units, vestStart,
          cliffMonths: parseNumber(o.cliff_months) || 0,
          freq: /^(monthly|annual)$/i.test(o.frequency || '') ? o.frequency.toLowerCase() : 'quarterly',
          durationMonths: duration,
          strike: strike != null ? strike : undefined,
          sharePrice: sharePrice != null ? sharePrice : undefined,
          currency: /^inr$/i.test(o.currency || '') ? 'INR' : 'USD',
          isPrivate: parseBool(o.private) || undefined,
          assumedGrowth: 15,
        } };
      },
    },
  };

  function defaultLabel(type, d) {
    switch (type) {
      case 'equity': return d.symbol;
      case 'mf': { const s = Market.getScheme(d.schemeCode); return s ? s.name : 'Mutual fund'; }
      case 'fd': return `${d.bank || 'FD'} · ${d.rate}%`;
      case 'gold': return d.form === 'sgb' ? (d.sgbIssue || 'SGB') : d.form === 'etf' ? (d.etfName || 'Gold ETF') : `${d.metal === 'silver' ? 'Silver' : 'Gold'} (${d.form})`;
      case 'crypto': return d.coinId;
      case 'epf': return 'EPF / PF';
      case 'ppf': return 'PPF';
      case 'nps': return `NPS Tier ${d.tier || 'I'}`;
      case 'smallsavings': { const n = { rd: 'Recurring deposit', ssy: 'Sukanya Samriddhi', kvp: 'KVP', nsc: 'NSC', pomis: 'PO MIS', potd: 'PO TD' }; return n[d.subType] || 'Small savings'; }
      case 'esop': return `${d.company || 'ESOP'} ${d.grantType || 'RSU'}`;
      default: return 'Asset';
    }
  }

  // ---------- rows → assets ----------
  // Header row is detected when ≥2 cells match column keys/aliases;
  // otherwise columns are positional in schema order.
  function importRows(type, text) {
    const schema = SCHEMAS[type];
    if (!schema) return { assets: [], errors: [{ row: 0, message: `no CSV import for type "${type}"` }], total: 0 };
    const rows = parseCsv(text || '');
    if (!rows.length) return { assets: [], errors: [{ row: 0, message: 'no rows found — paste CSV or choose a file' }], total: 0 };

    const keyFor = cell => {
      const n = normKey(cell);
      const c = schema.columns.find(cl => cl.key === n || cl.aliases.includes(n));
      return c ? c.key : null;
    };
    const headerKeys = rows[0].map(keyFor);
    const isHeader = headerKeys.filter(Boolean).length >= 2;
    let dataRows = rows, mapping;
    if (isHeader) {
      dataRows = rows.slice(1);
      mapping = headerKeys;
      const missing = schema.columns.filter(c => c.req && !mapping.includes(c.key));
      if (missing.length) return { assets: [], errors: [{ row: 1, message: `header is missing required column(s): ${missing.map(c => c.key).join(', ')}` }], total: rows.length - 1 };
    } else {
      mapping = schema.columns.map(c => c.key); // positional
    }

    const assets = [], errors = [];
    dataRows.forEach((cells, i) => {
      const rowNo = i + (isHeader ? 2 : 1); // 1-based, counting the header line
      const o = {};
      mapping.forEach((k, ci) => { if (k && cells[ci] != null && cells[ci] !== '') o[k] = cells[ci]; });
      let message = null;
      const res = schema.mapRow(o, m => { message = m; return null; });
      if (!res) { errors.push({ row: rowNo, message: message || 'invalid row' }); return; }
      assets.push({
        type,
        label: o.label || res.label || defaultLabel(type, res.data),
        acquiredOn: res.acquiredOn,
        currency: type === 'crypto' ? 'USD' : 'INR',
        data: res.data,
        ownership: 'single', sharePct: 100, tags: [], notes: '',
      });
    });
    return { assets, errors, total: dataRows.length };
  }

  // Resolve identifiers against the cloud master tables before the sync
  // importRows validation runs (no-op in local mode). Candidates are
  // gathered as a cheap superset of all cells that look like the id.
  async function prefetchMasters(type, text) {
    const supa = typeof globalThis !== 'undefined' ? globalThis.Supa : null;
    if (!supa || !supa.client) return;
    const cells = parseCsv(text || '').flat();
    try {
      if (type === 'mf') {
        const codes = [...new Set(cells.filter(c => /^\d{5,7}$/.test(c)))].filter(c => !Market.getScheme(c));
        if (!codes.length) return;
        const { data } = await supa.client.from('mf_master')
          .select('scheme_code,name,amc,category,plan,option,isin,nav,nav_date').in('scheme_code', codes);
        (data || []).forEach(r => Market.registerScheme({
          code: r.scheme_code, name: r.name, amc: r.amc, category: r.category,
          plan: r.plan, option: r.option, isin: r.isin,
          nav: r.nav != null ? Number(r.nav) : null, navDate: r.nav_date,
        }));
      } else if (type === 'equity' || type === 'esop') {
        const syms = [...new Set(cells.map(c => c.toUpperCase()).filter(c => /^[A-Z][A-Z0-9&-]{1,19}$/.test(c)))]
          .filter(s => !Market.getStock(s));
        if (!syms.length) return;
        const { data } = await supa.client.from('equity_master')
          .select('exchange,symbol,name,isin').in('symbol', syms);
        const rows = (data || []).sort((a, b) => (a.exchange === 'NSE' ? -1 : 1) - (b.exchange === 'NSE' ? -1 : 1));
        rows.forEach(r => { if (!Market.getStock(r.symbol)) Market.registerStock({ symbol: r.symbol, name: r.name, isin: r.isin, exchange: r.exchange }); });
      }
    } catch (e) { console.error('prefetchMasters failed — falling back to built-in lists', e); }
  }

  // ---------- preview / confirm modal ----------
  function openModal(type) {
    const schema = SCHEMAS[type];
    if (!schema) { UI.toast('CSV import is not available for this asset type'); return; }
    const t = Store.TYPES[type];
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal" role="dialog" aria-label="Import ${esc(t.label)}" style="max-width:760px;width:92vw">
      <h3>${t.icon} Bulk import — ${esc(t.label)}</h3>
      <p class="small dim" style="margin-bottom:10px">${esc(schema.doc)} Valid rows import; problem rows are listed with the reason and skipped.</p>
      <div class="field" style="margin-bottom:8px">
        <label>Columns — <code>${schema.columns.filter(c => c.req).map(c => c.key).join(', ')}</code> required${schema.columns.some(c => !c.req) ? `; optional: <code>${schema.columns.filter(c => !c.req).map(c => c.key).join(', ')}</code>` : ''}</label>
        <textarea id="imp_text" rows="6" placeholder="${esc(schema.example)}"></textarea>
        <div class="hint">First line may be a header (recommended) — or paste bare values in the order above. Dates: YYYY-MM-DD or DD-MM-YYYY.</div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <input type="file" id="imp_file" accept=".csv,.txt,text/csv,text/plain" style="max-width:280px"/>
        <button class="btn sm" id="imp_preview">Preview</button>
      </div>
      <div id="imp_result" style="max-height:280px;overflow:auto"></div>
      <div class="modal-actions">
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn primary" id="imp_commit" disabled>Import</button>
      </div>
    </div>`;
    document.body.appendChild(back);
    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());

    const textEl = back.querySelector('#imp_text');
    const fileEl = back.querySelector('#imp_file');
    const resultEl = back.querySelector('#imp_result');
    const commitBtn = back.querySelector('#imp_commit');
    let pending = null;

    fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { UI.toast('File too large — 2 MB max for CSV import'); fileEl.value = ''; return; }
      const rd = new FileReader();
      rd.onload = () => { textEl.value = String(rd.result || ''); preview(); };
      rd.readAsText(f);
    });

    async function preview() {
      await prefetchMasters(type, textEl.value);
      const res = importRows(type, textEl.value);
      pending = res;
      const okRows = res.assets.map(a => {
        const v = Store.valuation(a);
        return `<tr><td>✅</td><td class="asset-name">${esc(a.label)}</td><td class="num">${Fin.fmtINR(v.currentValue || 0, { compact: true })}</td><td class="dim small">ready</td></tr>`;
      }).join('');
      const errRows = res.errors.map(e2 => `<tr><td>⚠️</td><td colspan="2" class="dim">Row ${e2.row}</td><td class="small" style="color:var(--neg)">${esc(e2.message)}</td></tr>`).join('');
      resultEl.innerHTML = res.total || res.errors.length ? `
        <div class="small" style="margin-bottom:6px"><b>${res.assets.length}</b> ready to import${res.errors.length ? ` · <b>${res.errors.length}</b> row(s) skipped` : ''}</div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th></th><th>Holding</th><th class="num">Value today</th><th>Status</th></tr></thead>
          <tbody>${okRows}${errRows}</tbody>
        </table></div>` : '<div class="empty small">Nothing to preview yet.</div>';
      commitBtn.disabled = !res.assets.length;
      commitBtn.textContent = res.assets.length ? `Import ${res.assets.length} holding${res.assets.length > 1 ? 's' : ''}` : 'Import';
    }
    back.querySelector('#imp_preview').addEventListener('click', preview);

    commitBtn.addEventListener('click', () => {
      if (!pending || !pending.assets.length) return;
      if (Store.isReadOnly()) { UI.toast('Demo data is read-only — sign up to import your own portfolio'); return; }
      pending.assets.forEach(a => Store.add(a));
      const n = pending.assets.length, skipped = pending.errors;
      UI.toast(`${n} imported${skipped.length ? `, ${skipped.length} skipped` : ''}`);
      if (skipped.length) {
        // post-import summary keeps the skipped-row reasons on screen
        resultEl.innerHTML = `
          <div class="small" style="margin-bottom:6px"><b>${n}</b> imported · <b>${skipped.length}</b> skipped:</div>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            ${skipped.map(e2 => `<tr><td>⚠️</td><td class="dim">Row ${e2.row}</td><td class="small" style="color:var(--neg)">${esc(e2.message)}</td></tr>`).join('')}
          </tbody></table></div>`;
        textEl.disabled = true; fileEl.disabled = true;
        commitBtn.textContent = 'Done'; pending = null;
        commitBtn.disabled = false;
        commitBtn.onclick = null;
        commitBtn.addEventListener('click', () => { back.remove(); Router.go(`/holdings/${type}`); }, { once: true });
      } else {
        back.remove();
        Router.go(`/holdings/${type}`);
      }
    });
  }

  return { parseCsv, normalizeDate, parseNumber, importRows, prefetchMasters, openModal, SCHEMAS };
})();

if (typeof globalThis !== 'undefined') globalThis.Importer = Importer;
