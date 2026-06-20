# 🤝 دليل المساهمة | Contributing Guide

شكراً لاهتمامك بالمساهمة في **نظام الجودة للتقييم والتدريب**! 🎉

---

## 📋 جدول المحتويات

- [قواعد المساهمة](#-قواعد-المساهمة)
- [إعداد بيئة التطوير](#-إعداد-بيئة-التطوير)
- [سير عمل المساهمة](#-سير-عمل-المساهمة)
- [معايير الكود](#-معايير-الكود)
- [اختبار التغييرات](#-اختبار-التغييرات)
- [Commit Messages](#-commit-messages)
- [قائمة Pull Request](#-قائمة-pull-request)

---

## 📜 قواعد المساهمة

- ✅ كل المساهمات يجب أن تخدم أهداف شركة محزم
- ✅ احترام الهوية البصرية (شعار + ألوان محزم)
- ✅ دعم RTL والعربية في كل ميزة جديدة
- ✅ عدم إضافة dependencies خارجية بدون مبرر
- ✅ تحديث الوثائق عند تغيير سلوك النظام
- ❌ لا توزّع الكود خارج المؤسسة

---

## 🛠️ إعداد بيئة التطوير

### المتطلبات
- Node.js 18+
- متصفح حديث (Chrome، Firefox، Safari، Edge)
- محرر نصوص يدعم EditorConfig (VS Code موصى به)

### الخطوات
```bash
# 1. استنسخ المستودع
git clone https://github.com/USERNAME/mahzam-quality-system.git
cd mahzam-quality-system

# 2. ثبّت أدوات التطوير (اختياري)
npm install -g serve prettier

# 3. شغّل محلياً
npx serve public -p 3000

# 4. افتح المتصفح
open http://localhost:3000
```

### امتدادات VS Code الموصى بها
- **EditorConfig for VS Code** - توحيد التنسيق
- **Prettier** - تنسيق تلقائي
- **Arabic Language Support** - دعم العربية

---

## 🔄 سير عمل المساهمة

### 1. أنشئ Issue أولاً
قبل البدء بأي تغيير كبير، افتح Issue لمناقشة الفكرة:
- 🐛 **Bug Report** للأخطاء
- ✨ **Feature Request** للميزات الجديدة

### 2. أنشئ فرع جديد
```bash
git checkout -b feature/my-new-feature
# أو
git checkout -b fix/bug-description
```

**أنواع الفروع:**
- `feature/...` - ميزة جديدة
- `fix/...` - إصلاح خطأ
- `refactor/...` - تحسين الكود بدون تغيير السلوك
- `docs/...` - تحديث الوثائق
- `style/...` - تغييرات تنسيقية فقط

### 3. اعمل التغييرات
- اتبع [معايير الكود](#-معايير-الكود)
- اختبر تغييراتك ([دليل الاختبار](#-اختبار-التغييرات))
- نسّق الكود: `npx prettier --write "public/**/*.{html,css,js}"`

### 4. commit + push
```bash
git add .
git commit -m "feat: add monthly report export to PDF"
git push origin feature/my-new-feature
```

### 5. افتح Pull Request
- استخدم القالب الموجود في `.github/PULL_REQUEST_TEMPLATE.md`
- اربطه بالـ Issue الأصلي: `Closes #123`
- أضف لقطات شاشة إن وُجد تغيير في الواجهة

---

## 📐 معايير الكود

### JavaScript
```javascript
// ✅ جيد
const Utils = {
  formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()}`;
  }
};

// ❌ سيئ
const Utils = {
  formatDate: function(d) {
    if (d == null) return "-"
    var dt = new Date(d)
    return dt.getDate() + "/" + (dt.getMonth()+1) + "/" + dt.getFullYear()
  }
}
```

**القواعد:**
- استخدم `const`/`let` (ليس `var`)
- Arrow functions أو methods قصيرة
- Single quotes للنصوص
- Semi-colons في النهاية
- Template literals بدلاً من `+`
- تعليقات JSDoc للدوال المعقّدة

### CSS
```css
/* ✅ جيد */
.card {
  background: var(--card);
  border-radius: var(--radius);
  padding: 16px 20px;
}

/* ❌ سيئ */
.card{background:#fff;border-radius:10px;padding:16px 20px;}
```

**القواعد:**
- استخدم CSS variables (`var(--primary)`) بدلاً من القيم المباشرة
- مسافة بعد `:` 
- سطر منفصل لكل خاصية
- تعليقات للأقسام الكبيرة

### HTML
```html
<!-- ✅ جيد -->
<div class="card">
  <div class="card-header">
    <h3 class="card-title">العنوان</h3>
  </div>
</div>

<!-- ❌ سيئ -->
<div class="card"><div class="card-header"><h3 class="card-title">العنوان</h3></div></div>
```

**القواعد:**
- 2 مسافات للـ indentation
- خط منفصل لكل عنصر معقّد
- استخدم `lang="ar"` و `dir="rtl"`
- أضف `alt` لكل صورة

---

## 🧪 اختبار التغييرات

### اختبار يدوي
بعد كل تغيير، تأكد من:

| المنطقة | الفحص |
|---------|-------|
| تسجيل الدخول | جميع الحسابات (admin/qo/supervisor/employee) |
| لوحة التحكم | تظهر بطاقة الترحيب + الإحصائيات |
| التقييمات | إنشاء، عرض، اعتماد، تعديل |
| الموظفون | إضافة، تعديل، البحث، الفلترة |
| التقارير | عرض + تصدير PDF + تصدير Excel |
| الاعتراضات | تقديم، مراجعة، البت |
| سجل العمليات | يظهر العمليات الجديدة |
| الشعار في PDF | يظهر بألوانه (ليس أبيض) |
| RTL | جميع النصوص من اليمين |
| Mobile | يعمل على شاشات صغيرة |

### اختبار JS Syntax
```bash
cat public/js/01-constants.js \
    public/js/02-db.js \
    public/js/03-core.js \
    public/js/04-pages.js \
    public/js/05-app.js > /tmp/bundle.js
node --check /tmp/bundle.js
```

### اختبار JSON
```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json'))"
node -e "JSON.parse(require('fs').readFileSync('package.json'))"
```

---

## 📝 Commit Messages

اتبع نمط [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**الأنواع:**
| النوع | الوصف | مثال |
|-------|-------|------|
| `feat` | ميزة جديدة | `feat(reports): add yearly comparison chart` |
| `fix` | إصلاح خطأ | `fix(login): handle empty email field` |
| `refactor` | إعادة هيكلة | `refactor(db): split user methods` |
| `style` | تنسيق فقط | `style: format with prettier` |
| `docs` | وثائق | `docs(readme): add deployment steps` |
| `perf` | تحسين الأداء | `perf(pdf): reduce render time` |
| `test` | اختبارات | `test(utils): add validateEmail tests` |
| `chore` | أعمال إدارية | `chore(deps): bump chart.js to 4.4.1` |

**أمثلة:**
```
feat(employees): add supervisor selection dropdown

Replaces the free-text input with a dropdown populated from
active supervisor accounts. Prevents typos in supervisor names.

Closes #42
```

---

## ✅ قائمة Pull Request

قبل فتح PR، تأكد من:

- [ ] الكود يتبع معايير المشروع
- [ ] لا توجد أخطاء JavaScript (`node --check`)
- [ ] لا توجد ملفات `_temp_*` أو `.bak` متبقية
- [ ] تم اختبار التغييرات في المتصفح
- [ ] تم اختبار التصدير (PDF + Excel) عند الحاجة
- [ ] الشعار يظهر بشكل صحيح
- [ ] دعم RTL لم يتأثر
- [ ] تم تحديث `docs/CHANGELOG.md`
- [ ] تم تحديث الوثائق إذا تغيّر السلوك
- [ ] أضفت لقطات شاشة للتغييرات البصرية
- [ ] الـ commit messages تتبع Conventional Commits

---

## 🆘 الحصول على مساعدة

- 💬 افتح Issue للأسئلة
- 📚 راجع [docs/](docs/) للوثائق التفصيلية
- 📧 للأمور الحساسة: `dev@mahzam.com`

---

**شكراً لمساهمتك في بناء نظام محزم! 🌟**
