# نظام الجودة للتقييم والتدريب 🛡️
## شركة محزم | Mahzam Co.

> Production-ready Quality Evaluation System • Static site + Supabase backend • Deployable on Vercel

---

## 📋 المحتويات

1. [نظرة عامة](#نظرة-عامة)
2. [بنية المشروع](#بنية-المشروع)
3. [الخطوة 1: إعداد Supabase](#الخطوة-1-إعداد-supabase)
4. [الخطوة 2: ربط الكود](#الخطوة-2-ربط-الكود)
5. [الخطوة 3: رفع المشروع على GitHub](#الخطوة-3-رفع-المشروع-على-github)
6. [الخطوة 4: النشر على Vercel](#الخطوة-4-النشر-على-vercel)
7. [الخطوة 5: التشغيل المحلي](#الخطوة-5-التشغيل-المحلي)
8. [حسابات الدخول التجريبية](#حسابات-الدخول-التجريبية)
9. [الأمان للإنتاج](#الأمان-للإنتاج)

---

## نظرة عامة

نظام شامل لإدارة جودة الأداء يدعم:

- ✅ تقييم الموظفين (40 بنداً)
- ✅ 4 أدوار: مدير / موظف جودة / مشرف / موظف
- ✅ إجراءات الجودة + إجراءات المشرف
- ✅ نظام الاعتراضات
- ✅ التقارير الشهرية والأخطاء المتكررة
- ✅ سجل عمليات (Audit Log) كامل
- ✅ تصدير PDF بمقاس A4 مع شعار محزم
- ✅ تصدير Excel متعدد الشيتات
- ✅ دعم RTL والعربية بالكامل
- ✅ هوية بصرية محزم (شعار + ألوان)

**التقنيات:**
- Frontend: HTML/CSS/JavaScript (vanilla)
- Backend: Supabase (PostgreSQL + REST API)
- Hosting: Vercel (static site)
- Libraries: Chart.js, jsPDF, XLSX.js, html2canvas

---

## بنية المشروع

```
quality-system/
├── README.md                    # هذا الملف
├── package.json
├── vercel.json                  # إعدادات Vercel
├── .gitignore
├── .env.example
├── index.html                   # الصفحة الرئيسية
│
├── css/
│   └── style.css                # كل التنسيقات
│
├── assets/
│   └── logo.svg                 # شعار محزم
│
├── js/
│   ├── config.js                # ⚠️ مفاتيح Supabase
│   ├── supabase-client.js       # تهيئة العميل
│   ├── constants.js             # الشعار + الثوابت
│   ├── utils.js                 # دوال مساعدة
│   ├── permissions.js           # الصلاحيات
│   ├── toast.js                 # إشعارات
│   ├── modal.js                 # النوافذ المنبثقة
│   ├── db.js                    # طبقة Supabase (CRUD)
│   ├── auth.js                  # تسجيل الدخول
│   ├── pdf-export.js            # تصدير PDF
│   ├── xlsx-export.js           # تصدير Excel
│   ├── app.js                   # التوجيه (Routing)
│   └── ui/
│       ├── layout.js            # القالب الرئيسي
│       ├── login.js             # شاشة الدخول
│       ├── dashboard.js         # لوحة التحكم
│       ├── employees.js         # الموظفون
│       ├── evaluations.js       # التقييمات
│       ├── reports.js           # التقارير
│       ├── objections.js        # الاعتراضات
│       ├── audit-log.js         # سجل العمليات
│       ├── users.js             # إدارة المستخدمين
│       ├── settings.js          # الإعدادات
│       └── profile.js           # الملف الشخصي
│
└── supabase/
    ├── schema.sql               # ⭐ هيكل قاعدة البيانات
    ├── seed.sql                 # ⭐ البيانات الأولية
    └── README.md                # دليل إعداد Supabase
```

---

## الخطوة 1: إعداد Supabase

### 1.1 إنشاء مشروع Supabase

1. اذهب إلى [supabase.com](https://supabase.com) وأنشئ حساباً مجانياً
2. اضغط **"New Project"**
3. اختر اسم المشروع: `mahzam-quality-system`
4. اختر كلمة مرور قوية لقاعدة البيانات (احفظها)
5. اختر **Region** قريبة (مثلاً: Frankfurt للسعودية)
6. اضغط **"Create new project"** (انتظر 2-3 دقائق)

### 1.2 تشغيل SQL Schema

1. في لوحة Supabase، اذهب إلى **SQL Editor** (الأيقونة على اليسار)
2. اضغط **"New query"**
3. افتح ملف `supabase/schema.sql` من هذا المشروع
4. الصق المحتوى كاملاً
5. اضغط **RUN** (أو Ctrl+Enter)
6. تأكد من ظهور: `Success. No rows returned`

### 1.3 إدراج البيانات الأولية

1. في **SQL Editor**، اضغط **"New query"** مرة أخرى
2. افتح ملف `supabase/seed.sql`
3. الصق المحتوى كاملاً
4. اضغط **RUN**
5. تأكد من إدراج 8 مستخدمين تجريبيين

### 1.4 الحصول على مفاتيح API

1. في لوحة Supabase، اذهب إلى **Settings → API**
2. انسخ القيمتين:
   - **Project URL**: `https://xxxxxxxxxxxx.supabase.co`
   - **anon public key**: `eyJhbGc...` (المفتاح العام)

> 💡 **ملاحظة**: المفتاح `anon` آمن للاستخدام في الـ frontend لأن RLS policies في schema.sql تحمي البيانات.

---

## الخطوة 2: ربط الكود

افتح ملف `js/config.js` وحدّث القيمتين:

```javascript
window.AppConfig = {
  SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',          // ← الصق هنا
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...',        // ← الصق هنا
  // ...
};
```

> ⚠️ هذا الملف **يجب** تحديثه قبل النشر.

---

## الخطوة 3: رفع المشروع على GitHub

### 3.1 إنشاء مستودع GitHub

1. اذهب إلى [github.com](https://github.com) وأنشئ حساباً (إن لم يكن لديك)
2. اضغط **"New repository"** (الزر الأخضر في الأعلى)
3. **Repository name**: `mahzam-quality-system`
4. اختر **Private** (مهم - لحماية الكود)
5. **لا تختر** إضافة README أو .gitignore (سنرفعها يدوياً)
6. اضغط **"Create repository"**

### 3.2 رفع الكود

افتح Terminal/PowerShell في مجلد المشروع ونفّذ:

```bash
# تهيئة Git
git init
git add .
git commit -m "Initial commit: Mahzam Quality System"

# ربط بالمستودع البعيد (استبدل YOUR_USERNAME)
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mahzam-quality-system.git

# الرفع
git push -u origin main
```

> 💡 إذا طلب منك تسجيل الدخول، استخدم Personal Access Token:
> GitHub → Settings → Developer settings → Personal access tokens → Generate new token

---

## الخطوة 4: النشر على Vercel

### 4.1 إنشاء حساب Vercel

1. اذهب إلى [vercel.com](https://vercel.com)
2. اضغط **"Sign Up"** واختر **"Continue with GitHub"**
3. وافق على الصلاحيات

### 4.2 استيراد المشروع

1. في لوحة Vercel، اضغط **"Add New... → Project"**
2. اختر مستودعك `mahzam-quality-system`
3. اضغط **"Import"**

### 4.3 إعدادات النشر

في صفحة الاستيراد:

- **Framework Preset**: `Other`
- **Root Directory**: `./` (الافتراضي)
- **Build Command**: اتركه فارغاً (موقع ثابت)
- **Output Directory**: اتركه فارغاً
- **Install Command**: اتركه فارغاً

### 4.4 إضافة Environment Variables (اختياري)

إذا أردت إخفاء مفاتيح Supabase عن الـ commit، أضفها كـ env variables:

في **Environment Variables**:
- `SUPABASE_URL` = `https://xxx.supabase.co`
- `SUPABASE_ANON_KEY` = `eyJhbGc...`

> ⚠️ ملاحظة: المشروع الحالي يقرأ المفاتيح من `js/config.js` مباشرة. لاستخدام env vars، يحتاج تعديل بسيط في `config.js`.

### 4.5 النشر

اضغط **"Deploy"** وانتظر دقيقة.

عندما يكتمل النشر، ستحصل على رابط مثل:
```
https://mahzam-quality-system.vercel.app
```

افتح الرابط وسجّل الدخول! ✅

---

## الخطوة 5: التشغيل المحلي

إذا أردت تشغيل المشروع محلياً قبل النشر:

### Windows / macOS / Linux

```bash
# الطريقة الأولى: npx serve
npx serve -p 3000

# الطريقة الثانية: python http.server
python3 -m http.server 3000

# الطريقة الثالثة: VS Code Live Server extension
```

ثم افتح المتصفح على: `http://localhost:3000`

> ⚠️ لا تفتح `index.html` مباشرة من الملف (file://) — يجب فتحه عبر web server بسبب CORS.

---

## حسابات الدخول التجريبية

| الدور | البريد الإلكتروني | كلمة المرور |
|------|------------------|------------|
| 👑 مدير النظام | `admin@example.com` | `Admin@123` |
| ⚖️ موظف الجودة | `quality@example.com` | `Quality@123` |
| 👨‍💼 المشرف | `supervisor@example.com` | `Super@123` |
| 👤 موظف | `emp001@example.com` | `Emp@123A!` |

> 🔒 **مهم**: غيّر كلمات المرور هذه في الإنتاج! تعديل في `supabase/seed.sql` قبل الإدراج أو من واجهة Supabase Dashboard.

---

## عمليات CRUD المتاحة

النظام يدعم العمليات الكاملة عبر طبقة `js/db.js`:

### المستخدمون (Users)
```javascript
await DB.users.list({ role: 'employee' });
await DB.users.getById(id);
await DB.users.getByEmail(email);
await DB.users.getSupervisors();
await DB.users.create({...});
await DB.users.update(id, {...});
await DB.users.deactivate(id);
await DB.users.delete(id);
await DB.users.resetPassword(id);
await DB.users.changePassword(id, newPw);
```

### التقييمات (Evaluations)
```javascript
await DB.evaluations.list({ employee_id, evaluator_id });
await DB.evaluations.getById(id);
await DB.evaluations.getAvgScore(employeeId);
await DB.evaluations.create({...});
await DB.evaluations.update(id, {...});
await DB.evaluations.approve(id);
await DB.evaluations.recordSupervisorAction(id, {action, notes});
await DB.evaluations.delete(id);
```

### الاعتراضات (Objections)
```javascript
await DB.objections.list({ employee_id, status });
await DB.objections.create({...});
await DB.objections.addComment(id, text);
await DB.objections.resolve(id, 'accepted', response);
await DB.objections.delete(id);
```

### الإشعارات
```javascript
await DB.notifications.list(userId);
await DB.notifications.add({...});
await DB.notifications.markAllRead(userId);
await DB.notifications.unreadCount(userId);
```

### سجل العمليات
```javascript
await DB.audit.list({ user_id, action, limit });
await DB.audit.add({ action, entity_type, entity_id, details });
```

### الإحصائيات
```javascript
await DB.stats.dashboard(userId);  // null للكل
```

---

## الأمان للإنتاج

⚠️ هذا الإصدار يستخدم نهجاً مبسطاً للمصادقة (custom auth). للإنتاج:

### 1. استبدال كلمات المرور بـ hash
كلمات المرور الحالية مخزّنة كنص واضح. للإنتاج:

**خياران:**

#### الخيار أ: استخدم Supabase Auth (موصى)
- اقرأ: https://supabase.com/docs/guides/auth
- يدعم Email/Password، OAuth، Magic Links
- يتعامل مع hash تلقائياً (bcrypt)

#### الخيار ب: hash يدوي
أضف bcrypt للكود وحدّث `auth.js`:
```javascript
// عند الإنشاء:
const hashed = await bcrypt.hash(password, 10);
// عند التحقق:
const valid = await bcrypt.compare(password, user.password);
```

### 2. تشديد RLS Policies

السياسات الحالية في `schema.sql` تسمح بالوصول الكامل عبر `anon`. للإنتاج:

```sql
-- مثال: قراءة المستخدم لبياناته فقط
DROP POLICY "Allow anon full access on users" ON users;
CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid()::text = id::text);
```

### 3. تفعيل HTTPS
- Vercel يوفر HTTPS تلقائياً ✅
- Supabase يستخدم HTTPS تلقائياً ✅

### 4. حماية المفاتيح
- `anon key` آمن للنشر في frontend ✅
- **لا تستخدم** `service_role key` في الـ frontend مطلقاً

---

## استكشاف الأخطاء

### "تعذّر الاتصال بقاعدة البيانات"
- تأكد أن قيم `SUPABASE_URL` و `SUPABASE_ANON_KEY` في `js/config.js` صحيحة
- افتح Console (F12) واقرأ رسالة الخطأ التفصيلية

### "البريد الإلكتروني أو كلمة المرور غير صحيحة"
- تأكد أن `seed.sql` تم تشغيله بنجاح
- في Supabase: Table Editor → users → تأكد من وجود الصفوف

### تعديلات لا تظهر بعد التحديث
- Vercel يخزّن الملفات. أضف `?v=2` لرابط الملف لإجبار التحديث
- أو امسح cache المتصفح (Ctrl+Shift+Delete)

### PDF لا يظهر بشكل صحيح
- تأكد من تحميل الخطوط: Cairo + html2canvas
- جرّب على متصفح آخر (Chrome مفضّل)

---

## المساهمة والتطوير

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/mahzam-quality-system.git
cd mahzam-quality-system

# تحديث ملف config
cp .env.example .env
# عدّل js/config.js بقيم Supabase

# تشغيل
npx serve -p 3000
```

---

## الترخيص

ملكية: شركة محزم • Mahzam Co.

---

## الدعم

- 📧 للاستفسارات التقنية: راجع `supabase/README.md`
- 📚 وثائق Supabase: https://supabase.com/docs
- 📚 وثائق Vercel: https://vercel.com/docs

---

**🌟 شكراً لاختيار نظام الجودة للتقييم والتدريب من شركة محزم**
