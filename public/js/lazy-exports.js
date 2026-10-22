/* Export libraries are fetched only when an export/import is requested. */
'use strict';
(function () {
  const pending = new Map();
  function load(src, ready) {
    if (ready()) return Promise.resolve();
    if (pending.has(src)) return pending.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => fail(), 20000);
      function fail() {
        clearTimeout(timer);
        script.remove();
        pending.delete(src);
        reject(new Error('تعذّر تحميل أدوات التصدير. حاول مرة أخرى.'));
      }
      script.src = src;
      script.onload = () => { if (!ready()) return fail(); clearTimeout(timer); resolve(); };
      script.onerror = fail;
      document.head.appendChild(script);
    });
    pending.set(src, promise);
    return promise;
  }
  async function ensure(kind) {
    if (kind === 'excel') return load('/vendor/xlsx-0.18.5.js', () => !!window.XLSX);
    await Promise.all([
      load('/vendor/jspdf-2.5.1.js', () => !!window.jspdf),
      load('/vendor/html2canvas-1.4.1.js', () => !!window.html2canvas)
    ]);
    await load('/vendor/jspdf-autotable-3.7.0.js', () => !!window.jspdf.jsPDF.API.autoTable);
  }
  function wrap(name, kind) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = async function (...args) {
      try { await ensure(kind); return await original.apply(this, args); }
      catch (error) { Toast.error(error.message || 'تعذّر التصدير'); }
    };
  }
  ['qrExportXLSX', 'exportReportsXLSX', 'exportCgReportsXLSX',
    'exportMonthlyReportXLSX', 'exportActionsReportXLSX', 'exportErrorsReportXLSX',
    'exportAuditLogXLSX', 'exportListXLSX', 'exportSingleXLSX',
    'exportMahzamTemplate', 'handleMahzamImport'].forEach(name => wrap(name, 'excel'));
  wrap('htmlToPDF', 'pdf');
})();
