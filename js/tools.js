/* ============================================================
   WealthForge AI — financial planning calculators
   Retirement planning, emergency fund analysis, loan prepayment
   comparison, SIP step-up planner, goal gap analysis.
   Pure calculation + render functions returning HTML strings.
   ============================================================ */

const Tools = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const { fmtINR, fmtPct, fmtDate } = Fin;

  // ---------- 1. Retirement Calculator ----------
  function retirementCalculator(inputs) {
    const {
      currentAge,
      retirementAge,
      monthlyExpenses,
      inflationRate = 6,
      expectedReturn = 12,
      postRetReturn = 7,
      lifeExpectancy = 85,
      existingCorpus = 0,
    } = inputs;

    const yearsToRetirement = Math.max(0, retirementAge - currentAge);
    const yearsInRetirement = Math.max(0, lifeExpectancy - retirementAge);

    // Monthly expenses at retirement adjusted for inflation
    const futureMonthlyExpense = monthlyExpenses * Math.pow(1 + inflationRate / 100, yearsToRetirement);

    // Corpus needed at retirement: inflation-adjusted annuity
    // Real rate of return post retirement
    const realPostRetRate = ((1 + postRetReturn / 100) / (1 + inflationRate / 100)) - 1;
    let corpusNeeded;
    if (realPostRetRate <= 0) {
      // If real return is zero or negative, simple multiplication
      corpusNeeded = futureMonthlyExpense * 12 * yearsInRetirement;
    } else {
      // Present value of annuity formula (at retirement date)
      const monthlyReal = realPostRetRate / 12;
      const n = yearsInRetirement * 12;
      corpusNeeded = futureMonthlyExpense * ((1 - Math.pow(1 + monthlyReal, -n)) / monthlyReal);
    }

    // Existing corpus grown to retirement
    const existingCorpusAtRetirement = existingCorpus * Math.pow(1 + expectedReturn / 100, yearsToRetirement);

    // Gap
    const gap = Math.max(0, corpusNeeded - existingCorpusAtRetirement);

    // SIP needed to fill the gap
    let sipNeeded = 0;
    if (gap > 0 && yearsToRetirement > 0) {
      const monthlyReturn = (expectedReturn / 100) / 12;
      const months = yearsToRetirement * 12;
      if (monthlyReturn === 0) {
        sipNeeded = gap / months;
      } else {
        // FV of annuity = PMT * ((1+r)^n - 1) / r => PMT = FV * r / ((1+r)^n - 1)
        sipNeeded = gap * monthlyReturn / (Math.pow(1 + monthlyReturn, months) - 1);
      }
    }

    return {
      corpusNeeded: Math.round(corpusNeeded),
      existingCorpusAtRetirement: Math.round(existingCorpusAtRetirement),
      gap: Math.round(gap),
      sipNeeded: Math.round(sipNeeded),
      futureMonthlyExpense: Math.round(futureMonthlyExpense),
      yearsToRetirement,
      yearsInRetirement,
    };
  }

  // ---------- 2. Emergency Fund Analysis ----------
  function emergencyFundAnalysis() {
    const liabs = Store.liabilities();
    const assets = Store.all();

    // Monthly outflows: sum of all EMIs
    const monthlyOutflow = liabs.reduce((sum, l) => sum + (l.emi || 0), 0);

    // Recommend 6 months of total outflows as emergency fund
    const recommended = monthlyOutflow * 6;

    // Current liquid assets: FDs maturing within 1 year + liquid MF schemes
    let currentLiquid = 0;
    const now = new Date();
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    for (const a of assets) {
      const d = a.data || {};
      if (a.type === 'fd') {
        const matDate = Fin.fdMaturityDate(d.startDate || a.acquiredOn, d.tenureYears || 1);
        if (new Date(matDate) <= oneYearFromNow) {
          const val = Store.valuation(a);
          currentLiquid += val.currentValue || 0;
        }
      } else if (a.type === 'mf') {
        // Check if it is a liquid/debt fund (category hint from Market or label)
        const scheme = typeof Market !== 'undefined' ? Market.getScheme(d.schemeCode) : null;
        if (scheme && (scheme.category === 'liquid' || scheme.category === 'debt')) {
          const val = Store.valuation(a);
          currentLiquid += val.currentValue || 0;
        }
      }
    }

    const gap = Math.max(0, recommended - currentLiquid);
    const adequacy = monthlyOutflow > 0 ? currentLiquid / monthlyOutflow : (currentLiquid > 0 ? Infinity : 0);

    return {
      monthlyOutflow: Math.round(monthlyOutflow),
      recommended: Math.round(recommended),
      currentLiquid: Math.round(currentLiquid),
      gap: Math.round(gap),
      adequacy: Math.round(adequacy * 10) / 10, // months covered, 1 decimal
    };
  }

  // ---------- 3. Loan Prepayment Analysis ----------
  function loanPrepaymentAnalysis(liabilityId, surplusAmount) {
    const l = Store.getLiability(liabilityId);
    if (!l || !l.emi || !l.rate) {
      return null;
    }

    const lv = Store.liabilityValuation(l);
    const balance = lv.balance;
    const annualRate = l.rate / 100;
    const emi = l.emi;

    // Current scenario
    const currentPayoffMonths = Fin.loanPayoffMonths(balance, annualRate, emi);
    const currentInterest = Fin.loanInterestRemaining(balance, annualRate, emi);

    // Scenario 1: Prepay and reduce tenure (keep same EMI)
    const newBalanceAfterPrepay = Math.max(0, balance - surplusAmount);
    const newPayoffMonths = Fin.loanPayoffMonths(newBalanceAfterPrepay, annualRate, emi);
    const newInterest = Fin.loanInterestRemaining(newBalanceAfterPrepay, annualRate, emi);
    const monthsSaved = currentPayoffMonths != null && newPayoffMonths != null
      ? currentPayoffMonths - newPayoffMonths : 0;
    const interestSaved = currentInterest != null && newInterest != null
      ? currentInterest - newInterest : 0;

    // Scenario 2: Prepay and reduce EMI (keep same tenure)
    let newEMI = emi;
    let monthlySaving = 0;
    if (currentPayoffMonths != null && newBalanceAfterPrepay > 0) {
      newEMI = Fin.loanEmi(newBalanceAfterPrepay, annualRate, currentPayoffMonths);
      monthlySaving = Math.max(0, emi - newEMI);
    } else if (newBalanceAfterPrepay <= 0) {
      newEMI = 0;
      monthlySaving = emi;
    }

    // Scenario 3: Invest the surplus instead (12% equity, 10% LTCG on gains)
    const investReturn = 0.12;
    const investYears = currentPayoffMonths != null ? currentPayoffMonths / 12 : 5;
    const futureValue = surplusAmount * Math.pow(1 + investReturn, investYears);
    const gain = futureValue - surplusAmount;
    const ltcgTax = gain > 125000 ? (gain - 125000) * 0.10 : 0; // LTCG exemption 1.25L
    const gainPostTax = gain - ltcgTax;

    // Recommendation
    let recommendation;
    if (interestSaved > gainPostTax) {
      recommendation = 'Prepaying the loan saves more than investing — choose reduce-tenure for maximum saving.';
    } else {
      recommendation = 'Investing the surplus likely generates higher post-tax wealth than prepaying the loan.';
    }

    return {
      prepayReduceTenure: {
        monthsSaved: Math.round(monthsSaved),
        interestSaved: Math.round(interestSaved),
      },
      prepayReduceEMI: {
        newEMI: Math.round(newEMI),
        monthlySaving: Math.round(monthlySaving),
      },
      investInstead: {
        futureValue: Math.round(futureValue),
        gainPostTax: Math.round(gainPostTax),
      },
      recommendation,
    };
  }

  // ---------- 4. SIP Step-Up Planner ----------
  function sipStepUpPlanner(inputs) {
    const {
      currentSIP,
      stepUpPct = 10,
      years = 10,
      expectedReturn = 12,
    } = inputs;

    const monthlyRate = (expectedReturn / 100) / 12;
    const yearWise = [];
    let totalInvested = 0;
    let corpus = 0;
    let sip = currentSIP;

    for (let y = 1; y <= years; y++) {
      const yearlyInvested = sip * 12;
      totalInvested += yearlyInvested;

      // For each month in this year, compound the SIP
      for (let m = 0; m < 12; m++) {
        corpus = (corpus + sip) * (1 + monthlyRate);
      }

      yearWise.push({
        year: y,
        sip: Math.round(sip),
        invested: Math.round(totalInvested),
        value: Math.round(corpus),
      });

      // Step up SIP for next year
      sip = sip * (1 + stepUpPct / 100);
    }

    const finalCorpus = Math.round(corpus);
    const wealthGain = finalCorpus - Math.round(totalInvested);

    return {
      finalCorpus,
      totalInvested: Math.round(totalInvested),
      wealthGain,
      yearWise,
    };
  }

  // ---------- 5. Goal Gap Analysis ----------
  function goalGapAnalysis() {
    const goals = Store.goals();
    const p = Store.portfolio();
    const nw = p.netWorth;

    return goals.map(g => {
      const target = g.targetAmount || 0;
      const progress = target > 0 ? Math.min(1, nw / target) : 0;
      const gap = Math.max(0, target - nw);

      // Monthly SIP needed to fill the gap
      let sipNeeded = 0;
      if (gap > 0) {
        let months;
        if (g.targetDate) {
          const targetDate = new Date(g.targetDate);
          const now = new Date();
          months = Math.max(1, Math.round((targetDate - now) / (30.44 * 24 * 3600 * 1000)));
        } else {
          months = 60; // default 5 years if no target date
        }
        const monthlyReturn = 0.10 / 12; // assume 10% annual return
        if (monthlyReturn === 0) {
          sipNeeded = gap / months;
        } else {
          sipNeeded = gap * monthlyReturn / (Math.pow(1 + monthlyReturn, months) - 1);
        }
      }

      const onTrack = g.achieved || (gap === 0);

      return {
        goal: g,
        progress,
        gap: Math.round(gap),
        sipNeeded: Math.round(sipNeeded),
        onTrack,
      };
    });
  }

  // ---------- 6. Render: Tools Grid View ----------
  function renderToolsView() {
    const cards = [
      { id: 'retirement', icon: '🏖️', title: 'Retirement Planner', desc: 'Calculate the corpus you need to retire comfortably and the monthly SIP to get there.' },
      { id: 'emergency', icon: '🛟', title: 'Emergency Fund', desc: 'Check if your liquid assets cover 6 months of outflows — auto-computed from your portfolio.' },
      { id: 'prepayment', icon: '⚖️', title: 'Loan Prepayment', desc: 'Compare prepaying a loan (reduce tenure vs. reduce EMI) against investing the surplus.' },
      { id: 'sip-stepup', icon: '📈', title: 'SIP Step-Up', desc: 'Model how annual SIP increases compound over time versus a flat SIP.' },
      { id: 'goal-gap', icon: '🎯', title: 'Goal Gap Analysis', desc: 'See each goal\'s progress and the monthly SIP needed to bridge the gap on time.' },
    ];

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Financial Tools</h1>
          <div class="page-sub">Planning calculators powered by your portfolio data.</div>
        </div>
      </div>
      <div class="tools-grid">
        ${cards.map(c => `
          <a href="/tools/${c.id}" class="tool-card card" data-tool="${c.id}" style="text-decoration:none;color:inherit">
            <div class="tool-card-icon" aria-hidden="true">${c.icon}</div>
            <div class="tool-card-title">${esc(c.title)}</div>
            <div class="tool-card-desc dim">${esc(c.desc)}</div>
            <span class="btn primary" style="margin-top:auto">Open</span>
          </a>
        `).join('')}
      </div>`;
  }

  // ---------- 7. Render: Retirement Calculator ----------
  function renderRetirementCalc() {
    const p = Store.portfolio();
    const existing = Math.round(p.totalAssets);

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Retirement Planner</h1>
          <div class="page-sub">How much do you need to retire, and what SIP gets you there?</div>
        </div>
        <button class="btn" onclick="event.preventDefault();Router.go('/tools')">Back to Tools</button>
      </div>

      <div class="card">
        <div class="card-title">Inputs</div>
        <form id="retirement-form" class="tool-form">
          <div class="form-grid">
            <label class="field">
              <span class="field-label">Current age</span>
              <input type="number" name="currentAge" value="30" min="18" max="80" required>
            </label>
            <label class="field">
              <span class="field-label">Retirement age</span>
              <input type="number" name="retirementAge" value="55" min="30" max="80" required>
            </label>
            <label class="field">
              <span class="field-label">Monthly expenses today</span>
              <input type="number" name="monthlyExpenses" value="60000" min="1000" step="1000" required>
            </label>
            <label class="field">
              <span class="field-label">Inflation rate (% p.a.)</span>
              <input type="number" name="inflationRate" value="6" min="0" max="20" step="0.5">
            </label>
            <label class="field">
              <span class="field-label">Expected return (% p.a.)</span>
              <input type="number" name="expectedReturn" value="12" min="1" max="30" step="0.5">
            </label>
            <label class="field">
              <span class="field-label">Post-retirement return (% p.a.)</span>
              <input type="number" name="postRetReturn" value="7" min="1" max="20" step="0.5">
            </label>
            <label class="field">
              <span class="field-label">Life expectancy</span>
              <input type="number" name="lifeExpectancy" value="85" min="60" max="100">
            </label>
            <label class="field">
              <span class="field-label">Existing corpus</span>
              <input type="number" name="existingCorpus" value="${existing}" min="0" step="10000">
            </label>
          </div>
          <button type="submit" class="btn primary" style="margin-top:16px">Calculate</button>
        </form>
      </div>

      <div id="retirement-results" class="card" style="display:none;margin-top:18px">
        <div class="card-title">Results</div>
        <div id="retirement-output"></div>
        <button class="btn" style="margin-top:16px" id="retirement-ai-btn">Get AI advice</button>
      </div>

      <div class="disclaimer" style="margin-top:12px">
        <span>Illustrative projections only. Inflation, returns, and life expectancy are assumptions — review with a qualified financial planner.</span>
      </div>`;
  }

  // ---------- 8. Render: Emergency Fund ----------
  function renderEmergencyFund() {
    const result = emergencyFundAnalysis();
    const pct = result.recommended > 0 ? Math.min(100, (result.currentLiquid / result.recommended) * 100) : 0;
    const barColor = result.adequacy >= 6 ? 'var(--green)' : result.adequacy >= 3 ? 'var(--amber, #f59e0b)' : 'var(--red, #ef4444)';
    const statusText = result.adequacy >= 6 ? 'Adequate' : result.adequacy >= 3 ? 'Partial' : 'Insufficient';
    const statusClass = result.adequacy >= 6 ? 'pos-t' : result.adequacy >= 3 ? '' : 'neg-t';

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Emergency Fund Analysis</h1>
          <div class="page-sub">Auto-computed from your EMIs and liquid holdings.</div>
        </div>
        <button class="btn" onclick="event.preventDefault();Router.go('/tools')">Back to Tools</button>
      </div>

      <div class="card">
        <div class="card-title">Overview</div>
        <div class="stat-row">
          <div class="stat">
            <div class="stat-label">Monthly outflows (EMIs)</div>
            <div class="stat-value">${fmtINR(result.monthlyOutflow, { compact: true })}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Recommended fund (6 mo)</div>
            <div class="stat-value">${fmtINR(result.recommended, { compact: true })}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Current liquid assets</div>
            <div class="stat-value">${fmtINR(result.currentLiquid, { compact: true })}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Gap</div>
            <div class="stat-value ${result.gap > 0 ? 'neg-t' : 'pos-t'}">${result.gap > 0 ? fmtINR(result.gap, { compact: true }) : 'None'}</div>
          </div>
        </div>

        <div style="margin-top:24px">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span class="dim">Adequacy: <b class="${statusClass}">${esc(statusText)}</b> (${result.adequacy} months covered)</span>
            <span class="dim">${Math.round(pct)}%</span>
          </div>
          <div class="bar-bg" style="height:18px;border-radius:9px;background:var(--surface-2, #e5e7eb);overflow:hidden">
            <div style="width:${Math.min(100, pct)}%;height:100%;background:${barColor};border-radius:9px;transition:width 0.3s"></div>
          </div>
        </div>
      </div>

      ${result.gap > 0 ? `
      <div class="card" style="margin-top:18px">
        <div class="card-title">Recommendation</div>
        <p>You need an additional <b>${fmtINR(result.gap, { compact: true })}</b> in liquid assets to reach 6 months of coverage. Consider parking this in a liquid fund or short-term FD for quick access.</p>
      </div>` : `
      <div class="card" style="margin-top:18px">
        <div class="card-title">Status</div>
        <p class="pos-t">Your emergency fund is adequate. You have ${result.adequacy} months of outflows covered by liquid assets.</p>
      </div>`}

      <div class="disclaimer" style="margin-top:12px">
        <span>Emergency fund should cover 3-6 months of total expenses (not just EMIs). This analysis uses EMIs as a proxy for fixed outflows.</span>
      </div>`;
  }

  // ---------- 9. Render: Loan Prepayment Calculator ----------
  function renderPrepaymentCalc() {
    const liabs = Store.liabilities().filter(l => l.emi && l.rate && l.type !== 'creditcard');

    const options = liabs.map(l => {
      const lv = Store.liabilityValuation(l);
      return `<option value="${esc(l.id)}">${esc(l.label || Store.LIABILITY_TYPES[l.type].label)} (${fmtINR(lv.balance, { compact: true })} outstanding)</option>`;
    }).join('');

    const noLoans = liabs.length === 0;

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Loan Prepayment Analysis</h1>
          <div class="page-sub">Compare prepaying vs. investing your surplus.</div>
        </div>
        <button class="btn" onclick="event.preventDefault();Router.go('/tools')">Back to Tools</button>
      </div>

      ${noLoans ? `
      <div class="card">
        <div class="empty" style="padding:34px 20px">
          <div class="big" aria-hidden="true">⚖️</div>
          <p><b>No active loans found.</b></p>
          <p class="small" style="margin-top:6px">Add a liability with EMI to use this calculator.</p>
        </div>
      </div>` : `
      <div class="card">
        <div class="card-title">Inputs</div>
        <form id="prepay-form" class="tool-form">
          <div class="form-grid">
            <label class="field">
              <span class="field-label">Select loan</span>
              <select name="liabilityId" required>${options}</select>
            </label>
            <label class="field">
              <span class="field-label">Surplus amount to prepay/invest</span>
              <input type="number" name="surplusAmount" value="200000" min="1000" step="10000" required>
            </label>
          </div>
          <button type="submit" class="btn primary" style="margin-top:16px">Compare</button>
        </form>
      </div>

      <div id="prepay-results" style="display:none;margin-top:18px">
        <div id="prepay-output"></div>
      </div>`}

      <div class="disclaimer" style="margin-top:12px">
        <span>Investment returns assumed at 12% (equity). LTCG tax at 10% on gains above 1.25L. Actual outcomes depend on market conditions and tax rules.</span>
      </div>`;
  }

  // ---------- 10. Render: SIP Step-Up Planner ----------
  function renderSIPStepUp() {
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">SIP Step-Up Planner</h1>
          <div class="page-sub">See how annual SIP increases compound your wealth faster.</div>
        </div>
        <button class="btn" onclick="event.preventDefault();Router.go('/tools')">Back to Tools</button>
      </div>

      <div class="card">
        <div class="card-title">Inputs</div>
        <form id="sipstepup-form" class="tool-form">
          <div class="form-grid">
            <label class="field">
              <span class="field-label">Current monthly SIP</span>
              <input type="number" name="currentSIP" value="15000" min="500" step="500" required>
            </label>
            <label class="field">
              <span class="field-label">Annual step-up (%)</span>
              <input type="number" name="stepUpPct" value="10" min="0" max="100" step="1">
            </label>
            <label class="field">
              <span class="field-label">Investment horizon (years)</span>
              <input type="number" name="years" value="15" min="1" max="40">
            </label>
            <label class="field">
              <span class="field-label">Expected return (% p.a.)</span>
              <input type="number" name="expectedReturn" value="12" min="1" max="30" step="0.5">
            </label>
          </div>
          <button type="submit" class="btn primary" style="margin-top:16px">Calculate</button>
        </form>
      </div>

      <div id="sipstepup-results" class="card" style="display:none;margin-top:18px">
        <div class="card-title">Results</div>
        <div id="sipstepup-output"></div>
      </div>

      <div class="disclaimer" style="margin-top:12px">
        <span>Returns are assumed constant. Actual mutual fund returns vary year to year. Use this as directional guidance, not a guarantee.</span>
      </div>`;
  }

  // ---------- 11. Render: Goal Gap Analysis ----------
  function renderGoalGap() {
    const analysis = goalGapAnalysis();
    const p = Store.portfolio();

    if (analysis.length === 0) {
      return `
        <div class="page-head">
          <div>
            <h1 class="page-title">Goal Gap Analysis</h1>
            <div class="page-sub">Per-goal progress and the SIP needed to bridge each gap.</div>
          </div>
          <button class="btn" onclick="event.preventDefault();Router.go('/tools')">Back to Tools</button>
        </div>
        <div class="card">
          <div class="empty" style="padding:34px 20px">
            <div class="big" aria-hidden="true">🎯</div>
            <p><b>No goals set yet.</b></p>
            <p class="small" style="margin-top:6px">Add a net-worth goal from the <a href="/goals" onclick="event.preventDefault();Router.go('/goals')">Goals</a> page to see gap analysis here.</p>
          </div>
        </div>`;
    }

    const goalCards = analysis.map(item => {
      const g = item.goal;
      const pctNum = Math.round(item.progress * 100);
      const barColor = item.onTrack ? 'var(--green, #22c55e)' : 'var(--amber, #f59e0b)';
      const targetLabel = g.targetDate ? `Target: ${fmtDate(g.targetDate)}` : 'No deadline';

      return `
        <div class="card" style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div>
              <div class="stat-label">${g.achieved ? '&#10003; ' : ''}${esc(g.title || g.label || 'Goal')}</div>
              <div class="dim small">${esc(targetLabel)} · Target: ${fmtINR(g.targetAmount, { compact: true })}</div>
            </div>
            <span class="${item.onTrack ? 'pos-t' : 'neg-t'}" style="font-weight:600">${item.onTrack ? 'On track' : 'Gap exists'}</span>
          </div>
          <div style="margin-top:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span class="dim">Progress</span>
              <span class="dim">${pctNum}%</span>
            </div>
            <div class="bar-bg" style="height:12px;border-radius:6px;background:var(--surface-2, #e5e7eb);overflow:hidden">
              <div style="width:${Math.min(100, pctNum)}%;height:100%;background:${barColor};border-radius:6px;transition:width 0.3s"></div>
            </div>
          </div>
          <div class="stat-row" style="margin-top:14px">
            <div class="stat">
              <div class="stat-label">Current net worth</div>
              <div class="stat-value">${fmtINR(p.netWorth, { compact: true })}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Gap</div>
              <div class="stat-value ${item.gap > 0 ? 'neg-t' : 'pos-t'}">${item.gap > 0 ? fmtINR(item.gap, { compact: true }) : 'Achieved'}</div>
            </div>
            <div class="stat">
              <div class="stat-label">SIP needed</div>
              <div class="stat-value">${item.sipNeeded > 0 ? fmtINR(item.sipNeeded, { compact: true }) + '/mo' : '--'}</div>
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Goal Gap Analysis</h1>
          <div class="page-sub">Per-goal progress and the SIP needed to bridge each gap on time.</div>
        </div>
        <button class="btn" onclick="event.preventDefault();Router.go('/tools')">Back to Tools</button>
      </div>
      ${goalCards}
      <div class="disclaimer" style="margin-top:12px">
        <span>SIP estimates assume 10% annual returns. Goals track net worth (assets minus liabilities).</span>
      </div>`;
  }

  // ---------- Helper: Format prepayment results ----------
  function formatPrepayResults(result) {
    if (!result) return '<p class="neg-t">Could not analyse this loan. Ensure it has a valid rate and EMI.</p>';

    return `
      <div class="tools-grid" style="margin-top:0">
        <div class="card" style="border:2px solid var(--green, #22c55e)">
          <div class="stat-label">Scenario 1: Reduce Tenure</div>
          <div class="stat-value pos-t" style="margin-top:8px">${result.prepayReduceTenure.monthsSaved} months saved</div>
          <div class="stat-sub">Interest saved: <b class="pos-t">${fmtINR(result.prepayReduceTenure.interestSaved, { compact: true })}</b></div>
        </div>
        <div class="card">
          <div class="stat-label">Scenario 2: Reduce EMI</div>
          <div class="stat-value" style="margin-top:8px">${fmtINR(result.prepayReduceEMI.newEMI, { compact: true })}/mo</div>
          <div class="stat-sub">Monthly saving: <b>${fmtINR(result.prepayReduceEMI.monthlySaving, { compact: true })}</b></div>
        </div>
        <div class="card">
          <div class="stat-label">Scenario 3: Invest Instead</div>
          <div class="stat-value" style="margin-top:8px">${fmtINR(result.investInstead.futureValue, { compact: true })}</div>
          <div class="stat-sub">Post-tax gain: <b>${fmtINR(result.investInstead.gainPostTax, { compact: true })}</b></div>
        </div>
      </div>
      <div class="card" style="margin-top:12px;background:var(--surface-2, #f3f4f6)">
        <div class="stat-label">Recommendation</div>
        <p style="margin-top:6px"><b>${esc(result.recommendation)}</b></p>
      </div>`;
  }

  // ---------- Helper: Format SIP step-up results ----------
  function formatSIPStepUpResults(result, inputs) {
    // Compare with flat SIP
    const flatMonthlyRate = (inputs.expectedReturn / 100) / 12;
    const flatMonths = inputs.years * 12;
    const flatCorpus = flatMonthlyRate === 0
      ? inputs.currentSIP * flatMonths
      : inputs.currentSIP * ((Math.pow(1 + flatMonthlyRate, flatMonths) - 1) / flatMonthlyRate) * (1 + flatMonthlyRate);
    const flatInvested = inputs.currentSIP * flatMonths;
    const extraWealth = result.finalCorpus - Math.round(flatCorpus);

    let tableRows = result.yearWise.map(row => `
      <tr>
        <td>${row.year}</td>
        <td>${fmtINR(row.sip)}</td>
        <td>${fmtINR(row.invested, { compact: true })}</td>
        <td>${fmtINR(row.value, { compact: true })}</td>
      </tr>`).join('');

    return `
      <div class="stat-row">
        <div class="stat">
          <div class="stat-label">Final corpus (step-up)</div>
          <div class="stat-value pos-t">${fmtINR(result.finalCorpus, { compact: true })}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Total invested</div>
          <div class="stat-value">${fmtINR(result.totalInvested, { compact: true })}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Wealth gain</div>
          <div class="stat-value pos-t">${fmtINR(result.wealthGain, { compact: true })}</div>
        </div>
      </div>

      <div style="margin-top:18px;padding:14px;border-radius:8px;background:var(--surface-2, #f3f4f6)">
        <div class="stat-label">Flat SIP comparison</div>
        <p style="margin-top:6px">A flat SIP of ${fmtINR(inputs.currentSIP)}/mo would grow to <b>${fmtINR(Math.round(flatCorpus), { compact: true })}</b> (invested ${fmtINR(Math.round(flatInvested), { compact: true })}).</p>
        <p style="margin-top:4px">Step-up creates <b class="pos-t">${fmtINR(extraWealth, { compact: true })}</b> additional wealth.</p>
      </div>

      <div class="table-wrap" style="margin-top:18px">
        <table class="data-table">
          <thead><tr><th>Year</th><th>SIP/mo</th><th>Invested</th><th>Value</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  }

  // ---------- Helper: Format retirement results ----------
  function formatRetirementResults(result) {
    return `
      <div class="stat-row">
        <div class="stat">
          <div class="stat-label">Corpus needed at retirement</div>
          <div class="stat-value">${fmtINR(result.corpusNeeded, { compact: true })}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Existing corpus at retirement</div>
          <div class="stat-value">${fmtINR(result.existingCorpusAtRetirement, { compact: true })}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Gap to fill</div>
          <div class="stat-value ${result.gap > 0 ? 'neg-t' : 'pos-t'}">${result.gap > 0 ? fmtINR(result.gap, { compact: true }) : 'None!'}</div>
        </div>
      </div>
      <div class="stat-row" style="margin-top:16px">
        <div class="stat">
          <div class="stat-label">Monthly SIP needed</div>
          <div class="stat-value">${result.sipNeeded > 0 ? fmtINR(result.sipNeeded, { compact: true }) + '/mo' : 'Already on track'}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Monthly expense at retirement</div>
          <div class="stat-value">${fmtINR(result.futureMonthlyExpense, { compact: true })}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Timeline</div>
          <div class="stat-value">${result.yearsToRetirement}y to retire, ${result.yearsInRetirement}y in retirement</div>
        </div>
      </div>`;
  }

  function renderTool(slug) {
    switch (slug) {
      case 'retirement': return renderRetirementCalc();
      case 'emergency': return renderEmergencyFund();
      case 'prepayment': return renderPrepaymentCalc();
      case 'sip-stepup': return renderSIPStepUp();
      case 'goal-gap': return renderGoalGap();
      default: return renderToolsView();
    }
  }

  function wireToolForms() {
    const retForm = document.getElementById('retirement-form');
    if (retForm) {
      retForm.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(retForm);
        const inputs = {
          currentAge: parseInt(fd.get('currentAge'), 10),
          retirementAge: parseInt(fd.get('retirementAge'), 10),
          monthlyExpenses: parseFloat(fd.get('monthlyExpenses')),
          inflationRate: parseFloat(fd.get('inflationRate')),
          expectedReturn: parseFloat(fd.get('expectedReturn')),
          postRetReturn: parseFloat(fd.get('postRetReturn')),
          lifeExpectancy: parseInt(fd.get('lifeExpectancy'), 10),
          existingCorpus: parseFloat(fd.get('existingCorpus')),
        };
        const result = retirementCalculator(inputs);
        const out = document.getElementById('retirement-output');
        const wrap = document.getElementById('retirement-results');
        if (out && wrap) {
          out.innerHTML = formatRetirementResults(result);
          wrap.style.display = '';
        }
      });
    }

    const aiBtn = document.getElementById('retirement-ai-btn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        if (typeof AIChat !== 'undefined') {
          if (!AIChat.isOpen) AIChat.toggle();
          AIChat.askQuestion('Based on my portfolio, what is your retirement planning advice?');
        }
      });
    }

    const prepayForm = document.getElementById('prepay-form');
    if (prepayForm) {
      prepayForm.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(prepayForm);
        const liabilityId = fd.get('liabilityId');
        const surplusAmount = parseFloat(fd.get('surplusAmount'));
        const result = loanPrepaymentAnalysis(liabilityId, surplusAmount);
        const out = document.getElementById('prepay-output');
        const wrap = document.getElementById('prepay-results');
        if (out && wrap) {
          out.innerHTML = formatPrepayResults(result);
          wrap.style.display = '';
        }
      });
    }

    const sipForm = document.getElementById('sipstepup-form');
    if (sipForm) {
      sipForm.addEventListener('submit', e => {
        e.preventDefault();
        const fd = new FormData(sipForm);
        const inputs = {
          currentSIP: parseFloat(fd.get('currentSIP')),
          stepUpPct: parseFloat(fd.get('stepUpPct')),
          years: parseInt(fd.get('years'), 10),
          expectedReturn: parseFloat(fd.get('expectedReturn')),
        };
        const result = sipStepUpPlanner(inputs);
        const out = document.getElementById('sipstepup-output');
        const wrap = document.getElementById('sipstepup-results');
        if (out && wrap) {
          out.innerHTML = formatSIPStepUpResults(result, inputs);
          wrap.style.display = '';
        }
      });
    }
  }

  return {
    // Calculators
    retirementCalculator,
    emergencyFundAnalysis,
    loanPrepaymentAnalysis,
    sipStepUpPlanner,
    goalGapAnalysis,
    // Renderers
    renderToolsView,
    renderTool,
    renderRetirementCalc,
    renderEmergencyFund,
    renderPrepaymentCalc,
    renderSIPStepUp,
    renderGoalGap,
    // Wire form event listeners
    wireToolForms,
    // Formatters (for post-calculation rendering)
    formatRetirementResults,
    formatPrepayResults,
    formatSIPStepUpResults,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Tools = Tools;
