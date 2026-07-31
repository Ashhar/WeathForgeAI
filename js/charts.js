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

  return { fan, line, donut, spark, COLORS, compactINR, theme };
})();
