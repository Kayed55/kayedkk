// دليل استخدام نظام الجودة — مولّد PDF عبر Chrome (puppeteer-core) + Paged.js
// التشغيل: node build.js  [input.html]  [output.pdf]
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const input = process.argv[2] || 'manual.html';
const output = process.argv[3] || 'دليل-استخدام-نظام-الجودة.pdf';
const inPath = path.resolve(__dirname, input);
const outPath = path.resolve(__dirname, output);

(async () => {
  if (!fs.existsSync(inPath)) { console.error('❌ ملف الإدخال غير موجود:', inPath); process.exit(1); }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(m.text()));
  page.on('pageerror', e => msgs.push('PAGEERROR: ' + e.message));

  await page.goto('file://' + inPath, { waitUntil: 'networkidle0', timeout: 120000 });
  // انتظر انتهاء Paged.js من التصفيح + جاهزية الخطوط
  await page.evaluateHandle('document.fonts.ready');
  await page.waitForFunction('window.__PAGED_DONE__ === true', { timeout: 120000 });
  const pageCount = await page.evaluate(() => document.querySelectorAll('.pagedjs_page').length);

  await page.pdf({
    path: outPath,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
    margin: { top: 0, right: 0, bottom: 0, left: 0 }
  });
  await browser.close();
  const kb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`✅ PDF: ${outPath}`);
  console.log(`   صفحات (paged.js): ${pageCount} · الحجم: ${kb}KB`);
  const warns = msgs.filter(m => /error|warn|fail/i.test(m));
  if (warns.length) console.log('⚠️ رسائل:', warns.slice(0, 8).join(' | '));
})().catch(e => { console.error('❌', e.message); process.exit(1); });
