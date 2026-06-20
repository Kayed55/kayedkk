/**
 * Excel Export Module
 * تصدير البيانات إلى ملفات Excel (.xlsx)
 */

window.XLSXExport = {
  /**
   * تصدير مصفوفة من الكائنات إلى ملف Excel
   * @param {Array<Object>} rows - الصفوف
   * @param {string} sheetName - اسم الشيت
   * @param {string} filename - اسم الملف
   * @param {Array<{wch:number}>} cols - عرض الأعمدة (اختياري)
   */
  exportRows(rows, sheetName, filename, cols = null) {
    if (!rows || !rows.length) {
      Toast.error('لا توجد بيانات للتصدير');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    if (cols) ws['!cols'] = cols;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
    Toast.success('تم تصدير الملف');
  },

  /**
   * تصدير عدة شيتات في ملف واحد
   * @param {Array<{name:string, rows:Array, cols?:Array}>} sheets
   * @param {string} filename
   */
  exportMultiSheet(sheets, filename) {
    const wb = XLSX.utils.book_new();
    sheets.forEach(s => {
      const ws = XLSX.utils.json_to_sheet(s.rows);
      if (s.cols) ws['!cols'] = s.cols;
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    });
    XLSX.writeFile(wb, filename);
    Toast.success('تم تصدير الملف');
  }
};
