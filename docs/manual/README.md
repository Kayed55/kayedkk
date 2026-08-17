# دليل استخدام نظام الجودة — مصدر التوليد

مجلد مصدر لتوليد ملف **دليل-استخدام-نظام-الجودة.pdf** (A4 · عربي RTL) من HTML عبر Chrome + Paged.js.

## المحتويات
- `manual.html` — المصدر الكامل للدليل (الغلاف، الفهرس، الفصول، الجداول، المخططات).
- `assets/` — الخط (Cairo woff2)، `cairo.css`، `paged.polyfill.min.js`، `logo.svg`.
- `images/` — لقطات الشاشة الفعلية (تُضاف لاحقاً).
- `build.js` — سكربت التوليد (puppeteer-core + Chrome النظام).
- `دليل-استخدام-نظام-الجودة.pdf` — المخرج النهائي.

## إعادة البناء بعد أي تعديل
```bash
cd docs/manual
npm i puppeteer-core@23 --no-save   # مرة واحدة (إن لم تكن مثبّتة)
node build.js manual.html "دليل-استخدام-نظام-الجودة.pdf"
```
يتطلّب Google Chrome مثبّتاً على macOS في المسار الافتراضي.

## إضافة لقطات الشاشة
1. ضع الصور في `images/`.
2. في `manual.html` استبدل إطار الشاشة:
   `<div class="shot">…</div>` بـ `<div class="shot"><img src="images/xxx.png"></div>`.
3. أعد البناء.
