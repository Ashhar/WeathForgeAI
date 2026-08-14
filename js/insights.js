/* ============================================================
   WealthForge AI — insights
   Rule-based observations over assets + liabilities. Each insight
   cites the holdings it derives from, and the whole panel keeps
   the "informational, not advice" framing.
   ============================================================ */

const Insights = (() => {
  const RETIREMENT_TYPES = ['epf', 'ppf', 'nps'];

  function generate() {
    const out = [];
    const p = Store.portfolio();
    const assets = Store.all().map(a => ({ a, v: Store.valuation(a) }));
    const liabs = Store.liabilities().map(l => ({ l, lv: Store.liabilityValuation(l) }));
    if (p.totalAssets <= 0) return out;

    // 1. Credit-card / revolving debt — most expensive money first
    const cards = liabs.filter(x => x.l.type === 'creditcard' && x.lv.balance > 0);
    for (const c of cards) {
      out.push({
        icon: '💳', severity: 'high',
        title: `${Fin.fmtINR(c.lv.balance, { compact: true })} revolving at ${c.l.rate}%`,
        body: `“${c.l.label || 'Credit card'}” carries ${Fin.fmtINR(c.lv.balance)} at ${c.l.rate}% p.a. — far above anything in your portfolio earns. Clearing it is the highest-certainty return available to you.`,
        sources: [c.l.label || 'Credit card'],
      });
    }

    // 2. Loan rate vs best FD rate
    const fds = assets.filter(x => x.a.type === 'fd');
    const bestFd = fds.reduce((m, x) => Math.max(m, x.a.data.rate || 0), 0);
    const costliest = liabs.filter(x => x.l.type !== 'creditcard' && x.lv.balance > 0)
      .sort((a, b) => b.l.rate - a.l.rate)[0];
    if (costliest && bestFd > 0 && costliest.l.rate > bestFd) {
      out.push({
        icon: '⚖️', severity: 'medium',
        title: `Loan at ${costliest.l.rate}% vs best FD at ${bestFd}%`,
        body: `“${costliest.l.label || Store.LIABILITY_TYPES[costliest.l.type].label}” costs ${costliest.l.rate}% while your best FD earns ${bestFd}% — the spread means prepaying the loan out-earns booking new deposits, before tax.`,
        sources: [costliest.l.label, ...fds.map(x => x.a.label)].filter(Boolean),
      });
    }

    // 3. Illiquid retirement share of net worth
    const retire = assets.filter(x => RETIREMENT_TYPES.includes(x.a.type) ||
      (x.a.type === 'smallsavings' && x.a.data.subType === 'ssy'));
    const retireVal = retire.reduce((s, x) => s + (x.v.currentValue || 0), 0);
    if (p.netWorth > 0 && retireVal / p.netWorth > 0.25) {
      out.push({
        icon: '🔒', severity: 'info',
        title: `${((retireVal / p.netWorth) * 100).toFixed(0)}% of net worth is locked retirement corpus`,
        body: `Your net worth is ${Fin.fmtINR(p.netWorth, { compact: true })}, but ${Fin.fmtINR(retireVal, { compact: true })} of it sits in EPF/PPF/NPS-type accounts that can't be tapped before maturity or retirement without penalty. Plan near-term goals from the rest.`,
        sources: retire.map(x => x.a.label),
      });
    }

    // 4. Single-holding concentration
    const sorted = assets.slice().sort((a, b) => (b.v.currentValue || 0) - (a.v.currentValue || 0));
    if (sorted.length && p.totalAssets > 0) {
      const top = sorted[0];
      const shareOf = (top.v.currentValue || 0) / p.totalAssets;
      if (shareOf > 0.30) {
        out.push({
          icon: '🎯', severity: 'medium',
          title: `“${top.a.label}” is ${(shareOf * 100).toFixed(0)}% of your assets`,
          body: `A single ${Store.TYPES[top.a.type].label.toLowerCase()} holding dominates your portfolio — its swings will move your whole net worth.`,
          sources: [top.a.label],
        });
      }
    }

    // 5. Crypto share
    const cryptoVal = assets.filter(x => x.a.type === 'crypto').reduce((s, x) => s + (x.v.currentValue || 0), 0);
    if (p.totalAssets > 0 && cryptoVal / p.totalAssets > 0.10) {
      out.push({
        icon: '🌊', severity: 'info',
        title: `Crypto is ${((cryptoVal / p.totalAssets) * 100).toFixed(0)}% of assets`,
        body: `${Fin.fmtINR(cryptoVal, { compact: true })} sits in the most volatile class you hold — its projection band is drawn extra-wide for a reason.`,
        sources: assets.filter(x => x.a.type === 'crypto').map(x => x.a.label),
      });
    }

    // 6. PPF 80C headroom
    const ppf = assets.find(x => x.a.type === 'ppf');
    if (ppf && (ppf.a.data.annualContribution || 0) < 150000) {
      const room = 150000 - (ppf.a.data.annualContribution || 0);
      out.push({
        icon: '🌱', severity: 'info',
        title: `${Fin.fmtINR(room, { compact: true })} of PPF headroom unused`,
        body: `You contribute ${Fin.fmtINR(ppf.a.data.annualContribution)} of the ₹1.5L annual PPF cap — the gap is tax-sheltered 7%+ compounding left on the table.`,
        sources: [ppf.a.label],
      });
    }

    // 7. Unvested ESOP value at risk
    const esops = assets.filter(x => x.a.type === 'esop');
    for (const e of esops) {
      if ((e.v.extra.unvestedValue || 0) > p.netWorth * 0.1) {
        out.push({
          icon: '⏳', severity: 'info',
          title: `${Fin.fmtINR(e.v.extra.unvestedValue, { compact: true })} unvested in “${e.a.label}”`,
          body: `${((1 - e.v.extra.vestedPct) * 100).toFixed(0)}% of the grant hasn't vested and is excluded from net worth — it depends on staying through the schedule${e.a.data.isPrivate ? ' and on an eventual liquidity event' : ''}.`,
          sources: [e.a.label],
        });
      }
    }

    // 8. Net-worth trend (last quarter, from snapshots)
    const quarter = Store.snapshotRange(92);
    if (quarter.length >= 2) {
      const first = quarter[0], last = quarter[quarter.length - 1];
      const abs = last.netWorth - first.netWorth;
      const pct = first.netWorth > 0 ? abs / first.netWorth : null;
      if (Math.abs(abs) > Math.max(1000, p.netWorth * 0.005)) {
        out.push({
          icon: abs >= 0 ? '📈' : '📉', severity: 'info',
          title: `Net worth ${abs >= 0 ? 'grew' : 'fell'} ${Fin.fmtINR(Math.abs(abs), { compact: true })} this quarter`,
          body: `From ${Fin.fmtINR(first.netWorth, { compact: true })} on ${Fin.fmtDate(first.date)} to ${Fin.fmtINR(last.netWorth, { compact: true })} today${pct != null ? ` (${Fin.fmtPct(pct)})` : ''}.`,
          sources: ['Net-worth snapshots'],
        });
      }
    }

    // 9. Debt trend (last ~6 months, from snapshots)
    const half = Store.snapshotRange(183);
    if (half.length >= 2) {
      const firstL = half[0].totalLiabilities, lastL = half[half.length - 1].totalLiabilities;
      const drop = firstL - lastL;
      if (firstL > 0 && Math.abs(drop) > Math.max(10000, firstL * 0.02)) {
        out.push({
          icon: drop >= 0 ? '⛓️‍💥' : '⚠️', severity: drop >= 0 ? 'info' : 'medium',
          title: drop >= 0
            ? `Loans down ${Fin.fmtINR(drop, { compact: true })} in 6 months`
            : `Debt grew ${Fin.fmtINR(-drop, { compact: true })} in 6 months`,
          body: drop >= 0
            ? `Your total outstanding debt fell from ${Fin.fmtINR(firstL, { compact: true })} to ${Fin.fmtINR(lastL, { compact: true })} — every EMI is shifting from interest to equity in your net worth.`
            : `Total outstanding debt rose from ${Fin.fmtINR(firstL, { compact: true })} to ${Fin.fmtINR(lastL, { compact: true })} — worth a look at what's compounding against you.`,
          sources: ['Net-worth snapshots', 'Liabilities'],
        });
      }
    }

    // 10. Allocation drift (vs the oldest snapshot with a breakdown ≥80 days old)
    const withBreakdown = Store.snapshots().filter(s => s.byType && Object.keys(s.byType).length);
    const cutoffIso = (() => { const d = new Date(); d.setDate(d.getDate() - 80); return d.toISOString().slice(0, 10); })();
    const oldSnap = withBreakdown.filter(s => s.date <= cutoffIso).pop();
    if (oldSnap && p.totalAssets > 0) {
      const oldTotal = Object.values(oldSnap.byType).reduce((s, v) => s + v, 0);
      let biggest = null;
      if (oldTotal > 0) {
        for (const t of Object.keys(p.byType)) {
          const nowShare = p.byType[t] / p.totalAssets;
          const oldShare = (oldSnap.byType[t] || 0) / oldTotal;
          const delta = nowShare - oldShare;
          if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { t, delta, nowShare };
        }
      }
      if (biggest && Math.abs(biggest.delta) >= 0.05 && Store.TYPES[biggest.t]) {
        const label = Store.TYPES[biggest.t].label;
        out.push({
          icon: '🧭', severity: 'info',
          title: `${label} allocation ${biggest.delta > 0 ? 'grew' : 'shrank'} ${(Math.abs(biggest.delta) * 100).toFixed(0)}pp since ${Fin.fmtDate(oldSnap.date)}`,
          body: `${label} now makes up ${(biggest.nowShare * 100).toFixed(0)}% of your assets, ${biggest.delta > 0 ? 'up' : 'down'} from ${((biggest.nowShare - biggest.delta) * 100).toFixed(0)}% — drift changes your risk profile even when you change nothing.`,
          sources: ['Net-worth snapshots', label],
        });
      }
    }

    // 11. EMI coverage from liquid holdings (emergency-fund lens)
    const liquidVal = assets.filter(x => {
      if (x.a.type !== 'mf') return false;
      const s = Market.getScheme(x.a.data.schemeCode);
      return s && (s.category === 'liquid' || s.category === 'debt');
    }).reduce((s, x) => s + (x.v.currentValue || 0), 0);
    if (p.totalEmi > 0) {
      const months = liquidVal / p.totalEmi;
      if (months < 6) {
        out.push({
          icon: '🚨', severity: months < 3 ? 'medium' : 'info',
          title: liquidVal > 0
            ? `Liquid funds cover ${months.toFixed(1)} months of EMIs`
            : 'No liquid buffer against your EMIs',
          body: liquidVal > 0
            ? `You pay ${Fin.fmtINR(p.totalEmi, { compact: true })}/month in EMIs but hold ${Fin.fmtINR(liquidVal, { compact: true })} in liquid/debt funds — about ${months.toFixed(1)} months of cover. Six months is a common buffer.`
            : `You pay ${Fin.fmtINR(p.totalEmi, { compact: true })}/month in EMIs with no liquid or debt-fund holdings to fall back on — most other assets here are locked or volatile.`,
          sources: ['Liabilities', 'Mutual Funds'],
        });
      }
    }

    // 12. Goal pace (nearest unachieved goal)
    const pending = Store.goals().filter(g => !g.achieved).sort((a, b) => a.targetAmount - b.targetAmount);
    if (pending.length) {
      const g = pending[0];
      const pr = Store.goalProgress(g);
      if (pr.projectedDate) {
        let vsTarget = '';
        if (g.targetDate) {
          const diffMo = Math.round((new Date(g.targetDate) - pr.projectedDate) / (30.44 * 24 * 3600 * 1000));
          vsTarget = diffMo >= 0 ? ` — about ${diffMo} months ahead of your target date` : ` — about ${-diffMo} months behind your target date`;
        }
        out.push({
          icon: '🎯', severity: 'info',
          title: `“${g.title}” on pace for ${Fin.fmtDate(pr.projectedDate)}`,
          body: `You're ${(pr.pct * 100).toFixed(0)}% of the way to ${Fin.fmtINR(g.targetAmount, { compact: true })}. At your recent growth rate you'd reach it around ${Fin.fmtDate(pr.projectedDate)}${vsTarget}.`,
          sources: ['Goals', 'Net-worth snapshots'],
        });
      }
    }

    const order = { high: 0, medium: 1, info: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 5);
  }

  // AI-enhanced insights (fetched from edge function, cached)
  let aiInsights = null;
  let aiInsightsLoading = false;

  function getAIInsights() { return aiInsights; }

  async function fetchAIInsights() {
    if (aiInsightsLoading) return;
    if (!Auth.enabled() || !Auth.session || Auth.isDemo()) return;
    aiInsightsLoading = true;
    try {
      const sb = globalThis.Supa?.client;
      if (!sb) return;
      // Check cache first
      const { data: cached } = await sb.from('cached_insights')
        .select('*').eq('user_id', Auth.session.user.id).single();
      if (cached && cached.insights?.length) {
        const age = Date.now() - new Date(cached.generated_at).getTime();
        if (age < 24 * 60 * 60 * 1000) { aiInsights = cached.insights; aiInsightsLoading = false; return; }
      }
      // Fetch fresh from edge function
      const url = import.meta.env?.VITE_SUPABASE_URL || '';
      const res = await fetch(`${url}/functions/v1/ai-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Auth.session.access_token}` },
        body: '{}'
      });
      if (res.ok) {
        const data = await res.json();
        aiInsights = data.insights || [];
      }
    } catch (e) { /* AI insights unavailable — rule-based fallback continues */ }
    aiInsightsLoading = false;
  }

  return { generate, fetchAIInsights, getAIInsights };
})();

if (typeof globalThis !== 'undefined') globalThis.Insights = Insights;
