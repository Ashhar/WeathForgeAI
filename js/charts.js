/* ============================================================
   WealthForge AI — lightweight SVG charts
   Fan (projection band), line, donut, sparkline. No dependencies.
   ============================================================ */

const Charts = (() => {
  const COLORS = ['#e8b64c', '#5b9dff', '#2ecc8f', '#b18cff', '#f4586f', '#4fd1c5', '#ffb75b', '#8b96ab'];

  // read chart tokens from the active theme at render time
  function theme() {
    try {
      const cs = getComputedStyle(document.documentElement);
      return {
        grid: cs.getPropertyValue('--chart-grid').trim() || '#232d42',
        label: cs.getPropertyValue('--chart-label').trim() || '#67718a',
        text: cs.getPropertyValue('--text').trim() || '#e9edf6',
        surface: cs.getPropertyValue('--surface').trim() || '#121826',
      };
    } catch (e) {
      return { grid: '#232d42', label: '#67718a', text: '#e9edf6', surface: '#121826' };
    }
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function niceTicks(min, max, n = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step = Math.pow(10, Math.floor(Math.log10(span / n)));
    const err = (span / n) / step;
    const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
    const s = mult * step;
    const ticks = [];
    for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) ticks.push(v);
    return ticks;
  }

  function compactINR(v) {
    const a = Math.abs(v);
    if (a >= 1e7) return `₹${(v / 1e7).toFixed(1)}Cr`;
    if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
    if (a >= 1e3) return `₹${(v / 1e3).toFixed(0)}K`;
    return `₹${v.toFixed(0)}`;
  }

  // ------- projection fan: band = [{t, p10, p50, p90}] -------
  function fan(band, opts = {}) {
    const W = opts.width || 720, H = opts.height || 280;
    const padL = 58, padR = 16, padT = 14, padB = 30;
    if (!band || band.length < 2) return `<svg viewBox="0 0 ${W} ${H}"></svg>`;

    const tMax = band[band.length - 1].t;
    let vMin = Infinity, vMax = -Infinity;
    for (const p of band) { vMin = Math.min(vMin, p.p10); vMax = Math.max(vMax, p.p90); }
    const pad = (vMax - vMin) * 0.08 || vMax * 0.1 || 1;
    vMin = Math.max(0, vMin - pad); vMax += pad;

    const x = t => padL + (t / tMax) * (W - padL - padR);
    const y = v => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);

    const line = key => band.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
    const area = `${line('p90')}${band.slice().reverse().map(p => `L${x(p.t).toFixed(1)},${y(p.p10).toFixed(1)}`).join('')}Z`;

    const yt = niceTicks(vMin, vMax, 4);
    const xtCount = Math.min(Math.round(tMax), 10) || 1;
    const xt = [];
    for (let i = 0; i <= xtCount; i++) xt.push((tMax * i) / xtCount);

    const color = opts.color || '#e8b64c';
    const th = theme();
    const isFlat = band.every(p => Math.abs(p.p90 - p.p10) < (vMax - vMin) * 0.002);

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      ${yt.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${th.grid}" stroke-width="1"/>
        <text x="${padL - 8}" y="${y(v) + 4}" fill="${th.label}" font-size="10.5" text-anchor="end">${compactINR(v)}</text>`).join('')}
      ${xt.map(t => `<text x="${x(t)}" y="${H - 8}" fill="${th.label}" font-size="10.5" text-anchor="middle">${t === 0 ? 'Now' : (tMax <= 2 ? (t * 12).toFixed(0) + 'mo' : '+' + t.toFixed(0) + 'y')}</text>`).join('')}
      ${isFlat ? '' : `<path d="${area}" fill="${color}" opacity="0.13"/>`}
      ${isFlat ? '' : `<path d="${line('p90')}" fill="none" stroke="${color}" stroke-width="1" opacity="0.45" stroke-dasharray="3 4"/>`}
      ${isFlat ? '' : `<path d="${line('p10')}" fill="none" stroke="${color}" stroke-width="1" opacity="0.45" stroke-dasharray="3 4"/>`}
      <path d="${line('p50')}" fill="none" stroke="${color}" stroke-width="2.2"/>
    </svg>`;
  }

  // ------- simple line chart: values[] -------
  function line(values, opts = {}) {
    const W = opts.width || 720, H = opts.height || 240;
    const padL = 58, padR = 14, padT = 12, padB = 24;
    if (!values || values.length < 2) return `<svg viewBox="0 0 ${W} ${H}"></svg>`;

    let vMin = Math.min(...values), vMax = Math.max(...values);
    const pad = (vMax - vMin) * 0.1 || vMax * 0.05 || 1;
    vMin -= pad; vMax += pad;

    const x = i => padL + (i / (values.length - 1)) * (W - padL - padR);
    const y = v => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const areaD = `${d}L${x(values.length - 1)},${H - padB}L${x(0)},${H - padB}Z`;
    const up = values[values.length - 1] >= values[0];
    const color = opts.color || (up ? '#2ecc8f' : '#f4586f');
    const th = theme();
    const yt = niceTicks(vMin, vMax, 4);
    const labels = opts.xLabels || [];

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="lg${opts.gid || 1}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${yt.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${th.grid}" stroke-width="1"/>
        <text x="${padL - 8}" y="${y(v) + 4}" fill="${th.label}" font-size="10.5" text-anchor="end">${opts.yFmt ? opts.yFmt(v) : compactINR(v)}</text>`).join('')}
      ${labels.map((l, i) => `<text x="${padL + (i / (labels.length - 1)) * (W - padL - padR)}" y="${H - 6}" fill="${th.label}" font-size="10.5" text-anchor="middle">${esc(l)}</text>`).join('')}
      <path d="${areaD}" fill="url(#lg${opts.gid || 1})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2"/>
      <circle cx="${x(values.length - 1)}" cy="${y(values[values.length - 1])}" r="3.5" fill="${color}"/>
    </svg>`;
  }

  // ------- donut: slices = [{label, value}] -------
  function donut(slices, opts = {}) {
    const size = opts.size || 190;
    const cx = size / 2, cy = size / 2, r = size / 2 - 8, rIn = r * 0.62;
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    let a0 = -Math.PI / 2;
    const paths = slices.map((s, i) => {
      const frac = s.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const p = `M${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)}
        A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}
        L${cx + rIn * Math.cos(a1)},${cy + rIn * Math.sin(a1)}
        A${rIn},${rIn} 0 ${large} 0 ${cx + rIn * Math.cos(a0)},${cy + rIn * Math.sin(a0)}Z`;
      a0 = a1;
      return `<path d="${p}" fill="${COLORS[i % COLORS.length]}" stroke="${theme().surface}" stroke-width="1.5"/>`;
    }).join('');
    const center = opts.centerLabel
      ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="${theme().text}" font-size="15" font-weight="700">${esc(opts.centerLabel)}</text>
         <text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="${theme().label}" font-size="10">${esc(opts.centerSub || '')}</text>`
      : '';
    return `<svg viewBox="0 0 ${size} ${size}" style="max-width:${size}px">${paths}${center}</svg>`;
  }

  // ------- time-series area (net-worth history) -------
  // points = [{date: 'YYYY-MM-DD', value}] sorted ascending
  function areaLayout(points, opts = {}) {
    const W = opts.width || 720, H = opts.height || 240;
    const padL = 58, padR = 18, padT = 14, padB = 28;
    const t0 = new Date(points[0].date).getTime();
    const t1 = new Date(points[points.length - 1].date).getTime();
    let vMin = Infinity, vMax = -Infinity;
    for (const p of points) { vMin = Math.min(vMin, p.value); vMax = Math.max(vMax, p.value); }
    const pad = (vMax - vMin) * 0.1 || Math.abs(vMax) * 0.05 || 1;
    vMin -= pad; vMax += pad;
    const x = t => padL + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - padL - padR);
    const y = v => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);
    return { W, H, padL, padR, padT, padB, t0, t1, vMin, vMax, x, y };
  }

  function monthTicks(t0, t1) {
    const months = Math.max(1, (t1 - t0) / (30.44 * 24 * 3600 * 1000));
    const step = Math.max(1, Math.ceil(months / 5));
    const ticks = [];
    const d = new Date(t0);
    d.setDate(1); d.setMonth(d.getMonth() + 1); // first month boundary inside range
    const wantYear = months > 10;
    while (d.getTime() <= t1) {
      const label = d.toLocaleDateString('en-IN', { month: 'short' }) +
        (wantYear || d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : '');
      ticks.push({ t: d.getTime(), label });
      d.setMonth(d.getMonth() + step);
    }
    return ticks;
  }

  function area(points, opts = {}) {
    if (!points || points.length < 2) return '';
    const L = areaLayout(points, opts);
    const { W, H, padL, padR, padB, x, y } = L;
    const th = theme();
    const color = opts.color || '#e8b64c';
    const gid = opts.gid || 'nw';
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(new Date(p.date).getTime()).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const areaD = `${d}L${(W - padR).toFixed(1)},${H - padB}L${padL},${H - padB}Z`;
    const yt = niceTicks(L.vMin, L.vMax, 4);
    const xt = monthTicks(L.t0, L.t1);
    const last = points[points.length - 1];

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-area="${gid}" role="img" aria-label="${esc(opts.ariaLabel || 'Net worth over time')}">
      <defs><linearGradient id="ag${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
      </linearGradient></defs>
      ${yt.map(v => `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" stroke="${th.grid}" stroke-width="1"/>
        <text x="${padL - 8}" y="${y(v) + 4}" fill="${th.label}" font-size="10.5" text-anchor="end">${compactINR(v)}</text>`).join('')}
      ${xt.map(tk => `<text x="${x(tk.t).toFixed(1)}" y="${H - 8}" fill="${th.label}" font-size="10.5" text-anchor="middle">${esc(tk.label)}</text>`).join('')}
      <path d="${areaD}" fill="url(#ag${gid})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2"/>
      <circle cx="${x(new Date(last.date).getTime())}" cy="${y(last.value)}" r="4" fill="${color}" stroke="${th.surface}" stroke-width="2"/>
      <line data-crosshair x1="0" x2="0" y1="${L.padT}" y2="${H - padB}" stroke="${th.label}" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
      <circle data-hoverdot r="4" fill="${color}" stroke="${th.surface}" stroke-width="2" opacity="0"/>
      <rect data-hit x="${padL}" y="${L.padT}" width="${W - padL - padR}" height="${H - L.padT - padB}" fill="transparent"/>
    </svg>`;
  }

  // hover layer: crosshair + tooltip on the nearest snapshot.
  // `container` is the .chart-box the svg was rendered into.
  function wireArea(container, points, opts = {}) {
    if (!container || !points || points.length < 2) return;
    const svg = container.querySelector('svg[data-area]');
    if (!svg) return;
    const L = areaLayout(points, opts);
    const cross = svg.querySelector('[data-crosshair]');
    const dot = svg.querySelector('[data-hoverdot]');
    const hit = svg.querySelector('[data-hit]');
    let tip = container.querySelector('.chart-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      container.style.position = 'relative';
      container.appendChild(tip);
    }
    const times = points.map(p => new Date(p.date).getTime());

    function show(clientX) {
      const rect = svg.getBoundingClientRect();
      const scale = L.W / rect.width;
      const vx = (clientX - rect.left) * scale;
      const frac = Math.max(0, Math.min(1, (vx - L.padL) / (L.W - L.padL - L.padR)));
      const t = L.t0 + frac * (L.t1 - L.t0);
      let best = 0, bestD = Infinity;
      for (let i = 0; i < times.length; i++) {
        const dd = Math.abs(times[i] - t);
        if (dd < bestD) { bestD = dd; best = i; }
      }
      const p = points[best];
      const px = L.x(times[best]), py = L.y(p.value);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('opacity', '0.6');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('opacity', '1');
      tip.innerHTML = `<div class="tip-date">${Fin.fmtDate(p.date)}</div><div class="tip-val">${Fin.fmtINR(p.value)}</div>`;
      tip.style.opacity = '1';
      const leftPx = (px / L.W) * rect.width;
      tip.style.left = Math.max(6, Math.min(rect.width - 130, leftPx + 10)) + 'px';
      tip.style.top = Math.max(0, (py / L.H) * rect.height - 52) + 'px';
    }
    function hide() {
      cross.setAttribute('opacity', '0');
      dot.setAttribute('opacity', '0');
      tip.style.opacity = '0';
    }
    hit.addEventListener('mousemove', e => show(e.clientX));
    hit.addEventListener('mouseleave', hide);
    hit.addEventListener('touchstart', e => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
    hit.addEventListener('touchmove', e => { if (e.touches[0]) show(e.touches[0].clientX); }, { passive: true });
    hit.addEventListener('touchend', hide);
  }

  // ------- sparkline -------
  function spark(values, opts = {}) {
    const W = opts.width || 110, H = opts.height || 30;
    if (!values || values.length < 2) return '';
    const vMin = Math.min(...values), vMax = Math.max(...values);
    const x = i => (i / (values.length - 1)) * (W - 2) + 1;
    const y = v => 1 + (1 - (v - vMin) / ((vMax - vMin) || 1)) * (H - 2);
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const up = values[values.length - 1] >= values[0];
    const color = opts.color || (up ? '#2ecc8f' : '#f4586f');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
  }

  return { fan, line, area, wireArea, donut, spark, COLORS, compactINR, theme };
})();

if (typeof globalThis !== 'undefined') globalThis.Charts = Charts;
