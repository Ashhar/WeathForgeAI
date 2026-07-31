/* ============================================================
   WealthForge AI — data export
   · CSV: assets, liabilities and snapshot history as separate
     files (clean headers, raw numbers, ISO dates) — doubles as a
     full data backup.
   · PDF: one-page portfolio snapshot via jsPDF (lazy-loaded chunk)
     with an embedded Noto Sans subset so ₹ renders correctly.
   Demo exports are allowed but watermarked.
   ============================================================ */

const ExportKit = (() => {
  const today = () => new Date().toISOString().slice(0, 10);

  // ---------- CSV ----------
  function cell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(headers, rows) {
    return [headers.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n');
  }
  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  function assetsCsv() {
    const rows = Store.all().map(a => {
      const v = Store.valuation(a);
      return [
        a.id, a.label, a.type, Store.TYPES[a.type] ? Store.TYPES[a.type].label : a.type,
        a.acquiredOn || '', a.ownership || 'single', a.sharePct != null ? a.sharePct : 100,
        v.mode, v.invested != null ? Math.round(v.invested) : '',
        Math.round(v.grossValue || 0), Math.round(v.currentValue || 0),
        v.annualized != null ? (v.annualized * 100).toFixed(2) : '', v.annualizedMethod || '',
      ];
    });
    return toCsv(
      ['id', 'name', 'type', 'type_label', 'acquired_on', 'ownership', 'share_pct',
       'valuation_mode', 'invested', 'gross_value', 'net_value_your_share', 'annualized_pct', 'annualized_method'],
      rows);
  }

  function liabilitiesCsv() {
    const rows = Store.liabilities().map(l => {
      const lv = Store.liabilityValuation(l);
      return [
        l.id, l.label || '', l.type, l.lender || '', l.principal != null ? l.principal : '',
        Math.round(lv.balance || 0), l.rate != null ? l.rate : '', l.emi != null ? l.emi : '',
        l.startDate || '', lv.payoffDate ? lv.payoffDate.toISOString().slice(0, 10) : '',
        lv.interestRemaining != null ? Math.round(lv.interestRemaining) : '',
      ];
    });
    return toCsv(
      ['id', 'name', 'type', 'lender', 'statement_balance', 'outstanding_balance',
       'interest_rate_pct', 'emi', 'start_date', 'projected_payoff_date', 'interest_remaining'],
      rows);
  }

  function snapshotsCsv() {
    const rows = Store.snapshots().map(s => [s.date, s.totalAssets, s.totalLiabilities, s.netWorth]);
    return toCsv(['date', 'total_assets', 'total_liabilities', 'net_worth'], rows);
  }

  function downloadAllCsv() {
    const d = today();
    downloadBlob(assetsCsv(), `wealthforge-assets-${d}.csv`);
    setTimeout(() => downloadBlob(liabilitiesCsv(), `wealthforge-liabilities-${d}.csv`), 350);
    setTimeout(() => downloadBlob(snapshotsCsv(), `wealthforge-history-${d}.csv`), 700);
    UI.toast('Downloading 3 CSV files — assets, liabilities, history');
  }

  // ---------- PDF ----------
  // ₹ with Indian digit grouping (the embedded font has U+20B9)
  const inGroup = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  function pdfINR(n, compact) {
    if (n == null || !isFinite(n)) return '—';
    const neg = n < 0 ? '−' : '';
    const v = Math.abs(n);
    if (compact) {
      if (v >= 1e7) return `${neg}₹${(v / 1e7).toFixed(2)} Cr`;
      if (v >= 1e5) return `${neg}₹${(v / 1e5).toFixed(2)} L`;
    }
    return `${neg}₹${inGroup.format(Math.round(v))}`;
  }

  async function svgToPng(svgString, w, h, bg) {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    // standalone SVG images need the xmlns declaration and explicit size
    const svg = svgString.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" `);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    ctx.drawImage(img, 0, 0, w, h);
    // JPEG keeps the PDF ~40x smaller than PNG for a filled chart
    return canvas.toDataURL('image/jpeg', 0.88);
  }

  async function downloadPdf() {
    UI.toast('Building your portfolio PDF…');
    const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const autoTable = autoTableMod.default;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    doc.addFileToVFS('NotoSans-Regular.ttf', PdfFont.regular);
    doc.addFileToVFS('NotoSans-Bold.ttf', PdfFont.bold);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
    doc.setFont('NotoSans', 'normal');

    const M = 14, W = 210 - M * 2;
    const gold = [217, 155, 37], ink = [23, 32, 47], dim = [100, 110, 130], faint = [150, 158, 172];
    const p = Store.portfolio();
    const isDemo = Store.isReadOnly();
    let y = M;

    // header
    doc.setFillColor(...gold);
    doc.roundedRect(M, y, 9, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(12);
    doc.text('W', M + 4.5, y + 6.3, { align: 'center' });
    doc.setTextColor(...ink); doc.setFontSize(14);
    doc.text('WealthForge AI', M + 12, y + 5);
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...dim);
    doc.text('Portfolio snapshot', M + 12, y + 9.5);
    doc.text(`Generated ${Fin.fmtDate(new Date())}${isDemo ? ' · DEMO DATA' : ''}`, 210 - M, y + 5, { align: 'right' });
    y += 14;
    doc.setDrawColor(225, 228, 235); doc.line(M, y, 210 - M, y);
    y += 8;

    // headline
    doc.setFontSize(9); doc.setTextColor(...dim);
    doc.text('NET WORTH (ASSETS − LIABILITIES)', M, y);
    doc.setFont('NotoSans', 'bold'); doc.setFontSize(22); doc.setTextColor(...ink);
    doc.text(pdfINR(p.netWorth), M, y + 9.5);
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(9); doc.setTextColor(...dim);
    const growth = (() => {
      const snaps = Store.snapshotRange(365);
      if (snaps.length < 2) return null;
      const first = snaps[0];
      return first.netWorth > 0 ? (p.netWorth - first.netWorth) / first.netWorth : null;
    })();
    const rightLines = [
      `Assets ${pdfINR(p.totalAssets, true)}   ·   Owed ${pdfINR(p.totalLiabilities, true)}`,
      growth != null ? `${Fin.fmtPct(growth)} over the last year` : '',
      `${Store.all().length} holdings · ${Store.liabilities().length} liabilities`,
    ].filter(Boolean);
    rightLines.forEach((t, i) => doc.text(t, 210 - M, y + 3 + i * 4.6, { align: 'right' }));
    y += 16;

    // history chart
    const snaps = Store.snapshots();
    if (snaps.length >= 2) {
      const pts = snaps.map(s => ({ date: s.date, value: s.netWorth }));
      const svg = Charts.area(pts, { width: 1460, height: 440, gid: 'pdf' });
      try {
        const img = await svgToPng(svg, 1460, 440, '#121826');
        doc.addImage(img, 'JPEG', M, y, W, W * 440 / 1460);
        y += W * 440 / 1460 + 7;
      } catch (e) { /* chart is optional in the PDF */ }
    }

    // assets table
    const assetRows = Store.all().map(a => {
      const v = Store.valuation(a);
      return [
        a.label,
        Store.TYPES[a.type] ? Store.TYPES[a.type].label : a.type,
        v.mode,
        v.invested != null ? pdfINR(v.invested, true) : '—',
        pdfINR(v.currentValue, true),
        v.annualized != null ? Fin.fmtPct(v.annualized) : '—',
      ];
    });
    autoTable(doc, {
      startY: y,
      head: [['Holding', 'Class', 'Mode', 'Invested', 'Current (your share)', 'Annualized']],
      body: assetRows,
      foot: [['Total assets', '', '', '', pdfINR(p.totalAssets, true), '']],
      margin: { left: M, right: M },
      styles: { font: 'NotoSans', fontSize: 7.6, cellPadding: 1.6, textColor: ink },
      headStyles: { fillColor: [240, 242, 247], textColor: dim, fontStyle: 'bold', fontSize: 7 },
      footStyles: { fillColor: [247, 243, 232], textColor: ink, fontStyle: 'bold' },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 6;

    // liabilities table
    if (Store.liabilities().length) {
      const liabRows = Store.liabilities().map(l => {
        const lv = Store.liabilityValuation(l);
        return [
          l.label || '', Store.LIABILITY_TYPES[l.type] ? Store.LIABILITY_TYPES[l.type].label : l.type,
          l.rate != null ? l.rate + '%' : '—', l.emi ? pdfINR(l.emi) : 'revolving',
          pdfINR(lv.balance, true), lv.payoffDate ? Fin.fmtDate(lv.payoffDate) : '—',
        ];
      });
      autoTable(doc, {
        startY: y,
        head: [['Liability', 'Type', 'Rate', 'EMI', 'Outstanding', 'Payoff']],
        body: liabRows,
        foot: [['Total owed', '', '', '', pdfINR(p.totalLiabilities, true), '']],
        margin: { left: M, right: M },
        styles: { font: 'NotoSans', fontSize: 7.6, cellPadding: 1.6, textColor: ink },
        headStyles: { fillColor: [240, 242, 247], textColor: dim, fontStyle: 'bold', fontSize: 7 },
        footStyles: { fillColor: [247, 243, 232], textColor: ink, fontStyle: 'bold' },
        columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // disclaimer footer on every page + demo watermark
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont('NotoSans', 'normal'); doc.setFontSize(7); doc.setTextColor(...faint);
      doc.text(
        'Illustrative, not financial advice. Values are as entered/estimated by you; market prices are indicative. WealthForge AI does not verify holdings.',
        M, 297 - 8, { maxWidth: W });
      if (isDemo) {
        doc.saveGraphicsState();
        doc.setGState(new doc.GState({ opacity: 0.08 }));
        doc.setFont('NotoSans', 'bold'); doc.setFontSize(70); doc.setTextColor(180, 130, 30);
        doc.text('DEMO DATA', 105, 160, { align: 'center', angle: 40 });
        doc.restoreGraphicsState();
      }
    }

    doc.save(`wealthforge-portfolio-${today()}.pdf`);
  }

  return { downloadAllCsv, downloadPdf, assetsCsv, liabilitiesCsv, snapshotsCsv };
})();

if (typeof globalThis !== 'undefined') globalThis.ExportKit = ExportKit;
