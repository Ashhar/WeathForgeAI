/* ============================================================
   WealthForge AI — shareable snapshot card
   Renders a 1200×630 (OG-sized) PNG on a <canvas>: brand mark,
   growth % and a trend sparkline — never absolute figures unless
   the user flips the reveal toggle (hidden by default). Shares
   via the Web Share API with download / copy-image fallbacks.
   ============================================================ */

const ShareKit = (() => {
  const W = 1200, H = 630;

  function growthStats() {
    let snaps = Store.snapshotRange(365);
    let label = 'over the last 12 months';
    if (snaps.length < 2) { snaps = Store.snapshots(); label = 'since ' + (snaps.length ? Fin.fmtDate(snaps[0].date) : ''); }
    if (snaps.length < 2) return null;
    const first = snaps[0], last = snaps[snaps.length - 1];
    if (!(first.netWorth > 0)) return null;
    const days = (new Date(last.date) - new Date(first.date)) / 86400000;
    if (days > 340) label = 'this year';
    return { pct: (last.netWorth - first.netWorth) / first.netWorth, label, snaps, netWorth: last.netWorth };
  }

  function drawCard(reveal) {
    const g = growthStats();
    if (!g) return null;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // background
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#141b2d'); bg.addColorStop(0.6, '#0d1220'); bg.addColorStop(1, '#171a12');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W - 160, 90, 10, W - 160, 90, 560);
    glow.addColorStop(0, 'rgba(232,182,76,0.16)'); glow.addColorStop(1, 'rgba(232,182,76,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // brand
    const bx = 64, by = 56;
    const mark = ctx.createLinearGradient(bx, by, bx + 56, by + 56);
    mark.addColorStop(0, '#f4c766'); mark.addColorStop(1, '#c98a1b');
    ctx.fillStyle = mark;
    ctx.beginPath(); ctx.roundRect(bx, by, 56, 56, 14); ctx.fill();
    ctx.fillStyle = '#241a05';
    ctx.font = '800 30px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('W', bx + 28, by + 30);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#e9edf6';
    ctx.font = '700 30px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.fillText('WealthForge', bx + 72, by + 28);
    ctx.fillStyle = '#e8b64c';
    ctx.fillText('AI', bx + 72 + ctx.measureText('WealthForge').width + 8, by + 28);
    ctx.fillStyle = '#67718a';
    ctx.font = '600 15px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.fillText('N E T   W O R T H   T R A C K E R', bx + 72, by + 52);

    // growth headline
    const up = g.pct >= 0;
    ctx.fillStyle = up ? '#2ecc8f' : '#f4586f';
    ctx.font = '800 128px Inter, "Segoe UI", system-ui, sans-serif';
    const pctText = `${up ? '+' : ''}${(g.pct * 100).toFixed(1)}%`;
    ctx.fillText(pctText, 64, 268);
    ctx.fillStyle = '#9aa5bb';
    ctx.font = '500 30px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.fillText(`net worth growth ${g.label}`, 66, 316);

    // optional reveal (hidden/redacted by default)
    ctx.font = '700 34px Inter, "Segoe UI", system-ui, sans-serif';
    if (reveal) {
      ctx.fillStyle = '#e9edf6';
      ctx.fillText(`Net worth: ${Fin.fmtINR(g.netWorth, { compact: true })}`, 66, 372);
    } else {
      ctx.fillStyle = '#67718a';
      ctx.fillText('Net worth: ₹ ●●●●●', 66, 372);
    }

    // sparkline
    const sx = 64, sw = W - 128, sy = 415, sh = 130;
    const pts = g.snaps.slice(-80);
    let vMin = Infinity, vMax = -Infinity;
    for (const p of pts) { vMin = Math.min(vMin, p.netWorth); vMax = Math.max(vMax, p.netWorth); }
    const span = vMax - vMin || 1;
    const px = i => sx + (i / (pts.length - 1)) * sw;
    const py = v => sy + (1 - (v - vMin) / span) * sh;
    ctx.beginPath();
    pts.forEach((p, i) => { i ? ctx.lineTo(px(i), py(p.netWorth)) : ctx.moveTo(px(i), py(p.netWorth)); });
    const fill = ctx.createLinearGradient(0, sy, 0, sy + sh + 30);
    fill.addColorStop(0, 'rgba(232,182,76,0.30)'); fill.addColorStop(1, 'rgba(232,182,76,0)');
    ctx.save();
    ctx.lineTo(px(pts.length - 1), sy + sh + 30); ctx.lineTo(sx, sy + sh + 30); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
    ctx.beginPath();
    pts.forEach((p, i) => { i ? ctx.lineTo(px(i), py(p.netWorth)) : ctx.moveTo(px(i), py(p.netWorth)); });
    ctx.strokeStyle = '#e8b64c'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    const lastP = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(px(pts.length - 1), py(lastP.netWorth), 9, 0, Math.PI * 2);
    ctx.fillStyle = '#e8b64c'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#0d1220'; ctx.stroke();

    // footer
    ctx.fillStyle = '#67718a';
    ctx.font = '500 20px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.fillText('Every asset you own — equity, MFs, FDs, EPF/PPF/NPS, gold, property, crypto — minus your loans.', 64, H - 34);

    return canvas;
  }

  function toBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  async function openModal() {
    if (!growthStats()) { UI.toast('Not enough history to share yet — come back after a couple of snapshots'); return; }
    let reveal = false;

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal share-modal" role="dialog" aria-label="Share your growth">
      <h3>Share your growth</h3>
      <p>The card shows your <b>growth % only</b> — absolute numbers stay private unless you reveal them.</p>
      <div class="share-preview"><img id="share_img" alt="Preview of your shareable growth card"/></div>
      <label class="share-toggle">
        <input type="checkbox" id="share_reveal"/>
        <span>Also show my net worth figure <span class="dim small">(off = redacted)</span></span>
      </label>
      <div class="modal-actions" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
        <button class="btn" data-cancel>Close</button>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" data-copy>Copy image</button>
          <button class="btn" data-download>Download PNG</button>
          <button class="btn primary" data-share style="display:none">Share…</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(back);

    const img = back.querySelector('#share_img');
    let canvas = null;
    const rerender = () => {
      canvas = drawCard(reveal);
      img.src = canvas.toDataURL('image/png');
    };
    rerender();

    const shareBtn = back.querySelector('[data-share]');
    // only offer the native share sheet where files can actually be shared
    (async () => {
      if (navigator.canShare && canvas) {
        const blob = await toBlob(canvas);
        const file = new File([blob], 'wealthforge-growth.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) shareBtn.style.display = '';
      }
    })();

    back.addEventListener('click', e => { if (e.target === back) back.remove(); });
    back.querySelector('[data-cancel]').addEventListener('click', () => back.remove());
    back.querySelector('#share_reveal').addEventListener('change', e => { reveal = e.target.checked; rerender(); });

    back.querySelector('[data-download]').addEventListener('click', async () => {
      const blob = await toBlob(canvas);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'wealthforge-growth.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      UI.toast('Card downloaded');
    });

    back.querySelector('[data-copy]').addEventListener('click', async () => {
      try {
        const blob = await toBlob(canvas);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        UI.toast('Image copied to clipboard');
      } catch (e) {
        UI.toast('Copy not supported here — use Download instead');
      }
    });

    shareBtn.addEventListener('click', async () => {
      try {
        const blob = await toBlob(canvas);
        const file = new File([blob], 'wealthforge-growth.png', { type: 'image/png' });
        await navigator.share({
          files: [file],
          title: 'My net worth growth — WealthForge AI',
          text: 'Tracking every asset I own with WealthForge AI.',
        });
      } catch (e) { /* user dismissed the share sheet */ }
    });
  }

  return { openModal, drawCard, growthStats };
})();

if (typeof globalThis !== 'undefined') globalThis.ShareKit = ShareKit;
