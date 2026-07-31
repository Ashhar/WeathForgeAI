/* ============================================================
   WealthForge AI — data export (CSV backup + portfolio PDF)
   Full implementation lands with the Export feature; the account
   page links here.
   ============================================================ */

const ExportKit = (() => {
  function downloadAllCsv() { UI.toast('CSV export is on its way in the next update'); }
  function downloadPdf() { UI.toast('PDF export is on its way in the next update'); }
  return { downloadAllCsv, downloadPdf };
})();

if (typeof globalThis !== 'undefined') globalThis.ExportKit = ExportKit;
