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

    const order = { high: 0, medium: 1, info: 2 };
    return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 5);
  }

  return { generate };
})();

if (typeof globalThis !== 'undefined') globalThis.Insights = Insights;
