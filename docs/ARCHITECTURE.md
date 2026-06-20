# 🏗️ هيكلة النظام | System Architecture

## نظرة عامة

نظام محزم للجودة هو **Single-Page Application (SPA)** كلاسيكي بدون framework، يعتمد على:

```
المتصفح ⟷ HTML/CSS/JS ⟷ localStorage (أو Supabase)
```

لا يوجد server backend — كل المنطق على جانب المتصفح.

---

## 📦 الطبقات

```
┌─────────────────────────────────────────────────┐
│              UI Layer (04-pages.js)             │
│   صفحات + Modals + Forms + Charts + Tables     │
└─────────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│         Business Logic (03-core.js)             │
│  calculateScores | Perms | Utils | Toast/Modal │
└─────────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│           Data Layer (02-db.js)                 │
│  CRUD: users, evaluations, objections, audit   │
└─────────────────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│       Storage (localStorage / Supabase)         │
└─────────────────────────────────────────────────┘
```

---

## 📁 JavaScript Modules

تُحمَّل بهذا الترتيب في `index.html`:

### 1. `01-constants.js`
- 📦 شعار محزم (MAHZAM_LOGO_SVG, MAHZAM_LOGO_LIGHT_SVG)
- 📦 SYSTEM_NAME, COMPANY_NAME
- 📦 DEFAULT_CRITERIA - بنود التقييم (40 بنداً)
- 📦 CRITERIA (mutable - يُحمّل من DB)

**Dependencies:** none

### 2. `02-db.js`
- 🗄️ `DB.init()` - تحميل البيانات من localStorage
- 🗄️ `DB.users.*` - عمليات المستخدمين
- 🗄️ `DB.evaluations.*` - عمليات التقييمات
- 🗄️ `DB.objections.*` - عمليات الاعتراضات
- 🗄️ `DB.notifications.*` - الإشعارات
- 🗄️ `DB.audit.add()` - تسجيل عمليات
- 🗄️ `DB.stats.*` - حسابات الإحصائيات

**Dependencies:** `01-constants.js` (CRITERIA)

### 3. `03-core.js`
- ⚙️ `calculateScores()` - حساب النتيجة من البنود
- ⚙️ `Utils.*` - دوال مساعدة (format, validate, escape)
- ⚙️ `Perms.can()` - فحص الصلاحيات
- ⚙️ `Toast.*` - إشعارات منبثقة
- ⚙️ `Modal.*` - نوافذ منبثقة

**Dependencies:** `01-constants.js`

### 4. `04-pages.js`
- 🎨 جميع وظائف `render*()` و `attach*Handlers()`
- 🎨 PDF exports: `buildPDFHeader/Footer`, `htmlToPDF`, `PDF_CONFIG`
- 🎨 Excel exports: `exportListXLSX`, `exportReportsXLSX`, etc.
- 🎨 Routing: `navigate()`, `attachPageHandlers()`

**Dependencies:** كل ما سبق

### 5. `05-app.js`
- 🚀 `DB.init()` - تحميل البيانات
- 🚀 استعادة الجلسة من localStorage
- 🚀 `navigate('dashboard')` أو `navigate('login')`

**Dependencies:** كل ما سبق

---

## 🗄️ نموذج البيانات

### Users
```javascript
{
  id: 1,
  username: 'admin',
  email: 'admin@example.com',
  password: 'Admin@123',  // ⚠️ plain text (للـ POC فقط)
  full_name: 'مدير النظام',
  role: 'admin' | 'quality_officer' | 'supervisor' | 'employee',
  employee_number: 'ADM001',
  supervisor_name: '-',
  supervisor_id: null,
  department: 'الإدارة',
  position: 'مدير',
  is_active: true,
  must_change_password: false,
  created_at: '2026-01-01T00:00:00.000Z'
}
```

### Evaluations
```javascript
{
  id: 1,
  employee_id: 4,
  evaluator_id: 2,
  evaluation_date: '2026-06-15',
  observed_issue: 'عدم الالتزام بسير المكالمة',
  action_taken: 'تنبيه شفهي',
  supervisor_action: 'إعادة تدريب',
  supervisor_action_by: 3,
  supervisor_action_at: '2026-06-16T10:00:00.000Z',
  items: { s1_1: 'لا يوجد خطأ', ... },
  section_scores: { section1: 30, section2: 25, ... },
  total_score: 85,
  percentage: 85,
  grade: 'ناجح',
  status: 'ناجح',
  approved: true,
  approved_by: 2,
  approved_at: '...'
}
```

### Objections
```javascript
{
  id: 1,
  ref_number: 'OBJ-2026-0001',
  evaluation_id: 5,
  employee_id: 4,
  reason: 'سبب الاعتراض...',
  attachments: [{ name, type, data: 'base64...' }],
  status: 'pending' | 'under_review' | 'accepted' | 'rejected',
  comments: [{ user_id, user_name, text, created_at }],
  decision: 'accepted',
  resolved_by: 2,
  resolved_at: '...'
}
```

### Audit Logs
```javascript
{
  id: 1,
  user_id: 1,
  user_name: 'مدير النظام',
  role: 'admin',
  action: 'create_evaluation' | 'login' | 'approve_evaluation' | ...,
  entity_type: 'evaluation',
  entity_id: 5,
  details: 'تم إنشاء تقييم #5...',
  timestamp: '...'
}
```

---

## 🔄 تدفّق التطبيق (App Flow)

### عند فتح النظام:
```
1. تحميل HTML + CSS + 5 JS modules بالترتيب
2. 05-app.js يستدعي DB.init()
   - يقرأ localStorage
   - يبني bench إذا كان فارغاً
3. يتحقق من saved session
   - موجودة → navigate('dashboard')
   - غير موجودة → navigate('login')
4. navigate() يستدعي pages[page]() لرسم HTML
5. attachPageHandlers(page) لربط events
```

### عند تسجيل الدخول:
```
1. attachLogin() يلتقط submit
2. DB.getUserByEmail() يبحث في users
3. التحقق من password + is_active
4. حفظ الجلسة في localStorage
5. navigate('dashboard')
```

### عند إنشاء تقييم:
```
1. renderNewEvaluation() يعرض النموذج
2. attachNewEvalHandlers() يربط events
3. عند submit:
   - collectItems() يجمع البنود
   - calculateScores() يحسب النتيجة
   - DB.createEvaluation() يحفظ
   - DB.notifications.add() يُنشئ إشعار للموظف
   - DB.audit.add() يُسجّل العملية
4. navigate('view-evaluation', { id })
```

---

## 🔐 نموذج الصلاحيات (RBAC)

```javascript
const Perms = {
  'manage_users':         ['admin'],
  'view_audit_log':       ['admin', 'quality_officer'],
  'manage_settings':      ['admin'],
  'create_evaluation':    ['admin', 'quality_officer'],
  'edit_evaluation':      ['admin', 'quality_officer'],
  'approve_evaluation':   ['admin', 'quality_officer'],
  'manage_objections':    ['admin', 'quality_officer'],
  'submit_objection':     ['employee'],
  'view_team_objections': ['admin', 'quality_officer', 'supervisor'],
  'view_employees':       ['admin', 'quality_officer', 'supervisor']
};

Perms.can('approve_evaluation'); // → true/false
```

---

## 📊 نظام التصنيف الجديد

```javascript
function calculateScores(items) {
  // ... حساب section_scores ...
  let grade, status;
  if (percentage <= 75)      { grade = 'راسب';     status = 'راسب'; }
  else if (percentage <= 80) { grade = 'جيد جداً'; status = 'ناجح'; }
  else                       { grade = 'ناجح';     status = 'ناجح'; }
  return { totalScore, percentage, grade, status };
}
```

| النسبة | التقدير | المؤشر |
|--------|---------|--------|
| 0-75 | راسب | 🔴 |
| 76-80 | جيد جداً | 🔵 |
| 81-100 | ناجح | 🟢 |

---

## 📄 نظام PDF (A4 Professional)

```javascript
const PDF_CONFIG = {
  A4_WIDTH_MM: 210,
  A4_HEIGHT_MM: 297,
  MARGIN_MM: 12,
  CONTENT_WIDTH_PX: 720,      // عرض الرسم
  RENDER_SCALE: 2.5,          // → 246 DPI
  JPEG_QUALITY: 0.95
};
```

**التدفّق:**
1. `buildPDFHeader()` - شعار محزم + اسم التقرير
2. محتوى التقرير (HTML)
3. `buildPDFFooter()` - شعار + تاريخ + رقم صفحة (يتكرر في كل صفحة)
4. html2canvas → image → jsPDF → A4 page

**حماية من قص المحتوى:**
- CSS `page-break-inside: avoid` للجداول والبطاقات
- `display: table-header-group` لتكرار thead في الصفحات الجديدة
- White rectangles لإخفاء overflow

---

## 🔌 ربط Supabase (اختياري)

النظام يعمل على localStorage بشكل افتراضي، لكن يمكن ربطه بـ Supabase لمزامنة البيانات بين الأجهزة.

راجع: [supabase/README.md](../supabase/README.md)

---

## 🚀 خطط مستقبلية (Roadmap)

- [ ] فصل `04-pages.js` إلى ملفات أصغر حسب الميزة
- [ ] إضافة Supabase Auth (بدلاً من custom)
- [ ] bcrypt للـ password hashing
- [ ] دعم اللغة الإنجليزية (i18n)
- [ ] PWA support (offline)
- [ ] Dark mode
- [ ] Realtime updates (Supabase Realtime)
- [ ] Mobile app (Capacitor wrapper)
