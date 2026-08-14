/* ============================================================
   WealthForge AI — monthly portfolio digest
   Generates local rule-based digests from snapshot history,
   grouped by month. Each digest summarises net-worth change,
   top/bottom movers, goals progress, and key highlights.
   ============================================================ */

const Digest = (() => {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const { fmtINR, fmtPct, fmtDate } = Fin;

  // ---------- helpers ----------

  /** Group snapshots by YYYY-MM key, oldest-first within each group */
  function groupByMonth(snaps) {
    const map = {};
    for (const s of snaps) {
      const key = s.date.slice(0, 7); // YYYY-MM
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return map;
  }

  /** Human-readable month label from YYYY-MM */
  function monthLabel(ym) {
    const [y, m] = ym.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  }

  /** Derive per-type value changes between two snapshots that have byType */
  function typeChanges(first, last) {
    const out = [];
    const allTypes = new Set([...Object.keys(first.byType || {}), ...Object.keys(last.byType || {})]);
    for (const t of allTypes) {
      const v0 = (first.byType || {})[t] || 0;
      const v1 = (last.byType || {})[t] || 0;
      const change = v1 - v0;
      const pct = v0 > 0 ? change / v0 : (v1 > 0 ? 1 : 0);
      const label = (Store.TYPES[t] || {}).label || t;
      if (Math.abs(change) > 0) {
        out.push({ name: label, type: t, change, pct, value: v1 });
      }
    }
    return out;
  }

  // ---------- core digest generation ----------

  /**
   * Generate a digest object for a given set of snapshots (within one month).
   * Requires at least 2 snapshots.
   */
  function generateDigestForSnapshots(snaps, periodLabel) {
    if (!snaps || snaps.length < 2) return null;

    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const change = last.netWorth - first.netWorth;
    const changePct = first.netWorth > 0 ? change / first.netWorth : 0;

    // Movers by asset type
    const movers = typeChanges(first, last).sort((a, b) => b.change - a.change);
    const topMovers = movers.filter(m => m.change > 0).slice(0, 3);
    const bottomMovers = movers.filter(m => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 3);

    // Goals progress
    const goalsProgress = Store.goals().map(g => {
      const pr = Store.goalProgress(g);
      return { label: g.title, pct: pr.pct, achieved: !!g.achieved, target: g.targetAmount };
    });

    // Highlights
    const highlights = [];
    if (Math.abs(changePct) >= 0.05) {
      highlights.push(`Net worth ${change >= 0 ? 'grew' : 'fell'} by ${fmtPct(changePct)} this month — a significant move.`);
    }
    if (topMovers.length && topMovers[0].pct > 0.1) {
      highlights.push(`${topMovers[0].name} was the standout performer with ${fmtPct(topMovers[0].pct)} growth.`);
    }
    if (bottomMovers.length && bottomMovers[0].pct < -0.05) {
      highlights.push(`${bottomMovers[0].name} saw a pullback of ${fmtPct(bottomMovers[0].pct)}.`);
    }
    const achieved = goalsProgress.filter(g => g.achieved);
    if (achieved.length) {
      highlights.push(`${achieved.length} goal${achieved.length > 1 ? 's' : ''} achieved: ${achieved.map(g => g.label).join(', ')}.`);
    }
    const nearGoals = goalsProgress.filter(g => !g.achieved && g.pct >= 0.9);
    if (nearGoals.length) {
      highlights.push(`Almost there: ${nearGoals.map(g => `"${g.label}" at ${(g.pct * 100).toFixed(0)}%`).join(', ')}.`);
    }
    // Liability reduction
    const liabChange = (last.totalLiabilities || 0) - (first.totalLiabilities || 0);
    if (liabChange < -5000) {
      highlights.push(`Debt reduced by ${fmtINR(Math.abs(liabChange), { compact: true })} this month.`);
    }

    // If no highlights generated, add a neutral one
    if (!highlights.length) {
      if (change >= 0) {
        highlights.push(`Steady month — net worth held or grew modestly.`);
      } else {
        highlights.push(`A slightly down month — normal market fluctuation.`);
      }
    }

    return {
      period: periodLabel,
      periodKey: first.date.slice(0, 7),
      netWorthStart: first.netWorth,
      netWorthEnd: last.netWorth,
      change,
      changePct,
      topMovers,
      bottomMovers,
      goalsProgress,
      highlights,
      snapshotCount: snaps.length,
      dateRange: { from: first.date, to: last.date },
    };
  }

  // ---------- public API ----------

  /**
   * generateLocalDigest() — generates a digest from the last 30 days.
   */
  function generateLocalDigest() {
    const snaps = Store.snapshotRange(30);
    if (snaps.length < 2) return null;
    const now = new Date();
    const label = monthLabel(now.toISOString().slice(0, 7));
    return generateDigestForSnapshots(snaps, label);
  }

  /**
   * getMonthlyDigests() — groups all snapshots by month, returns
   * digests for each month with at least 2 snapshots (most recent first).
   */
  function getMonthlyDigests() {
    const allSnaps = Store.snapshots();
    const groups = groupByMonth(allSnaps);
    const digests = [];

    for (const [ym, snaps] of Object.entries(groups)) {
      if (snaps.length < 2) continue;
      const sorted = snaps.sort((a, b) => a.date < b.date ? -1 : 1);
      const digest = generateDigestForSnapshots(sorted, monthLabel(ym));
      if (digest) digests.push(digest);
    }

    // Most recent first
    digests.sort((a, b) => b.periodKey > a.periodKey ? 1 : b.periodKey < a.periodKey ? -1 : 0);
    return digests;
  }

  /**
   * formatDigestCard(digest) — returns an HTML card for a single digest.
   */
  function formatDigestCard(digest) {
    const d = digest;
    const changeCls = d.change >= 0 ? 'pos-t' : 'neg-t';
    const changeSign = d.change >= 0 ? '+' : '';

    // Net worth headline
    const headline = `${changeSign}${fmtINR(d.change, { compact: true })} (${fmtPct(d.changePct)}) this month`;

    // Top movers section
    let moversHtml = '';
    if (d.topMovers.length || d.bottomMovers.length) {
      const moverRows = [...d.topMovers, ...d.bottomMovers].map(m => {
        const cls = m.change >= 0 ? 'pos-t' : 'neg-t';
        const sign = m.change >= 0 ? '+' : '';
        return `<tr>
          <td>${esc(m.name)}</td>
          <td class="${cls}">${sign}${fmtINR(m.change, { compact: true })}</td>
          <td class="${cls}">${fmtPct(m.pct)}</td>
        </tr>`;
      }).join('');
      moversHtml = `
        <div class="digest-movers">
          <div class="dim" style="font-size:0.82em;font-weight:600;margin-bottom:6px">Movers</div>
          <table class="mini-table">
            <tbody>${moverRows}</tbody>
          </table>
        </div>`;
    }

    // Goals progress
    let goalsHtml = '';
    if (d.goalsProgress.length) {
      const bars = d.goalsProgress.map(g => {
        const pctVal = Math.min(100, g.pct * 100).toFixed(1);
        return `<div class="digest-goal">
          <div class="digest-goal-label">
            <span>${esc(g.label)}</span>
            <span class="dim">${(g.pct * 100).toFixed(0)}%</span>
          </div>
          <div class="goal-bar" role="progressbar" aria-valuenow="${(g.pct * 100).toFixed(0)}" aria-valuemin="0" aria-valuemax="100">
            <div class="goal-fill ${g.achieved ? 'done' : ''}" style="width:${pctVal}%"></div>
          </div>
        </div>`;
      }).join('');
      goalsHtml = `
        <div class="digest-goals">
          <div class="dim" style="font-size:0.82em;font-weight:600;margin-bottom:6px">Goals</div>
          ${bars}
        </div>`;
    }

    // Highlights
    const highlightsHtml = d.highlights.length
      ? `<ul class="digest-highlights">${d.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>`
      : '';

    return `
      <div class="card digest-card">
        <div class="digest-header">
          <h3 class="card-title" style="margin:0">${esc(d.period)}</h3>
          <span class="dim" style="font-size:0.8em">${d.snapshotCount} snapshots</span>
        </div>
        <div class="digest-headline">
          <span class="stat-value ${changeCls}">${headline}</span>
        </div>
        <div class="digest-range dim" style="font-size:0.82em">
          ${fmtINR(d.netWorthStart, { compact: true })} &rarr; ${fmtINR(d.netWorthEnd, { compact: true })}
        </div>
        ${moversHtml}
        ${goalsHtml}
        ${highlightsHtml}
      </div>`;
  }

  /**
   * renderDigestView() — returns full HTML for the /digest route.
   */
  function renderDigestView() {
    const allSnaps = Store.snapshots();

    // Empty state
    if (allSnaps.length < 2) {
      return `
        <div class="page-head">
          <h1 class="page-title">Monthly Digest</h1>
          <div class="page-sub">A monthly summary of your portfolio performance, movers, and goal progress.</div>
        </div>
        <div class="card">
          <div class="empty" style="padding:40px 20px">
            <div class="big" aria-hidden="true">📊</div>
            <p><b>Not enough history yet</b></p>
            <p class="small" style="margin-top:8px">Come back after a few days of tracking — the digest needs at least two snapshots in a month to generate insights.</p>
          </div>
        </div>`;
    }

    const digests = getMonthlyDigests();

    if (!digests.length) {
      return `
        <div class="page-head">
          <h1 class="page-title">Monthly Digest</h1>
          <div class="page-sub">A monthly summary of your portfolio performance, movers, and goal progress.</div>
        </div>
        <div class="card">
          <div class="empty" style="padding:40px 20px">
            <div class="big" aria-hidden="true">📊</div>
            <p><b>Not enough history yet</b></p>
            <p class="small" style="margin-top:8px">Each month needs at least two snapshots to generate a digest. Keep checking in and your first digest will appear soon.</p>
          </div>
        </div>`;
    }

    // Cloud mode: show AI digest button if Supabase is available
    const isCloud = typeof Supa !== 'undefined' && Supa.enabled && Auth.session && !Auth.isDemo();
    const aiBtn = isCloud
      ? `<button class="btn" id="digest_ai_btn" onclick="Digest.requestAIDigest()">Generate AI Digest</button>`
      : '';

    const cards = digests.map(d => formatDigestCard(d)).join('');

    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Monthly Digest</h1>
          <div class="page-sub">Your portfolio story, month by month.</div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${aiBtn}
        </div>
      </div>
      <div class="digest-list">
        ${cards}
      </div>`;
  }

  /**
   * requestAIDigest() — placeholder for AI-powered digest via edge function.
   * In cloud mode, this would call the Supabase edge function.
   */
  function requestAIDigest() {
    const btn = document.getElementById('digest_ai_btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating...';
    }
    // Placeholder: in a real implementation this would call:
    // const { data } = await sb().functions.invoke('generate-digest', { body: { month: ... } })
    setTimeout(() => {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Generate AI Digest';
      }
      // Show a notice that AI digest is not yet configured
      const list = document.querySelector('.digest-list');
      if (list) {
        const notice = document.createElement('div');
        notice.className = 'card';
        notice.style.cssText = 'padding:16px;margin-bottom:16px;border-left:3px solid var(--accent)';
        notice.innerHTML = '<b>AI Digest</b><p class="small" style="margin-top:4px">Connect an AI provider in Settings to unlock personalised monthly commentary and recommendations.</p>';
        list.insertBefore(notice, list.firstChild);
      }
    }, 1200);
  }

  return {
    generateLocalDigest,
    getMonthlyDigests,
    formatDigestCard,
    renderDigestView,
    requestAIDigest,
  };
})();

if (typeof globalThis !== 'undefined') globalThis.Digest = Digest;
