/* ============================================================
   WealthForge AI — AI Chat Panel
   Conversational AI assistant for portfolio questions. Cloud mode
   calls the Supabase Edge Function; local mode uses rule-based
   fallback with real portfolio data.
   ============================================================ */

const AIChat = (() => {
  // ---------- constants ----------
  const FREE_LIMIT = 20;
  const STORAGE_PREFIX = 'wf.chatCount.';
  const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || null;

  // ---------- state ----------
  let chatHistory = [];
  let isOpen = false;
  let isLoading = false;
  let dailyCount = 0;

  // ---------- helpers ----------
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  function todayKey() {
    return STORAGE_PREFIX + new Date().toISOString().slice(0, 10);
  }

  function loadDailyCount() {
    try { dailyCount = parseInt(localStorage.getItem(todayKey()) || '0', 10); } catch (e) { dailyCount = 0; }
  }

  function saveDailyCount() {
    try { localStorage.setItem(todayKey(), String(dailyCount)); } catch (e) { /* ignore */ }
  }

  function getSupabaseUrl() {
    if (SUPABASE_URL) return SUPABASE_URL;
    if (typeof Supa !== 'undefined' && Supa.client) {
      return Supa.client.supabaseUrl || null;
    }
    return null;
  }

  function isCloudMode() {
    return typeof Auth !== 'undefined' && Auth.enabled() && Auth.session;
  }

  // ---------- simple markdown parsing ----------
  function parseMd(text) {
    if (!text) return '';
    let html = esc(text);
    // bold **text**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // bullet lists: lines starting with - or *
    html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    // clean up nested <ul> tags from consecutive matches
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    // line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ---------- toggle ----------
  function toggle() {
    const panel = document.getElementById('ai-chat');
    if (!panel) return;
    isOpen = !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen) {
      const input = panel.querySelector('.chat-input');
      if (input) input.focus();
    }
  }

  // ---------- append message ----------
  function appendMessage(role, content) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble chat-${role}`;
    bubble.innerHTML = role === 'assistant' ? parseMd(content) : esc(content);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    chatHistory.push({ role, content });
  }

  // ---------- typing indicator ----------
  function showTyping() {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'chat-bubble chat-assistant chat-typing';
    el.id = 'chat-typing-indicator';
    el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('chat-typing-indicator');
    if (el) el.remove();
  }

  // ---------- ask question ----------
  async function askQuestion(question) {
    if (!question || !question.trim()) return;
    question = question.trim();

    if (dailyCount >= FREE_LIMIT) {
      appendMessage('assistant', 'You have reached the daily question limit (' + FREE_LIMIT + '). Come back tomorrow for more questions.');
      return;
    }

    appendMessage('user', question);
    showTyping();
    isLoading = true;

    try {
      let response;
      if (isCloudMode()) {
        response = await cloudRequest(question);
      } else {
        response = localFallback(question);
      }
      hideTyping();
      appendMessage('assistant', response);
      dailyCount++;
      saveDailyCount();
      updateFooter();
    } catch (err) {
      hideTyping();
      appendMessage('assistant', 'Sorry, something went wrong: ' + (err.message || 'Unknown error') + '. Please try again.');
    } finally {
      isLoading = false;
    }
  }

  // ---------- cloud request ----------
  async function cloudRequest(question) {
    const url = getSupabaseUrl();
    if (!url) throw new Error('Supabase URL not configured');

    const token = Auth.session?.access_token;
    if (!token) throw new Error('Not authenticated');

    const historySlice = chatHistory.slice(-10);

    const res = await fetch(`${url}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        question,
        history: historySlice,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`AI service error (${res.status}): ${errBody || 'request failed'}`);
    }

    const data = await res.json();
    return data.answer || data.response || data.message || 'No response received.';
  }

  // ---------- local fallback ----------
  function localFallback(question) {
    const q = question.toLowerCase();
    const assets = Store.all();
    const p = Store.portfolio();

    // Net worth / total
    if (/net\s*worth|total\s*value|how\s*much/.test(q)) {
      const growth = Store.recentGrowth();
      let msg = `Your current net worth is **${Fin.fmtINR(p.netWorth, { compact: true })}** (assets: ${Fin.fmtINR(p.totalAssets, { compact: true })}, liabilities: ${Fin.fmtINR(p.totalLiabilities, { compact: true })}).`;
      if (growth && growth.perMonthPct != null) {
        msg += `\n\nYou have been growing at approximately **${(growth.perMonthPct * 100).toFixed(1)}% per month** over the last ${Math.round(growth.months)} months.`;
      }
      return msg;
    }

    // Best / top performer
    if (/best|top|performer|highest.*growth|biggest.*gain/.test(q)) {
      const withGrowth = assets.map(a => {
        const v = Store.valuation(a);
        const gain = v.invested > 0 ? (v.currentValue - v.invested) / v.invested : 0;
        return { a, v, gain };
      }).filter(x => x.v.invested > 0);

      if (withGrowth.length === 0) return 'No holdings with cost basis found to compare performance.';

      withGrowth.sort((a, b) => b.gain - a.gain);
      const top = withGrowth.slice(0, 3);
      let msg = 'Your **top performers** by absolute return:\n';
      for (const item of top) {
        msg += `- **${item.a.label}** (${Store.TYPES[item.a.type]?.label || item.a.type}): ${Fin.fmtPct(item.gain)} gain (${Fin.fmtINR(item.v.currentValue - item.v.invested, { compact: true })})\n`;
      }
      return msg;
    }

    // Worst / bottom / loser
    if (/worst|bottom|loser|lowest.*growth|biggest.*loss/.test(q)) {
      const withGrowth = assets.map(a => {
        const v = Store.valuation(a);
        const gain = v.invested > 0 ? (v.currentValue - v.invested) / v.invested : 0;
        return { a, v, gain };
      }).filter(x => x.v.invested > 0);

      if (withGrowth.length === 0) return 'No holdings with cost basis found to compare performance.';

      withGrowth.sort((a, b) => a.gain - b.gain);
      const bottom = withGrowth.slice(0, 3);
      let msg = 'Your **worst performers** by return:\n';
      for (const item of bottom) {
        msg += `- **${item.a.label}** (${Store.TYPES[item.a.type]?.label || item.a.type}): ${Fin.fmtPct(item.gain)} (${Fin.fmtINR(item.v.currentValue - item.v.invested, { compact: true })})\n`;
      }
      return msg;
    }

    // Diversification / allocation
    if (/diversif|allocat|breakdown|split/.test(q)) {
      if (p.totalAssets <= 0) return 'Your portfolio is empty. Add some holdings to see allocation.';

      let msg = 'Your **portfolio allocation**:\n';
      const entries = Object.entries(p.byType)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

      for (const [type, value] of entries) {
        const pct = ((value / p.totalAssets) * 100).toFixed(1);
        const label = Store.TYPES[type]?.label || type;
        msg += `- ${label}: ${Fin.fmtINR(value, { compact: true })} (${pct}%)\n`;
      }

      const topType = entries[0];
      if (topType && (topType[1] / p.totalAssets) > 0.5) {
        msg += `\nNote: Over 50% of your portfolio is in ${Store.TYPES[topType[0]]?.label || topType[0]}. Consider diversifying across asset classes.`;
      }
      return msg;
    }

    // Goal progress
    if (/goal/.test(q)) {
      const goals = Store.goals();
      if (!goals.length) return 'You have no goals set up yet. Create a goal from the Goals page to track your progress.';

      let msg = '**Goal progress**:\n';
      for (const g of goals) {
        const gp = Store.goalProgress(g);
        const pctStr = (gp.pct * 100).toFixed(0);
        const status = gp.status === 'achieved' ? 'Achieved!' : gp.status === 'ontrack' ? 'On track' : 'Behind schedule';
        msg += `- **${g.label || 'Unnamed goal'}**: ${pctStr}% complete (${Fin.fmtINR(p.netWorth, { compact: true })} / ${Fin.fmtINR(g.targetAmount, { compact: true })}) — ${status}`;
        if (gp.projectedDate && !g.achieved) {
          msg += ` (projected: ${Fin.fmtDate(gp.projectedDate)})`;
        }
        msg += '\n';
      }
      return msg;
    }

    // What if drop/crash/fall
    const dropMatch = q.match(/what\s*if.*(drop|crash|fall|correct|tank).*?(\d+)/);
    if (dropMatch) {
      const dropPct = parseInt(dropMatch[2], 10) / 100;
      let liveTotal = 0;
      let impactAssets = [];

      for (const a of assets) {
        const mode = Store.TYPES[a.type]?.mode;
        if (mode === 'live') {
          const v = Store.valuation(a);
          const loss = (v.currentValue || 0) * dropPct;
          liveTotal += loss;
          impactAssets.push({ label: a.label, type: a.type, loss });
        }
      }

      if (liveTotal === 0) return 'You have no market-linked (live-priced) assets, so a market drop would not directly affect your portfolio value.';

      impactAssets.sort((a, b) => b.loss - a.loss);
      const newNW = p.netWorth - liveTotal;
      let msg = `If markets drop **${(dropPct * 100).toFixed(0)}%**, your live-priced assets would lose approximately **${Fin.fmtINR(liveTotal, { compact: true })}**.\n\n`;
      msg += `Net worth would drop from ${Fin.fmtINR(p.netWorth, { compact: true })} to approximately **${Fin.fmtINR(newNW, { compact: true })}** (a ${((liveTotal / p.netWorth) * 100).toFixed(1)}% total portfolio impact).\n\n`;
      msg += 'Most affected holdings:\n';
      for (const item of impactAssets.slice(0, 5)) {
        msg += `- ${item.label}: -${Fin.fmtINR(item.loss, { compact: true })}\n`;
      }
      msg += `\nYour computed and manual assets (FDs, PPF, real estate, etc.) would be unaffected.`;
      return msg;
    }

    // Liabilities / debt
    if (/loan|debt|liabilit|emi|outstanding/.test(q)) {
      const liabilities = Store.liabilities();
      if (!liabilities.length) return 'You have no liabilities recorded. Your net worth equals your total assets.';

      let msg = `You have **${liabilities.length} liabilit${liabilities.length === 1 ? 'y' : 'ies'}** totalling **${Fin.fmtINR(p.totalLiabilities, { compact: true })}**:\n`;
      for (const l of liabilities) {
        const lv = Store.liabilityValuation(l);
        msg += `- **${l.label || Store.LIABILITY_TYPES[l.type]?.label || l.type}**: ${Fin.fmtINR(lv.balance, { compact: true })} outstanding`;
        if (l.emi) msg += ` (EMI: ${Fin.fmtINR(l.emi, { compact: true })})`;
        if (lv.payoffDate) msg += ` — payoff by ${Fin.fmtDate(lv.payoffDate)}`;
        msg += '\n';
      }
      if (p.totalEmi > 0) {
        msg += `\nTotal monthly EMI burden: **${Fin.fmtINR(p.totalEmi, { compact: true })}**`;
      }
      return msg;
    }

    // Catch-all
    return 'This question requires the AI backend. Connect to Supabase for full AI features.\n\nIn local mode, I can answer questions about:\n- Net worth and portfolio value\n- Best and worst performers\n- Portfolio allocation and diversification\n- Goal progress\n- Market crash scenarios ("What if markets drop 20%?")\n- Loans and liabilities';
  }

  // ---------- update footer ----------
  function updateFooter() {
    const footer = document.getElementById('chat-footer');
    if (!footer) return;
    const remaining = Math.max(0, FREE_LIMIT - dailyCount);
    footer.textContent = `${remaining} question${remaining !== 1 ? 's' : ''} remaining today`;
  }

  // ---------- render panel HTML ----------
  function renderPanel() {
    return `<div id="ai-chat" class="chat-panel">
      <div class="chat-header">
        <div class="chat-header-left">
          <span class="chat-title">AI Assistant</span>
          <span class="chat-badge">Beta</span>
        </div>
        <button class="chat-close" id="chat-close-btn" aria-label="Close chat">&times;</button>
      </div>
      <div id="chat-messages" class="chat-messages">
        <div class="chat-bubble chat-assistant">
          Hello! I can help you understand your portfolio. Ask me about your net worth, performance, allocation, goals, or run scenario analyses.
        </div>
        <div class="chat-suggestions" id="chat-suggestions">
          <button class="chip" data-question="What's my best performer this year?">Best performer</button>
          <button class="chip" data-question="Am I on track for my goals?">Goal progress</button>
          <button class="chip" data-question="How diversified is my portfolio?">Diversification</button>
          <button class="chip" data-question="What if markets drop 20%?">Crash scenario</button>
        </div>
      </div>
      <form id="chat-form" class="chat-form">
        <input type="text" class="chat-input" id="chat-input" placeholder="Ask about your portfolio..." autocomplete="off" />
        <button type="submit" class="chat-send" aria-label="Send">&#9654;</button>
      </form>
      <div id="chat-footer" class="chat-footer">${Math.max(0, FREE_LIMIT - dailyCount)} questions remaining today</div>
    </div>`;
  }

  // ---------- render FAB ----------
  function renderFAB() {
    return `<button id="chat-fab" class="chat-fab" aria-label="Open AI Assistant">
      <span class="chat-fab-icon">AI</span>
    </button>`;
  }

  // ---------- handle submit ----------
  function handleSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    askQuestion(value);
  }

  // ---------- init panel ----------
  function initPanel() {
    loadDailyCount();

    // Insert panel and FAB outside .app container
    const panelWrapper = document.createElement('div');
    panelWrapper.innerHTML = renderPanel() + renderFAB();
    while (panelWrapper.firstChild) {
      document.body.appendChild(panelWrapper.firstChild);
    }

    // Wire up event listeners (NO inline onclick for CSP compliance)
    const form = document.getElementById('chat-form');
    if (form) form.addEventListener('submit', handleSubmit);

    const closeBtn = document.getElementById('chat-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', toggle);

    const fab = document.getElementById('chat-fab');
    if (fab) fab.addEventListener('click', toggle);

    // Suggestion chips
    const suggestions = document.getElementById('chat-suggestions');
    if (suggestions) {
      suggestions.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-question]');
        if (!chip) return;
        const question = chip.dataset.question;
        if (question) {
          // Hide suggestions after first use
          suggestions.style.display = 'none';
          askQuestion(question);
        }
      });
    }
  }

  // ---------- public API ----------
  return {
    toggle,
    askQuestion,
    localFallback,
    appendMessage,
    showTyping,
    hideTyping,
    renderPanel,
    renderFAB,
    initPanel,
    handleSubmit,
    FREE_LIMIT,
    get isOpen() { return isOpen; },
    get isLoading() { return isLoading; },
    get chatHistory() { return chatHistory; },
    get dailyCount() { return dailyCount; },
  };
})();

if (typeof globalThis !== 'undefined') globalThis.AIChat = AIChat;
