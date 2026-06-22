# 🛡️ نظام الجودة للتقييم والتدريب

> **Mahzam Quality Evaluation & Training System** - منظومة احترافية متكاملة لإدارة جودة الأداء

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)](docs/CHANGELOG.md)
[![Static Site](https://img.shields.io/badge/type-Static_Site-success)](https://vercel.com)
[![Arabic RTL](https://img.shields.io/badge/lang-Arabic_RTL-orange)]()
[![Deploy](https://img.shields.io/badge/deploy-Vercel-black?logo=vercel)](https://vercel.com)
[![Database](https://img.shields.io/badge/database-Supabase-3ECF8E?logo=supabase)](https://supabase.com)

---

## 📑 المحتويات

- [نظرة عامة](#-نظرة-عامة)
- [الميزات](#-الميزات)
- [بنية المشروع](#-بنية-المشروع)
- [التثبيت السريع](#-التثبيت-السريع-5-دقائق)
- [التشغيل المحلي](#-التشغيل-المحلي)
- [النشر على Vercel](#-النشر-على-vercel)
- [حسابات الاختبار](#-حسابات-اختبار-جاهزة)
- [الوثائق التفصيلية](#-الوثائق-التفصيلية)
- [المساهمة](#-المساهمة)
- [الترخيص](#-الترخيص)

---

## 🌟 نظرة عامة

🔗 **الإنتاج (Production):** https://kayedkk.vercel.app

نظام **محزم للجودة** هو منصة ويب متكاملة لإدارة عمليات تقييم الموظفين والتدريب، مصمّمة خصيصاً لشركة محزم بدعم كامل للغة العربية واتجاه RTL.

**التقنيات المستخدمة:**
- 🎨 **Frontend**: HTML5 + CSS3 + JavaScript (Vanilla, no framework)
- 🗄️ **Backend**: Supabase (PostgreSQL) - اختياري، يعمل أيضاً مع localStorage
- 📊 **Charts**: Chart.js
- 📄 **PDF Export**: jsPDF + html2canvas (A4 احترافي)
- 📑 **Excel Export**: SheetJS (xlsx)
- 🚀 **Hosting**: Vercel (Static)

---

## ✨ الميزات

### 👥 إدارة المستخدمين والأدوار
- 4 أدوار: **مدير النظام** / **موظف الجودة** / **مشرف** / **موظف**
- نظام صلاحيات (RBAC) كامل
- تسجيل دخول بالبريد الإلكتروني + كلمة مرور
- سياسة كلمة مرور صارمة (8 أحرف + حرف + رقم + رمز)
- استعادة كلمة المرور + إعادة تعيين من قِبَل المدير

### 📝 نظام التقييم
- نموذج تقييم بـ **40 بنداً** في **4 أقسام** (15 + 30 + 30 + 25 نقطة)
- خيار "**لا يوجد ملاحظات**" للتقييمات الإيجابية
- ربط كل موظف بمشرف مباشر (Dropdown من قاعدة البيانات)
- إجراء الجودة + إجراء المشرف (منفصلان)
- نظام اعتماد التقييمات

### 📊 التصنيف (ثنائي)
| النسبة | التقدير |
|--------|---------|
| ≤ 84% | راسب |
| 85% - 100% | ناجح |

### ⚖️ نظام الاعتراضات
- تقديم اعتراض من قِبَل الموظف
- مرفقات + سبب الاعتراض
- رقم مرجعي تلقائي (`OBJ-2026-XXXX`)
- مراجعة وقبول/رفض من موظف الجودة
- نظام تعليقات داخلي

### 📈 التقارير
- **التقرير الشامل** - أداء الفريق + التصدير
- **التقرير الشهري** + التقييم النهائي العام للموظفين
- **الأخطاء المتكررة** - حسب الإدارة/المشرف
- **تقرير الإجراءات** - تحليل تأثير الإجراءات

### 🎨 الهوية البصرية
- شعار محزم SVG (inline fills - يظهر بألوانه في PDF)
- التاجلاين: **"محزمك المليان"**
- ألوان محزم: `#06579F` + `#1B202C` + `#202E4D`
- خط Cairo للعربية

### 📄 تصدير احترافي
- **PDF بمقاس A4** (هامش 12mm، دقة 246 DPI)
- شعار محزم في الرأس والفوتر
- دعم الصفحات المتعددة مع حماية من قص الجداول
- **Excel** متعدد الشيتات

### 📜 سجل العمليات (Audit Log)
- تسجيل تلقائي لكل عملية: إنشاء/تعديل/حذف/اعتماد/تسجيل دخول
- بحث وفلترة + تصدير

### 📊 لوحة التحكم
- بطاقات إحصائية ملوّنة
- KPIs الجودة: أكثر الأخطاء على مستوى الشركة/الفريق/الموظف
- "يحتاجون متابعة" يعرض الراسبين فقط (آخر تقييم ≤84)
- المشرفون الأكثر متابعة + نسبة التحسن الشهرية

---

## 📁 بنية المشروع

```
mahzam-quality-system/
├── 📄 README.md                    ← هذا الملف
├── 📄 LICENSE                      ← ترخيص الاستخدام
├── 📄 package.json                 ← إعدادات Node
├── 📄 vercel.json                  ← إعدادات النشر
├── 📄 .gitignore
├── 📄 .editorconfig                ← توحيد محرر النصوص
├── 📄 .prettierrc.json             ← تنسيق الكود
├── 📄 .vercelignore
│
├── 📁 public/                      ← الملفات المنشورة على الويب
│   ├── 📄 index.html               ← الصفحة الرئيسية
│   ├── 📁 css/
│   │   └── 📄 styles.css           ← تنسيقات النظام
│   ├── 📁 js/                      ← 5 وحدات JavaScript بترتيب التحميل
│   │   ├── 📄 README.md
│   │   ├── 📄 01-constants.js      ← الشعار، الأسماء، معايير التقييم
│   │   ├── 📄 02-db.js             ← طبقة قاعدة البيانات
│   │   ├── 📄 03-core.js           ← Utils + Perms + Toast + Modal
│   │   ├── 📄 04-pages.js          ← جميع صفحات الواجهة
│   │   └── 📄 05-app.js            ← تشغيل التطبيق
│   └── 📁 assets/
│       └── 📄 logo.svg             ← شعار محزم
│
├── 📁 supabase/                    ← قاعدة بيانات Supabase (اختياري)
│   ├── 📄 README.md
│   ├── 📄 supabase-setup.sql       ← ⭐ الإعداد الكامل في ملف واحد
│   ├── 📄 01-schema.sql            ← الجداول فقط
│   ├── 📄 02-seed.sql              ← البيانات الأولية
│   └── 📄 verify.sql               ← استعلامات التحقق
│
├── 📁 docs/                        ← الوثائق
│   ├── 📄 ARCHITECTURE.md          ← هيكلة النظام
│   ├── 📄 DEPLOY.md                ← دليل النشر التفصيلي
│   ├── 📄 CHANGELOG.md             ← سجل التغييرات
│   └── 📄 SECURITY.md              ← السياسة الأمنية
│
├── 📁 .github/                     ← إعدادات GitHub
│   ├── 📁 workflows/
│   │   └── 📄 deploy.yml           ← CI/CD pipeline
│   ├── 📁 ISSUE_TEMPLATE/
│   │   ├── 📄 bug_report.md
│   │   └── 📄 feature_request.md
│   └── 📄 PULL_REQUEST_TEMPLATE.md
│
└── 📄 CONTRIBUTING.md              ← دليل المساهمة
```

---

## ⚡ التثبيت السريع (5 دقائق)

### 1. استنسخ المستودع
```bash
git clone https://github.com/USERNAME/mahzam-quality-system.git
cd mahzam-quality-system
```

### 2. شغّله محلياً
```bash
npx serve public -p 3000
# أو
python3 -m http.server -d public 3000
```

افتح: http://localhost:3000

النظام يعمل **مباشرة** بدون أي إعداد إضافي (يستخدم localStorage).

### 3. (اختياري) Supabase للمزامنة بين الأجهزة
راجع: [supabase/README.md](supabase/README.md)

---

## 🏃 التشغيل المحلي

```bash
# الطريقة 1: serve (موصى)
npx serve public -p 3000

# الطريقة 2: Python
python3 -m http.server -d public 3000

# الطريقة 3: VS Code Live Server extension
# افتح public/ ثم Right-click → "Open with Live Server"
```

> ⚠️ **مهم**: لا تفتح `index.html` مباشرة من الملف (`file://`) — يجب تشغيل web server محلي.

---

## ⚙️ الإعدادات والمفاتيح (لا توجد متغيّرات بيئة)

هذا موقع ثابت (Static) — لا يستخدم build ولا ملف `.env`. كل الإعدادات داخل ملفات JS (يصل لها المتصفّح، لذلك تُستخدم مفاتيح عامّة آمنة فقط):

| الإعداد | المكان | الملاحظة |
|---|---|---|
| **Supabase URL + anon key** | `public/js/00-supabase-sync.js` | مفتاح **anon** عام (آمن للنشر). لا تضع `service_role` هنا أبداً. |
| **EmailJS** (publicKey, serviceId, templateId) | `public/js/services/email-service.js` | مفاتيح عامّة للإرسال من المتصفّح. القالب الموحّد: `template_universal`. |
| **معايير التقييم** | `public/js/01-constants.js` + جدول `criteria_config` | تُحرّر من قسم الإعدادات. |

> العمليات الحسّاسة (تسجيل الدخول، OTP، إعادة تعيين كلمة المرور، الحذف الشامل) تمرّ عبر دوال **RPC** في Supabase بصلاحية `SECURITY DEFINER` — لا تعتمد على مفاتيح حسّاسة في الواجهة. انظر `security-migration/`.

---

## 🚀 النشر على Vercel

### الطريقة 1: GitHub Integration (موصى)
1. ارفع المشروع على GitHub
2. اذهب إلى https://vercel.com → **Add New Project**
3. اختر المستودع
4. الإعدادات: **Framework = Other**، باقي الحقول فارغة
5. اضغط **Deploy** → جاهز خلال 30 ثانية ✅

### الطريقة 2: Vercel CLI
```bash
npm i -g vercel
vercel --prod
```

### الطريقة 3: Drag & Drop
- اضغط على مجلد `public/` على Vercel Dashboard لرفعه مباشرة.

تفاصيل أكثر في [docs/DEPLOY.md](docs/DEPLOY.md)

---

## 👥 حسابات اختبار جاهزة

| الدور | البريد الإلكتروني | كلمة المرور |
|------|------------------|------------|
| 👑 مدير النظام | `admin@example.com` | `Admin@123` |
| ⚖️ موظف الجودة | `quality@example.com` | `Quality@123` |
| 👨‍💼 مشرف | `supervisor@example.com` | `Super@123` |
| 👤 موظف | `emp001@example.com` | `Emp@123A!` |

> 🔒 **مهم**: غيّر كلمات المرور هذه قبل النشر للإنتاج!

---

## 📚 الوثائق التفصيلية

| الوثيقة | الوصف |
|---------|-------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | هيكلة النظام والـ modules |
| [DEPLOY.md](docs/DEPLOY.md) | دليل النشر المفصل (GitHub + Vercel + Supabase) |
| [CHANGELOG.md](docs/CHANGELOG.md) | سجل الإصدارات والتغييرات |
| [SECURITY.md](docs/SECURITY.md) | السياسة الأمنية والثغرات |
| [USER_GUIDE.md](USER_GUIDE.md) | دليل المستخدم بالعربية |
| [BACKUP.md](BACKUP.md) | النسخ الاحتياطي والاسترجاع |
| [ADMIN_RECOVERY.md](ADMIN_RECOVERY.md) | استرجاع حساب المدير |
| [CONTRIBUTING.md](CONTRIBUTING.md) | دليل المساهمة في التطوير |
| [supabase/README.md](supabase/README.md) | إعداد قاعدة البيانات |

---

## 🤝 المساهمة

نرحب بمساهماتكم! راجع [CONTRIBUTING.md](CONTRIBUTING.md) للتفاصيل.

**سير العمل المختصر:**
```bash
git checkout -b feature/my-feature
# ... edits ...
npm run format     # تنسيق
git commit -m "feat: my feature"
git push origin feature/my-feature
# افتح Pull Request
```

---

## 📝 الترخيص

هذا المشروع ملكية خاصة لـ **شركة محزم • Mahzam Co.**

راجع [LICENSE](LICENSE) للتفاصيل.

---

## 🆘 الدعم

- 🐛 **الأخطاء**: افتح [Issue](https://github.com/USERNAME/mahzam-quality-system/issues)
- 💡 **اقتراحات**: استخدم نموذج Feature Request
- 📚 **Supabase**: https://supabase.com/docs
- 📚 **Vercel**: https://vercel.com/docs

---

<div align="center">

**صُنع بـ ❤️ في شركة محزم**

[**🌐 محزمك المليان**](https://mahzam.com)

</div>
