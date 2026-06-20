# JS Modules - ترتيب التحميل

| الملف | المحتوى | الحجم التقريبي |
|------|---------|----------------|
| `01-constants.js` | الشعار، الأسماء، معايير التقييم | 8 KB |
| `02-db.js` | طبقة قاعدة البيانات (CRUD على localStorage) | 14 KB |
| `03-core.js` | calculateScores, Utils, Perms, Toast, Modal | 5 KB |
| `04-pages.js` | جميع صفحات الواجهة + PDF/Excel exports | 200+ KB |
| `05-app.js` | تشغيل التطبيق وبدء الجلسة | 1 KB |

**⚠️ يجب تحميل الملفات بهذا الترتيب** (يتم في `index.html`).

كل ملف يبدأ بـ `'use strict'` ويحتوي على JSDoc header.

## للتوسع المستقبلي:
يمكن تقسيم `04-pages.js` إلى ملفات أصغر:
- `ui/login.js`, `ui/dashboard.js`, `ui/employees.js`, etc.

لكن للأداء (one HTTP request fewer) ولسهولة الصيانة، تم تجميعها حالياً.
