/**
 * PDF Export Module
 * تصدير التقارير إلى PDF بمقاس A4 احترافي مع شعار محزم
 */

const PDF_CONFIG = {
  A4_WIDTH_MM: 210,
  A4_HEIGHT_MM: 297,
  MARGIN_MM: 12,
  CONTENT_WIDTH_PX: 720,
  RENDER_SCALE: 2.5,
  JPEG_QUALITY: 0.95
};

window.PDFExport = {
  /**
   * بناء فوتر PDF موحّد - يظهر في كل صفحة
   */
  buildFooter() {
    const today = new Date();
    const dateStr = `${today.getDate().toString().padStart(2,'0')}/${(today.getMonth()+1).toString().padStart(2,'0')}/${today.getFullYear()}`;
    const timeStr = `${today.getHours().toString().padStart(2,'0')}:${today.getMinutes().toString().padStart(2,'0')}`;
    return `
<div style="border-top:2px solid #06579F;padding:8px 0 6px;background:linear-gradient(to bottom,#f8fafc,#ffffff);width:100%;box-sizing:border-box">
<div style="display:flex;justify-content:space-between;align-items:center;padding:0 14px;gap:10px">
<div style="display:flex;align-items:center;gap:10px;flex:1 1 35%;min-width:0">
<div style="width:40px;height:40px;background:linear-gradient(135deg,#06579F,#1B202C);border-radius:8px;padding:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${window.MAHZAM_LOGO_LIGHT_SVG}</div>
<div style="min-width:0;overflow:hidden">
<div style="font-size:11px;font-weight:800;color:#06579F;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${window.SYSTEM_NAME}</div>
<div style="font-size:9px;color:#1B202C;font-weight:600;line-height:1.2">${window.COMPANY_NAME} • Mahzam Co.</div>
</div>
</div>
<div style="text-align:center;flex:1 1 30%;min-width:0">
<div style="font-size:10px;color:#1e293b;font-weight:600;line-height:1.3">📅 ${dateStr} • ⏰ ${timeStr}</div>
<div style="font-size:8px;color:#64748b;margin-top:1px">تاريخ ووقت الإصدار</div>
</div>
<div style="text-align:left;flex:1 1 30%;min-width:0">
<div style="font-size:9px;color:#64748b;line-height:1.3">تم إنشاؤه آلياً</div>
<div style="font-size:8px;color:#94a3b8;margin-top:1px">© ${today.getFullYear()} ${window.COMPANY_NAME}</div>
</div>
</div>
</div>`;
  },

  /**
   * رأس PDF موحّد - يظهر في بداية كل تقرير
   */
  buildHeader(title, subtitle, accentColor = '#06579F') {
    return `<div style="margin-bottom:14px;border-bottom:3px solid ${accentColor};padding-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;box-sizing:border-box">
<div style="width:70px;height:70px;flex-shrink:0;display:flex;align-items:center;justify-content:center">${window.MAHZAM_LOGO_SVG}</div>
<div style="flex:1;min-width:0;text-align:center">
<div style="color:#1B202C;font-size:11px;font-weight:700;margin-bottom:3px">${window.COMPANY_NAME} • Mahzam Co.</div>
<h1 style="color:${accentColor};font-size:20px;margin:0;line-height:1.2;font-weight:800">${title}</h1>
${subtitle ? `<div style="color:#475569;font-size:12px;margin-top:4px;font-weight:600">${subtitle}</div>` : ''}
<div style="color:#94a3b8;font-size:10px;margin-top:3px">${window.SYSTEM_NAME}</div>
</div>
<div style="width:70px;flex-shrink:0;text-align:left">
<div style="background:${accentColor};color:white;padding:5px 8px;border-radius:5px;font-size:9px;font-weight:700;text-align:center">تقرير رسمي</div>
<div style="margin-top:4px;text-align:center;font-size:8px;color:#64748b">${new Date().toLocaleDateString('ar-SA-u-nu-latn')}</div>
</div>
</div>`;
  },

  PRINT_CSS: `<style>
* { box-sizing: border-box !important; }
.card, table, .alert, .stat-card { page-break-inside: avoid !important; break-inside: avoid !important; }
h1, h2, h3 { page-break-after: avoid !important; break-after: avoid !important; }
tr, thead { page-break-inside: avoid !important; break-inside: avoid !important; }
thead { display: table-header-group !important; }
tfoot { display: table-footer-group !important; }
table { border-collapse: collapse !important; width: 100% !important; max-width: 100% !important; table-layout: fixed; }
td, th { word-wrap: break-word; overflow-wrap: break-word; }
img, svg { max-width: 100% !important; height: auto !important; }
body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style>`,

  /**
   * تحويل HTML إلى PDF بمقاس A4
   * @param {string} htmlContent - محتوى الـ HTML (لا يشمل الرأس/الفوتر)
   * @param {string} filename - اسم الملف الناتج
   */
  async toPDF(htmlContent, filename) {
    const { jsPDF } = window.jspdf;
    const cfg = PDF_CONFIG;

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;left:-10000px;top:0;width:${cfg.CONTENT_WIDTH_PX}px;padding:0;background:white;font-family:'Cairo',sans-serif;direction:rtl;color:#1e293b;line-height:1.5;font-size:12px`;
    wrap.innerHTML = this.PRINT_CSS + '<div>' + htmlContent + '</div>';
    document.body.appendChild(wrap);

    const footerEl = document.createElement('div');
    footerEl.style.cssText = `position:fixed;left:-10000px;top:0;width:${cfg.CONTENT_WIDTH_PX}px;background:white;font-family:'Cairo',sans-serif;direction:rtl`;
    footerEl.innerHTML = this.buildFooter();
    document.body.appendChild(footerEl);

    try {
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch(e) {}
      }

      const [contentCanvas, footerCanvas] = await Promise.all([
        html2canvas(wrap, {
          scale: cfg.RENDER_SCALE,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: cfg.CONTENT_WIDTH_PX,
          imageTimeout: 0
        }),
        html2canvas(footerEl, {
          scale: cfg.RENDER_SCALE,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          windowWidth: cfg.CONTENT_WIDTH_PX,
          imageTimeout: 0
        })
      ]);

      const contentImg = contentCanvas.toDataURL('image/jpeg', cfg.JPEG_QUALITY);
      const footerImg = footerCanvas.toDataURL('image/jpeg', cfg.JPEG_QUALITY);

      const pdfW = cfg.A4_WIDTH_MM, pdfH = cfg.A4_HEIGHT_MM;
      const margin = cfg.MARGIN_MM;
      const imgW = pdfW - margin * 2;

      const footerH = (footerCanvas.height * imgW) / footerCanvas.width;
      const footerGap = 3;
      const pageNumberH = 6;
      const contentAreaH = pdfH - margin - footerH - footerGap - pageNumberH;
      const contentStartY = margin;
      const contentImgH = (contentCanvas.height * imgW) / contentCanvas.width;
      const totalPages = Math.max(1, Math.ceil(contentImgH / contentAreaH));

      for (let p = 0; p < totalPages; p++) {
        if (p > 0) pdf.addPage();
        const yOffset = contentStartY - (p * contentAreaH);
        pdf.addImage(contentImg, 'JPEG', margin, yOffset, imgW, contentImgH, undefined, 'FAST');
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pdfW, contentStartY, 'F');
        pdf.rect(0, contentStartY + contentAreaH, pdfW, pdfH - (contentStartY + contentAreaH), 'F');
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.2);
        pdf.line(margin, contentStartY + contentAreaH + footerGap/2, pdfW - margin, contentStartY + contentAreaH + footerGap/2);
        const footerY = pdfH - margin/2 - footerH - pageNumberH;
        pdf.addImage(footerImg, 'JPEG', margin, footerY, imgW, footerH, undefined, 'FAST');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139);
        pdf.text(`Page ${p + 1} of ${totalPages}`, pdfW / 2, pdfH - 4, { align: 'center' });
      }

      pdf.save(filename);
      return true;
    } finally {
      if (wrap.parentNode) document.body.removeChild(wrap);
      if (footerEl.parentNode) document.body.removeChild(footerEl);
    }
  }
};
